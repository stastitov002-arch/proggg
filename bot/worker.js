/**
 * 40/60 Design — Telegram-бот-редактор (Cloudflare Worker).
 *
 * Что делает:
 *  • принимает 3–5 фото проекта и описание из Telegram-канала;
 *  • принимает тему статьи и «факты» (цены, комплектации, фото) порциями;
 *  • по кнопке «Отправить в обработку» генерирует текст через DeepSeek по стандарту;
 *  • коммитит черновик в GitHub → GitHub Actions собирает страницу-превью;
 *  • публикует (draft: false) или отклоняет;
 *  • промпты настраиваются в боте один раз и фиксируются в KV.
 *
 * Переменные окружения (wrangler secret put ...):
 *   TG_TOKEN        — токен бота от @BotFather
 *   TG_SECRET       — секрет вебхука (любая строка, та же при setWebhook)
 *   ADMIN_IDS       — id пользователей через запятую (узнать: команда /id)
 *   GITHUB_TOKEN    — fine-grained PAT, права Contents: Read and write
 *   GITHUB_REPO     — stastitov002-arch/4060-site
 *   GITHUB_BRANCH   — main
 *   DEEPSEEK_KEY    — ключ api.deepseek.com
 *   DEEPSEEK_MODEL  — по умолчанию deepseek-chat
 *   SITE_URL        — https://4060design.ru
 *   KV (binding BOT) — Namespace для состояния и промптов
 */

import { PROMPTS_DEFAULT } from './prompts.js';

const MATERIALS = ['ЛДСП', 'AGT', 'Пленка ПВХ', 'Пластик', 'ALVIC Luxe', 'Массив', 'Шпон', 'Эмаль'];
const LAYOUTS = ['Линейная', 'Угловая', 'П-образная', 'С островом', 'Шкаф', 'Гардеробная', 'Тумба'];
const TYPES = ['Кухня', 'Гардеробная', 'Прихожая', 'Санузел', 'Гостиная', 'Другое'];

const MAX_PHOTOS = 6;
const MIN_PHOTOS = 3;

/* ------------------------------------------------------------------ утилиты */

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cut(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function slugify(input) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  return String(input || '')
    .toLowerCase()
    .split('')
    .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

function yamlStr(value) {
  const s = String(value ?? '');
  if (/[:#\-?*&!|>'"%@`{}\[\]]/.test(s) || /^\s|\s$/.test(s) || s === '') {
    return JSON.stringify(s);
  }
  return s;
}

function b64encodeBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64encodeUtf8(text) {
  return b64encodeBytes(new TextEncoder().encode(text));
}

/* --------------------------------------------------------------- Telegram */

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

const send = (env, chatId, text, keyboard) =>
  tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });

const edit = (env, chatId, messageId, text, keyboard) =>
  tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  }).catch(() => {});

const answer = (env, id, text) => tg(env, 'answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});

/* ------------------------------------------------------------------ GitHub */

async function ghRequest(env, path, init = {}) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': '4060-design-bot',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function ghGet(env, path) {
  const res = await ghRequest(env, path, { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json();
}

async function ghPut(env, path, base64Content, message, sha) {
  const body = {
    message,
    content: base64Content,
    branch: env.GITHUB_BRANCH || 'main',
  };
  if (sha) body.sha = sha;
  const res = await ghRequest(env, path, { method: 'PUT', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function ghPutText(env, path, text, message) {
  const existing = await ghGet(env, path);
  return ghPut(env, path, b64encodeUtf8(text), message, existing?.sha);
}

async function ghDelete(env, path, message) {
  const existing = await ghGet(env, path);
  if (!existing) return;
  await ghRequest(env, path, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: existing.sha, branch: env.GITHUB_BRANCH || 'main' }),
  });
}

async function downloadTelegramFile(env, fileId) {
  const info = await tg(env, 'getFile', { file_id: fileId });
  if (!info.ok) throw new Error('Не удалось получить файл из Telegram');
  const filePath = info.result.file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${env.TG_TOKEN}/${filePath}`);
  if (!res.ok) throw new Error('Не удалось скачать фото');
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/* ---------------------------------------------------------------- DeepSeek */

function parseJsonLoose(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (_) {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch (_) {}
  }
  return null;
}

async function ai(env, system, user) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.DEEPSEEK_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      temperature: 0.4,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${cut(await res.text(), 200)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const parsed = parseJsonLoose(text);
  if (!parsed) throw new Error('ИИ вернул ответ не в JSON');
  return parsed;
}

/* ------------------------------------------------------------------ состояние */

const draftKey = (chatId) => `draft:${chatId}`;

async function getDraft(env, chatId) {
  const raw = await env.BOT.get(draftKey(chatId));
  return raw ? JSON.parse(raw) : null;
}

async function setDraft(env, chatId, draft) {
  draft.updated = now();
  await env.BOT.put(draftKey(chatId), JSON.stringify(draft), { expirationTtl: 60 * 60 * 24 * 14 });
}

const delDraft = (env, chatId) => env.BOT.delete(draftKey(chatId));

async function getPrompts(env) {
  const raw = await env.BOT.get('prompts');
  if (!raw) return { ...PROMPTS_DEFAULT, custom: false };
  return { ...PROMPTS_DEFAULT, ...JSON.parse(raw), custom: true };
}

async function setPrompt(env, which, text) {
  const raw = await env.BOT.get('prompts');
  const cur = raw ? JSON.parse(raw) : {};
  cur[which] = text;
  cur.fixedAt = now();
  await env.BOT.put('prompts', JSON.stringify(cur));
}

/* ------------------------------------------------------------------ меню */

const MAIN_MENU = [
  [{ text: '📝 Новая статья', callback_data: 'new:article' }, { text: '🖼 Новый проект', callback_data: 'new:project' }],
  [{ text: '🗂 Черновики', callback_data: 'drafts' }, { text: '⚙️ Промпты', callback_data: 'prompts' }],
  [{ text: '❓ Как это работает', callback_data: 'help' }],
];

const CANCEL = [[{ text: '✖️ Отмена', callback_data: 'cancel' }]];

function mainMenuText() {
  return (
    '<b>40/60 Design — редактор</b>\n\n' +
    'Здесь мы собираем материалы и публикуем их на сайт.\n\n' +
    '📝 <b>Статья</b> — пришлите тему, потом факты и фото. ИИ напишет по стандарту, вы проверите превью и опубликуете.\n' +
    '🖼 <b>Проект</b> — пришлите 3–5 фото, название, материалы, цену и описание из канала. ИИ приведёт текст к стандарту портфолио.\n\n' +
    'Публикация сама пересобирает сайт на GitHub — страница появляется через 1–2 минуты.'
  );
}

/* ------------------------------------------------------------------ клавиатуры */

function toggleKeyboard(prefix, options, selected, extraRow = []) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(
      options.slice(i, i + 2).map((opt) => ({
        text: (selected.includes(opt) ? '✅ ' : '⬜ ') + opt,
        callback_data: `${prefix}:${opt}`,
      }))
    );
  }
  rows.push(extraRow);
  return rows;
}

/* ------------------------------------------------------------------ превью */

function articlePreviewText(result, stats) {
  const h2 = (result.body_md || '')
    .split('\n')
    .filter((l) => l.startsWith('## '))
    .map((l) => '• ' + l.replace(/^##\s+/, ''));
  const missing = (result.missing || []).filter(Boolean);
  const lines = [
    `<b>${esc(result.h1 || result.title)}</b>`,
    '',
    `<i>${esc(cut(result.description, 170))}</i>`,
    '',
    `<b>Структура:</b>\n${esc(h2.join('\n'))}`,
    '',
    `<b>Объём:</b> ${stats.words} слов · ${stats.chars} символов`,
  ];
  if (missing.length) {
    lines.push('', '<b>⚠️ ИИ просит уточнить:</b>');
    missing.slice(0, 6).forEach((m) => lines.push('— ' + esc(cut(m, 160))));
  }
  return cut(lines.join('\n'), 3900);
}

function projectPreviewText(result) {
  const lines = [
    `<b>${esc(result.title)}</b>`,
    '',
    esc(result.description),
    '',
    `<b>Тип:</b> ${esc(result.type || '—')}`,
    `<b>Материалы:</b> ${esc((result.materials || []).join(', ') || '—')}`,
    `<b>Планировка:</b> ${esc((result.layouts || []).join(', ') || '—')}`,
  ];
  if (result.countertop) lines.push(`<b>Столешница:</b> ${esc(result.countertop)}`);
  if (result.hardware) lines.push(`<b>Фурнитура:</b> ${esc(result.hardware)}`);
  const missing = (result.missing || []).filter(Boolean);
  if (missing.length) {
    lines.push('', '<b>⚠️ Стоит добавить:</b>');
    missing.slice(0, 6).forEach((m) => lines.push('— ' + esc(cut(m, 160))));
  }
  return cut(lines.join('\n'), 3900);
}

/* ------------------------------------------------------------------ markdown */

function articleMarkdown(result, opts = {}) {
  const fm = [
    '---',
    `title: ${yamlStr(result.title || result.h1)}`,
    `h1: ${yamlStr(result.h1 || result.title)}`,
    `description: ${yamlStr(result.description || '')}`,
    `lead: ${yamlStr(result.lead || '')}`,
    `cover: ${yamlStr(opts.cover || '')}`,
    `category: ${yamlStr(result.category || 'Мебель')}`,
    `tags: [${(result.tags || []).map(yamlStr).join(', ')}]`,
    `keywords: [${(result.keywords || []).map(yamlStr).join(', ')}]`,
    `date: ${today()}`,
    `updated: ${today()}`,
    `author: 40/60 Design`,
    `draft: ${opts.draft ? 'true' : 'false'}`,
    `slug: ${yamlStr(opts.slug)}`,
    '---',
    '',
  ].join('\n');
  return fm + (result.body_md || '') + '\n';
}

function projectMarkdown(result, opts = {}) {
  const fm = [
    '---',
    `slug: ${yamlStr(opts.slug)}`,
    `title: ${yamlStr(result.title)}`,
    'featured: false',
    `type: ${yamlStr(result.type || 'Кухня')}`,
    `style: ${yamlStr(result.style || '')}`,
    `layout: ${yamlStr((result.layouts || []).join(', '))}`,
    'material:',
    ...(result.materials || []).map((m) => `  - ${yamlStr(m)}`),
    `price: ${Number(String(opts.price || '').replace(/[^\d]/g, '')) || 0}`,
    `description: ${yamlStr(result.description)}`,
    `cover: ${yamlStr(opts.cover || '')}`,
    'gallery:',
    ...(opts.gallery || []).map((g) => `  - ${yamlStr(g)}`),
    `facades: ${yamlStr(result.facades || '')}`,
    `countertop: ${yamlStr(result.countertop || '')}`,
    `hardware: ${yamlStr(result.hardware || '')}`,
    `equipment: ${yamlStr(result.equipment || '')}`,
    `island: ${(result.layouts || []).includes('С островом') ? 'true' : 'false'}`,
    `draft: ${opts.draft ? 'true' : 'false'}`,
    '---',
    '',
  ].join('\n');
  return fm;
}

/* ------------------------------------------------------------------ проверка */

const REQUIRED_H2 = [
  ['сколько стоят', 'цены'],
  ['из чего складывается', 'стоимость'],
  ['как снизить', 'экономи'],
  ['на чём экономить', 'не стоит'],
  ['частые вопросы', 'вопрос'],
];

function validateArticle(result) {
  const body = String(result.body_md || '').toLowerCase();
  const problems = [];
  for (const variants of REQUIRED_H2) {
    if (!variants.some((v) => body.includes(v))) problems.push(variants[0]);
  }
  if (!result.h1) problems.push('h1');
  if (!result.description) problems.push('description');
  if (!body.includes('## короткий ответ')) problems.push('короткий ответ');
  return problems;
}

/* ------------------------------------------------------------------ публикация */

async function uploadPhotos(env, chatId, draft, folder, slug) {
  const paths = [];
  for (let i = 0; i < draft.photos.length; i++) {
    const fileId = draft.photos[i];
    try {
      const bytes = await downloadTelegramFile(env, fileId);
      const path = `${folder}/${slug}-${i + 1}.jpg`;
      const existing = await ghGet(env, path);
      await ghPut(env, path, b64encodeBytes(bytes), `photo: ${slug}-${i + 1}`, existing?.sha);
      paths.push(path);
    } catch (err) {
      console.error('photo upload failed', i, err.message);
    }
  }
  return paths;
}

async function publishArticle(env, chatId, draft) {
  const slug = draft.slug;
  const photos = await uploadPhotos(env, chatId, draft, 'images/articles', slug);
  const cover = photos[0] || '';
  const md = articleMarkdown(draft.result, { slug, cover, draft: false });
  await ghPutText(env, `_articles/${slug}.md`, md, `article: ${slug}`);
  await ghDelete(env, `preview/${slug}.html`, `cleanup: ${slug}`);
  return `${env.SITE_URL}/articles/${slug}.html`;
}

async function publishProject(env, chatId, draft) {
  const slug = draft.slug;
  const photos = await uploadPhotos(env, chatId, draft, 'images/uploads', slug);
  const cover = photos[0] || '';
  const md = projectMarkdown(draft.result, {
    slug,
    cover,
    gallery: photos.slice(1),
    price: draft.data.price,
    draft: false,
  });
  await ghPutText(env, `_projects/${slug}.md`, md, `project: ${slug}`);
  return `${env.SITE_URL}/portfolio/${slug}.html`;
}

async function commitPreview(env, draft) {
  const slug = draft.slug;
  if (draft.kind === 'article') {
    const md = articleMarkdown(draft.result, { slug, cover: '', draft: true });
    await ghPutText(env, `_articles/${slug}.md`, md, `draft: ${slug}`);
    return `${env.SITE_URL}/preview/${slug}.html`;
  }
  const md = projectMarkdown(draft.result, { slug, cover: '', gallery: [], price: draft.data.price, draft: true });
  await ghPutText(env, `_projects/${slug}.md`, md, `draft: ${slug}`);
  return `${env.SITE_URL}/preview/portfolio/${slug}.html`;
}

/* ------------------------------------------------------------------ ИИ-шаги */

async function generateArticle(env, draft) {
  const prompts = await getPrompts(env);
  const facts = draft.data.facts || [];
  const photosNote = draft.photos.length
    ? `Фото приложены к статье (${draft.photos.length} шт.). URL фото появятся после публикации — вставляй в текст только те URL, которые указаны в фактах. Не придумывай пути к картинкам.`
    : 'Фотографий нет. Не вставляй изображения и не ссылайся на фото.';

  const user = [
    `ТЕМА: ${draft.data.topic}`,
    '',
    'ФАКТЫ ОТ ВЛАДЕЛЬЦА (только это можно использовать как цифры и детали):',
    facts.length ? facts.map((f, i) => `${i + 1}. ${f}`).join('\n') : '(фактов не передано — опирайся только на общие принципы, а в "missing" перечисли, что нужно прислать)',
    '',
    photosNote,
    '',
    'Компания: 40/60 Design, Москва. Своё производство, срок 21 день, гарантия 3 года, замер бесплатный.',
    'Напиши статью по стандарту и верни JSON.',
  ].join('\n');

  let result = await ai(env, prompts.article, user);
  let problems = validateArticle(result);

  if (problems.length) {
    const fix = [
      user,
      '',
      'ПРЕДЫДУЩИЙ ОТВЕТ НЕ СООТВЕТСТВУЕТ СТАНДАРТУ.',
      'Исправь и верни полный JSON заново. Не хватает: ' + problems.join('; '),
      'Обязательные разделы: "## Короткий ответ", "## Сколько стоят кухни разных размеров",',
      '"## Из чего складывается стоимость кухни", "## Как снизить стоимость кухни",',
      '"## На чём экономить не стоит", "## Частые вопросы".',
    ].join('\n');
    result = await ai(env, prompts.article, fix);
    problems = validateArticle(result);
  }

  draft.result = result;
  draft.slug = slugify(result.slug || result.h1 || draft.data.topic);
  draft.validation = problems;
  return draft;
}

async function generateProject(env, draft) {
  const prompts = await getPrompts(env);
  const d = draft.data;
  const user = [
    `ЧЕРНОВОЕ ОПИСАНИЕ ИЗ КАНАЛА: ${d.description}`,
    '',
    `Название (если задано): ${d.title || '—'}`,
    `Материалы: ${(d.materials || []).join(', ') || '—'}`,
    `Планировка: ${(d.layouts || []).join(', ') || '—'}`,
    `Цена: ${d.price || '—'}`,
    draft.photos.length ? `Фото: ${draft.photos.length} шт.` : 'Фото: нет',
    '',
    'Приведи описание к стандарту портфолио и верни JSON.',
  ].join('\n');

  const result = await ai(env, prompts.project, user);
  if (!result.materials?.length && d.materials?.length) result.materials = d.materials;
  if (!result.layouts?.length && d.layouts?.length) result.layouts = d.layouts;
  draft.result = result;
  draft.slug = slugify(result.slug || result.title || d.title);
  return draft;
}

/* ------------------------------------------------------------------ обработчики */

async function startFlow(env, chatId, kind) {
  const draft = {
    kind,
    step: kind === 'article' ? 'topic' : 'photos',
    photos: [],
    data: kind === 'article' ? { topic: '', facts: [] } : { title: '', materials: [], layouts: [], price: '', description: '' },
    createdAt: now(),
  };
  await setDraft(env, chatId, draft);

  if (kind === 'article') {
    await send(
      env,
      chatId,
      '<b>Новая статья</b>\n\nПришлите одним сообщением <b>тему</b> и, если есть, ключевые запросы.\n\n' +
        'Например:\n<i>Сколько стоит кухня на заказ в Москве в 2026 году\nКлючи: сколько стоит кухня на заказ, цена кухни, стоимость кухни в Москве</i>',
      CANCEL
    );
  } else {
    await send(
      env,
      chatId,
      `<b>Новый проект</b>\n\nПришлите <b>${MIN_PHOTOS}–5 фотографий</b> проекта (можно по одной).\n\n` +
        'Фото станут обложкой и галереей на странице проекта. Когда закончите — нажмите «Далее».',
      [[{ text: '▶️ Далее', callback_data: 'pr:next' }], [{ text: '✖️ Отмена', callback_data: 'cancel' }]]
    );
  }
}

async function handleArticleTopic(env, chatId, text) {
  const draft = await getDraft(env, chatId);
  if (!draft) return startFlow(env, chatId, 'article');
  draft.data.topic = text.trim();
  draft.step = 'facts';
  await setDraft(env, chatId, draft);
  await send(
    env,
    chatId,
    '<b>Тема принята.</b>\n\nТеперь присылайте <b>факты</b> — чем больше конкретики, тем сильнее статья:\n' +
      '• реальные цены и сметы,\n• комплектации (материалы, фурнитура, столешница),\n' +
      '• случаи с объектов и ограничения,\n• фотографии проектов.\n\n' +
      'Можно отправлять сколько угодно сообщений и фото. Когда всё — нажмите <b>«Отправить в обработку»</b>.',
    [
      [{ text: '📊 Что собрано', callback_data: 'ar:list' }],
      [{ text: '🚀 Отправить в обработку', callback_data: 'ar:go' }],
      [{ text: '✖️ Отмена', callback_data: 'cancel' }],
    ]
  );
}

function factsSummary(draft) {
  const facts = draft.data.facts || [];
  return (
    `<b>Собрано для статьи</b>\n\n` +
    `<b>Тема:</b> ${esc(draft.data.topic)}\n` +
    `<b>Фактов:</b> ${facts.length}\n` +
    `<b>Фотографий:</b> ${draft.photos.length}\n\n` +
    (facts.length ? facts.slice(-8).map((f, i) => `— ${esc(cut(f, 120))}`).join('\n') : 'Пока пусто. Пришлите факты текстом.')
  );
}

async function runArticleAI(env, chatId, draft) {
  const status = await send(env, chatId, '⏳ Пишу статью по стандарту… Это занимает 20–60 секунд.');
  try {
    draft = await generateArticle(env, draft);
    await setDraft(env, chatId, draft);
    const previewUrl = await commitPreview(env, draft);
    draft.previewUrl = previewUrl;
    await setDraft(env, chatId, draft);

    const body = draft.result.body_md || '';
    const stats = { words: body.split(/\s+/).filter(Boolean).length, chars: body.length };

    await edit(env, chatId, status.result?.message_id, articlePreviewText(draft.result, stats));

    const rows = [
      [{ text: '📄 Открыть превью', url: previewUrl }],
      [{ text: '✅ Опубликовать', callback_data: 'ar:publish' }],
      [{ text: '🔁 Переписать заново', callback_data: 'ar:rewrite' }, { text: '✏️ Дать правки', callback_data: 'ar:fix' }],
      [{ text: '❌ Отклонить', callback_data: 'ar:reject' }],
    ];
    if (draft.validation?.length) {
      rows.splice(1, 0, [{ text: '⚠️ Структура: ' + draft.validation.slice(0, 2).join(', '), callback_data: 'ar:noop' }]);
    }
    await send(
      env,
      chatId,
      'Проверьте текст и откройте превью. Страница появится на сайте через 1–2 минуты (GitHub собирает её автоматически).',
      rows
    );
  } catch (err) {
    await edit(env, chatId, status.result?.message_id, `❌ Ошибка генерации: ${esc(cut(err.message, 300))}`);
    await send(env, chatId, 'Попробуйте ещё раз или пришлите больше фактов.', [
      [{ text: '🚀 Повторить', callback_data: 'ar:go' }],
      [{ text: '✖️ Отмена', callback_data: 'cancel' }],
    ]);
  }
}

async function runProjectAI(env, chatId, draft) {
  const status = await send(env, chatId, '⏳ Привожу описание к стандарту портфолио…');
  try {
    draft = await generateProject(env, draft);
    await setDraft(env, chatId, draft);
    const previewUrl = await commitPreview(env, draft);
    draft.previewUrl = previewUrl;
    await setDraft(env, chatId, draft);

    await edit(env, chatId, status.result?.message_id, projectPreviewText(draft.result));
    await send(env, chatId, 'Проверьте и опубликуйте.', [
      [{ text: '📄 Открыть превью', url: previewUrl }],
      [{ text: '✅ Опубликовать', callback_data: 'pr:publish' }],
      [{ text: '🔁 Переписать', callback_data: 'pr:rewrite' }, { text: '✏️ Дать правки', callback_data: 'pr:fix' }],
      [{ text: '❌ Отклонить', callback_data: 'pr:reject' }],
    ]);
  } catch (err) {
    await edit(env, chatId, status.result?.message_id, `❌ Ошибка: ${esc(cut(err.message, 300))}`);
    await send(env, chatId, 'Попробуйте снова.', [
      [{ text: '🔁 Повторить', callback_data: 'pr:go' }],
      [{ text: '✖️ Отмена', callback_data: 'cancel' }],
    ]);
  }
}

function isAdmin(env, userId) {
  const ids = String(env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return true; // пока не настроено — пускаем всех
  return ids.includes(String(userId));
}

/* ------------------------------------------------------------------ апдейты */

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id;
  const text = (msg.text || '').trim();

  if (!isAdmin(env, userId)) {
    await send(env, chatId, `Нет доступа. Ваш id: <code>${userId}</code> — добавьте его в ADMIN_IDS.`);
    return;
  }

  if (text === '/id') {
    await send(env, chatId, `Ваш Telegram id: <code>${userId}</code>\nchat id: <code>${chatId}</code>`);
    return;
  }

  if (text === '/start' || text === '/menu' || text === '/help') {
    await send(env, chatId, mainMenuText(), MAIN_MENU);
    return;
  }

  if (text === '/cancel') {
    await delDraft(env, chatId);
    await send(env, chatId, 'Отменено.', MAIN_MENU);
    return;
  }

  if (text === '/prompts') {
    await showPrompts(env, chatId);
    return;
  }

  const draft = await getDraft(env, chatId);
  if (!draft) {
    await send(env, chatId, 'Выберите действие:', MAIN_MENU);
    return;
  }

  // ---- фото
  if (msg.photo) {
    const sizes = msg.photo;
    const best = sizes[sizes.length - 1];
    if (draft.photos.length >= MAX_PHOTOS) {
      await send(env, chatId, `Уже ${draft.photos.length} фото — это максимум для одной карточки.`);
      return;
    }
    draft.photos.push(best.file_id);
    await setDraft(env, chatId, draft);

    const label = draft.kind === 'project' ? 'проекта' : 'статьи';
    const need = draft.kind === 'project' ? MIN_PHOTOS : 1;
    await send(
      env,
      chatId,
      `📷 Фото ${draft.photos.length} добавлено (для ${label}).` +
        (draft.photos.length < need ? `\nЕщё минимум ${need - draft.photos.length}.` : ''),
      draft.kind === 'project'
        ? [[{ text: '▶️ Далее', callback_data: 'pr:next' }], [{ text: '✖️ Отмена', callback_data: 'cancel' }]]
        : [
            [{ text: '📊 Что собрано', callback_data: 'ar:list' }],
            [{ text: '🚀 Отправить в обработку', callback_data: 'ar:go' }],
            [{ text: '✖️ Отмена', callback_data: 'cancel' }],
          ]
    );
    return;
  }

  if (!text) return;

  // ---- шаги диалога
  if (draft.kind === 'article') {
    if (draft.step === 'topic') return handleArticleTopic(env, chatId, text);
    if (draft.step === 'facts') {
      draft.data.facts.push(text);
      await setDraft(env, chatId, draft);
      const n = draft.data.facts.length;
      await send(env, chatId, `✅ Факт №${n} сохранён. Присылайте следующий или жмите «Отправить в обработку».`, [
        [{ text: '📊 Что собрано', callback_data: 'ar:list' }],
        [{ text: '🚀 Отправить в обработку', callback_data: 'ar:go' }],
        [{ text: '✖️ Отмена', callback_data: 'cancel' }],
      ]);
      return;
    }
    if (draft.step === 'fix') {
      draft.data.facts.push('ПРАВКИ РЕДАКТОРА: ' + text);
      draft.step = 'facts';
      await setDraft(env, chatId, draft);
      return runArticleAI(env, chatId, draft);
    }
    if (draft.step === 'prompt') {
      await setPrompt(env, 'article', text);
      await send(env, chatId, '✅ Промпт статьи обновлён и зафиксирован.', MAIN_MENU);
      await delDraft(env, chatId);
      return;
    }
  }

  if (draft.kind === 'project') {
    if (draft.step === 'title') {
      draft.data.title = text;
      draft.step = 'materials';
      await setDraft(env, chatId, draft);
      return askMaterials(env, chatId, draft);
    }
    if (draft.step === 'price') {
      draft.data.price = text.replace(/[^\d]/g, '');
      draft.step = 'description';
      await setDraft(env, chatId, draft);
      await send(env, chatId, 'Теперь пришлите <b>описание проекта</b> (можно скопировать пост из Telegram-канала).', CANCEL);
      return;
    }
    if (draft.step === 'description') {
      draft.data.description = text;
      draft.step = 'ready';
      await setDraft(env, chatId, draft);
      await send(env, chatId, 'Готово. Отправляю в обработку?', [
        [{ text: '🚀 Отправить в обработку', callback_data: 'pr:go' }],
        [{ text: '✖️ Отмена', callback_data: 'cancel' }],
      ]);
      return;
    }
    if (draft.step === 'fix') {
      draft.data.description += '\nПРАВКИ РЕДАКТОРА: ' + text;
      draft.step = 'ready';
      await setDraft(env, chatId, draft);
      return runProjectAI(env, chatId, draft);
    }
    if (draft.step === 'prompt') {
      await setPrompt(env, 'project', text);
      await send(env, chatId, '✅ Промпт проекта обновлён и зафиксирован.', MAIN_MENU);
      await delDraft(env, chatId);
      return;
    }
  }

  await send(env, chatId, 'Не понял. Используйте кнопки ниже.', MAIN_MENU);
}

async function askMaterials(env, chatId, draft) {
  await send(
    env,
    chatId,
    '<b>Материалы фасадов.</b>\nОтметьте все подходящие (проект с двумя материалами будет находиться в фильтре по каждому).',
    toggleKeyboard('pm', MATERIALS, draft.data.materials, [{ text: '▶️ Готово', callback_data: 'pm:done' }])
  );
}

async function showPrompts(env, chatId) {
  const prompts = await getPrompts(env);
  await send(
    env,
    chatId,
    '<b>⚙️ Промпты</b>\n\n' +
      `Статус: ${prompts.custom ? '<b>настроены вручную и зафиксированы</b>' : 'заводские'}\n\n` +
      `Промпт статьи — ${prompts.article.length} символов.\nПромпт проекта — ${prompts.project.length} символов.\n\n` +
      'Настроить нужно один раз: после сохранения промпт используется для всех следующих материалов.',
    [
      [{ text: '📝 Промпт статьи', callback_data: 'prompt:show:article' }],
      [{ text: '🖼 Промпт проекта', callback_data: 'prompt:show:project' }],
      [{ text: '✏️ Изменить промпт статьи', callback_data: 'prompt:edit:article' }],
      [{ text: '✏️ Изменить промпт проекта', callback_data: 'prompt:edit:project' }],
      [{ text: '♻️ Сбросить к заводским', callback_data: 'prompt:reset' }],
      [{ text: '← Меню', callback_data: 'menu' }],
    ]
  );
}

async function showDrafts(env, chatId) {
  await send(env, chatId, '⏳ Смотрю черновики в репозитории…');
  try {
    const out = [];
    for (const folder of ['_articles', '_projects']) {
      const res = await ghRequest(env, folder, { method: 'GET' });
      if (!res.ok) continue;
      const files = await res.json();
      const md = (files || []).filter((f) => f.name.endsWith('.md')).slice(-20);
      for (const f of md) {
        const raw = await fetch(f.download_url);
        const text = await raw.text();
        if (/^draft:\s*true/m.test(text)) {
          const slug = (text.match(/^slug:\s*(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '') || f.name.replace(/\.md$/, '');
          const kind = folder === '_articles' ? 'articles' : 'portfolio';
          out.push({ slug, url: `${env.SITE_URL}/preview/${folder === '_articles' ? '' : 'portfolio/'}${slug}.html` });
        }
      }
    }
    if (!out.length) {
      await send(env, chatId, 'Черновиков нет — всё опубликовано.', [[{ text: '← Меню', callback_data: 'menu' }]]);
      return;
    }
    const rows = out.slice(0, 8).map((d) => [{ text: '📄 ' + d.slug, url: d.url }]);
    rows.push([{ text: '← Меню', callback_data: 'menu' }]);
    await send(env, chatId, `<b>Черновики (${out.length}):</b>\nСтраницы-превью открываются без индексации.`, rows);
  } catch (err) {
    await send(env, chatId, 'Не удалось прочитать репозиторий: ' + esc(cut(err.message, 200)), [[{ text: '← Меню', callback_data: 'menu' }]]);
  }
}

async function handleCallback(env, cq) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const data = cq.data || '';
  const userId = cq.from?.id;

  if (!isAdmin(env, userId)) {
    await answer(env, cq.id, 'Нет доступа');
    return;
  }
  await answer(env, cq.id);

  if (data === 'menu') return send(env, chatId, mainMenuText(), MAIN_MENU);
  if (data === 'cancel') {
    await delDraft(env, chatId);
    return send(env, chatId, 'Отменено.', MAIN_MENU);
  }
  if (data === 'help') {
    return send(
      env,
      chatId,
      '<b>Как это работает</b>\n\n' +
        '1. «Новая статья» → тема → факты и фото → «Отправить в обработку».\n' +
        '2. ИИ пишет по стандарту: короткий ответ, цены, разбор стоимости, примеры за 300 000 и 500 000 ₽, как сэкономить, на чём не стоит, частые вопросы.\n' +
        '3. Бот коммитит черновик в GitHub, Actions собирает страницу-превью.\n' +
        '4. Вы открываете превью, правите (кнопка «Дать правки») или публикуете.\n\n' +
        'То же для проектов портфолио: 3–5 фото → название → материалы → планировка → цена → описание.\n\n' +
        'Промпты настраиваются один раз в меню «⚙️ Промпты».',
      [[{ text: '← Меню', callback_data: 'menu' }]]
    );
  }
  if (data === 'drafts') return showDrafts(env, chatId);
  if (data === 'prompts') return showPrompts(env, chatId);

  if (data.startsWith('prompt:')) {
    const [, action, which] = data.split(':');
    if (action === 'show') {
      const prompts = await getPrompts(env);
      const text = which === 'article' ? prompts.article : prompts.project;
      return send(env, chatId, `<b>Промпт ${which === 'article' ? 'статьи' : 'проекта'}:</b>\n\n<pre>${esc(cut(text, 3200))}</pre>`, [
        [{ text: '✏️ Изменить', callback_data: `prompt:edit:${which}` }],
        [{ text: '← Назад', callback_data: 'prompts' }],
      ]);
    }
    if (action === 'edit') {
      const draft = (await getDraft(env, chatId)) || { kind: which === 'article' ? 'article' : 'project', photos: [], data: {} };
      draft.step = 'prompt';
      draft.kind = which === 'article' ? 'article' : 'project';
      await setDraft(env, chatId, draft);
      return send(
        env,
        chatId,
        `Пришлите новый текст промпта ${which === 'article' ? 'статьи' : 'проекта'} одним сообщением. Он заменит текущий и зафиксируется.`,
        CANCEL
      );
    }
    if (action === 'reset') {
      await env.BOT.delete('prompts');
      return send(env, chatId, 'Промпты сброшены к заводским.', [[{ text: '← Меню', callback_data: 'menu' }]]);
    }
  }

  if (data === 'new:article') return startFlow(env, chatId, 'article');
  if (data === 'new:project') return startFlow(env, chatId, 'project');

  const draft = await getDraft(env, chatId);
  if (!draft) return send(env, chatId, 'Сессия потеряна. Начните заново.', MAIN_MENU);

  // ---- проект
  if (data === 'pr:next') {
    if (draft.photos.length < MIN_PHOTOS) {
      return send(env, chatId, `Нужно минимум ${MIN_PHOTOS} фото, сейчас ${draft.photos.length}.`);
    }
    draft.step = 'title';
    await setDraft(env, chatId, draft);
    return send(env, chatId, 'Как называется проект? Например: <i>Кухня из шпона</i>', CANCEL);
  }

  if (data.startsWith('pm:')) {
    const value = data.slice(3);
    if (value === 'done') {
      if (!draft.data.materials.length) return send(env, chatId, 'Отметьте хотя бы один материал.');
      draft.step = 'layouts';
      await setDraft(env, chatId, draft);
      return send(
        env,
        chatId,
        '<b>Планировка.</b> Можно выбрать несколько (например, «Угловая» и «С островом»).',
        toggleKeyboard('pl', LAYOUTS, draft.data.layouts, [{ text: '▶️ Готово', callback_data: 'pl:done' }])
      );
    }
    const idx = draft.data.materials.indexOf(value);
    if (idx === -1) draft.data.materials.push(value);
    else draft.data.materials.splice(idx, 1);
    await setDraft(env, chatId, draft);
    return edit(
      env,
      chatId,
      messageId,
      '<b>Материалы фасадов.</b>\nОтметьте все подходящие.',
      toggleKeyboard('pm', MATERIALS, draft.data.materials, [{ text: '▶️ Готово', callback_data: 'pm:done' }])
    );
  }

  if (data.startsWith('pl:')) {
    const value = data.slice(3);
    if (value === 'done') {
      draft.step = 'price';
      await setDraft(env, chatId, draft);
      return send(env, chatId, 'Цена проекта в рублях? Пришлите числом (например, 416000).\nЕсли не хотите указывать — отправьте «-».', CANCEL);
    }
    const idx = draft.data.layouts.indexOf(value);
    if (idx === -1) draft.data.layouts.push(value);
    else draft.data.layouts.splice(idx, 1);
    await setDraft(env, chatId, draft);
    return edit(
      env,
      chatId,
      messageId,
      '<b>Планировка.</b> Можно выбрать несколько.',
      toggleKeyboard('pl', LAYOUTS, draft.data.layouts, [{ text: '▶️ Готово', callback_data: 'pl:done' }])
    );
  }

  if (data === 'pr:go' || data === 'pr:rewrite') {
    if (!draft.data.description) return send(env, chatId, 'Нет описания — пришлите текст описания.');
    return runProjectAI(env, chatId, draft);
  }
  if (data === 'pr:fix') {
    draft.step = 'fix';
    await setDraft(env, chatId, draft);
    return send(env, chatId, 'Напишите, что поправить в тексте. Например: «убери упоминание острова, добавь про подсветку».', CANCEL);
  }
  if (data === 'pr:publish') {
    await send(env, chatId, '⏳ Загружаю фото и публикую…');
    try {
      const url = await publishProject(env, chatId, draft);
      await delDraft(env, chatId);
      return send(env, chatId, `✅ Опубликовано.\nСтраница: ${url}\nСайт пересоберётся в течение 1–2 минут.`, MAIN_MENU);
    } catch (err) {
      return send(env, chatId, '❌ Ошибка публикации: ' + esc(cut(err.message, 300)));
    }
  }
  if (data === 'pr:reject') {
    if (draft.slug) await ghDelete(env, `_projects/${draft.slug}.md`, `reject: ${draft.slug}`).catch(() => {});
    await delDraft(env, chatId);
    return send(env, chatId, 'Отклонено, черновик удалён.', MAIN_MENU);
  }

  // ---- статья
  if (data === 'ar:list') return send(env, chatId, factsSummary(draft), [
    [{ text: '🚀 Отправить в обработку', callback_data: 'ar:go' }],
    [{ text: '✖️ Отмена', callback_data: 'cancel' }],
  ]);
  if (data === 'ar:go' || data === 'ar:rewrite') return runArticleAI(env, chatId, draft);
  if (data === 'ar:fix') {
    draft.step = 'fix';
    await setDraft(env, chatId, draft);
    return send(env, chatId, 'Напишите правки к статье одним сообщением — перепишу с учётом.', CANCEL);
  }
  if (data === 'ar:publish') {
    await send(env, chatId, '⏳ Загружаю фото и публикую…');
    try {
      const url = await publishArticle(env, chatId, draft);
      await delDraft(env, chatId);
      return send(env, chatId, `✅ Опубликовано.\nСтатья: ${url}\nПоявится на сайте через 1–2 минуты.`, MAIN_MENU);
    } catch (err) {
      return send(env, chatId, '❌ Ошибка публикации: ' + esc(cut(err.message, 300)));
    }
  }
  if (data === 'ar:reject') {
    if (draft.slug) await ghDelete(env, `_articles/${draft.slug}.md`, `reject: ${draft.slug}`).catch(() => {});
    await delDraft(env, chatId);
    return send(env, chatId, 'Отклонено, черновик удалён.', MAIN_MENU);
  }
  if (data === 'ar:noop') return;

  await send(env, chatId, 'Кнопка устарела. Начните заново.', MAIN_MENU);
}

/* ------------------------------------------------------------------ роутер */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ ok: true, ts: now() });
    }

    if (request.method === 'POST' && url.pathname === '/') {
      if (env.TG_SECRET && request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      let update;
      try {
        update = await request.json();
      } catch (_) {
        return new Response('bad request', { status: 400 });
      }
      ctx.waitUntil(
        (async () => {
          try {
            if (update.message) await handleMessage(env, update.message);
            else if (update.callback_query) await handleCallback(env, update.callback_query);
          } catch (err) {
            const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
            if (chatId) {
              await send(env, chatId, '❌ Внутренняя ошибка: ' + esc(cut(err.message, 300))).catch(() => {});
            }
          }
        })()
      );
      return new Response('ok');
    }

    return new Response('40/60 Design bot', { status: 200 });
  },
};
