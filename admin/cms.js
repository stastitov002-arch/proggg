/* CMS 40/60 Design — редактор сайта поверх GitHub API.
   Работает как статическая страница: токен хранится в localStorage браузера,
   правки коммитятся в репозиторий, GitHub Actions пересобирает страницы. */
(function () {
  'use strict';

  var MATERIALS = ['ЛДСП', 'AGT', 'Пленка ПВХ', 'Пластик', 'ALVIC Luxe', 'Массив', 'Шпон', 'Эмаль'];
  var LAYOUTS = ['Линейная', 'Угловая', 'П-образная', 'С островом', 'Шкаф', 'Гардеробная', 'Тумба'];
  var TYPES = ['Кухня', 'Гардеробная', 'Прихожая', 'Санузел', 'Гостиная', 'Другое'];
  var CATEGORIES = ['Цены', 'Материалы', 'Дизайн', 'Производство', 'Уход'];
  var SITE_IMAGES = [
    ['images/hero.jpg', 'Первый экран главной'],
    ['images/portfolio-hero.jpg', 'Баннер портфолио'],
    ['images/cta-bg.jpg', 'Фон блока «Отправьте размеры»'],
    ['images/showroom.jpg', 'Фото производства / шоурума'],
    ['images/og-cover.jpg', 'Картинка для мессенджеров (OG)']
  ];

  var state = {
    token: '', repo: '', branch: 'main',
    site: null, siteSha: null,
    projects: [], articles: [],
    page: 'home',
    editing: null,
    dirty: false,
    visualDoc: null
  };

  /* ------------------------------------------------------------- утилиты */
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null) continue;
      if (Array.isArray(kid)) kid.forEach(function (k) { if (k) node.appendChild(k); });
      else node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function toast(msg, type) {
    var t = el('div', { class: 'toast' + (type ? ' toast--' + type : ''), text: msg });
    $('#toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, type === 'err' ? 7000 : 4000);
  }
  function busy(on, label) {
    var l = $('#loader');
    l.hidden = !on;
    if (label) l.lastChild.textContent = label;
  }
  function markDirty(on) {
    state.dirty = on !== false;
    $('#btn-save').disabled = !state.dirty;
    var s = $('#status');
    s.textContent = state.dirty ? 'Есть несохранённые изменения' : '';
    s.className = 'top__status' + (state.dirty ? ' is-dirty' : '');
  }
  function confirmDialog(text) {
    return window.confirm(text);
  }

  /* --------------------------------------------------------------- GitHub */
  function apiUrl(path, query) {
    var enc = path.split('/').map(encodeURIComponent).join('/');
    return 'https://api.github.com/repos/' + state.repo + '/contents/' + enc + (query || '');
  }
  function gh(path, opts) {
    opts = opts || {};
    var headers = {
      accept: 'application/vnd.github+json',
      'content-type': 'application/json'
    };
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    return fetch(opts.url || apiUrl(path, opts.query), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    });
  }
  function b64FromBytes(bytes) {
    var s = '', chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }
  function utf8B64(str) { return b64FromBytes(new TextEncoder().encode(str)); }
  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function getFile(path) {
    var res = await gh(path);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub GET ' + path + ': ' + res.status);
    var data = await res.json();
    return { text: b64ToUtf8(data.content || ''), sha: data.sha, path: path };
  }
  async function putFile(path, text, message, sha) {
    var body = { message: message, content: utf8B64(text), branch: state.branch };
    if (sha) body.sha = sha;
    var res = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('GitHub PUT ' + path + ': ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res.json();
  }
  async function putBinary(path, file, message) {
    var buf = await file.arrayBuffer();
    var body = { message: message, content: b64FromBytes(new Uint8Array(buf)), branch: state.branch };
    var existing = null;
    try { existing = await getFile(path); } catch (e) {}
    if (existing) body.sha = existing.sha;
    var res = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('GitHub PUT ' + path + ': ' + res.status);
    return res.json();
  }
  async function deleteFile(path, message) {
    var existing = await getFile(path);
    if (!existing) return;
    var res = await gh(path, {
      method: 'DELETE',
      body: JSON.stringify({ message: message, sha: existing.sha, branch: state.branch })
    });
    if (!res.ok) throw new Error('GitHub DELETE ' + path + ': ' + res.status);
  }
  async function listDir(path) {
    var res = await gh(path);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('GitHub LIST ' + path + ': ' + res.status);
    return res.json();
  }

  function slugify(input) {
    var map = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
    return String(input || '').toLowerCase().split('').map(function (c) { return map[c] !== undefined ? map[c] : c; })
      .join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  }

  /* ------------------------------------------------------- YAML / markdown */
  function scalar(v) {
    v = String(v).trim();
    if (v.length > 1 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      return v.slice(1, -1).replace(/\\"/g, '"');
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === '' || v === '~' || v === 'null') return '';
    if (v[0] === '[' && v[v.length - 1] === ']') {
      var inner = v.slice(1, -1).trim();
      return inner ? inner.split(',').map(function (x) { return scalar(x); }) : [];
    }
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  }

  function parseFrontMatter(text) {
    text = String(text || '').replace(/\r\n/g, '\n');
    var m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/);
    if (!m) return { data: {}, body: text };
    var data = {}, key = null;
    m[1].split('\n').forEach(function (line) {
      if (!line.trim() || line.trim()[0] === '#') return;
      var item = line.match(/^\s*-\s+(.*)$/);
      if (item && key) {
        if (!Array.isArray(data[key])) data[key] = [];
        data[key].push(scalar(item[1]));
        return;
      }
      var kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        key = kv[1];
        data[key] = kv[2].trim() === '' ? [] : scalar(kv[2]);
      }
    });
    return { data: data, body: text.slice(m[0].length) };
  }

  function yamlValue(v) {
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    var s = String(v == null ? '' : v);
    if (s === '') return "''";
    if (/^[\wа-яё .\/,()«»—–-]+$/i.test(s) && s[0] !== ' ' && s[s.length - 1] !== ' ') return s;
    return JSON.stringify(s);
  }

  function buildFrontMatter(order, data) {
    var lines = ['---'];
    order.forEach(function (key) {
      var v = data[key];
      if (Array.isArray(v)) {
        if (!v.length) { lines.push(key + ': []'); return; }
        lines.push(key + ':');
        v.forEach(function (item) { lines.push('  - ' + yamlValue(item)); });
      } else {
        lines.push(key + ': ' + yamlValue(v));
      }
    });
    lines.push('---', '');
    return lines.join('\n');
  }

  /* --------------------------------------------------------------- schema */
  var HOME_SCHEMA = [
    { key: 'hero', title: 'Первый экран', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок (можно <em>)', 'area'],
      ['subtitle', 'Подзаголовок', 'area'],
      ['badge1', 'Бейдж 1'], ['badge2', 'Бейдж 2'], ['badge3', 'Бейдж 3'], ['badge4', 'Бейдж 4'],
      ['btn1', 'Кнопка 1'], ['btn2', 'Кнопка 2'], ['scroll', 'Текст «вниз»']
    ]},
    { key: 'homePortfolio', title: 'Блок «Портфолио» на главной', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок', 'area'], ['subtitle', 'Описание', 'area'],
      ['ctaTitle', 'Заголовок CTA', 'area'], ['ctaSub', 'Описание CTA', 'area'], ['ctaBtn', 'Кнопка']
    ]},
    { key: 'tpk', title: 'Проект под ключ', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок', 'area'], ['subtitle', 'Описание', 'area'],
      ['cards', 'Карточки', 'list', [['num', 'Номер'], ['icon', 'Иконка (эмодзи)'], ['title', 'Заголовок'], ['text', 'Текст', 'area']]]
    ]},
    { key: 'steps', title: 'Этапы работы', fields: [
      ['title', 'Заголовок', 'area'], ['lead', 'Описание', 'area'],
      ['items', 'Шаги', 'list', [['num', 'Номер'], ['title', 'Заголовок'], ['text', 'Текст']]]
    ]},
    { key: 'production', title: 'Производство (две колонки)', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок', 'area'], ['text', 'Текст', 'area'],
      ['image', 'Фото', 'image'], ['caption', 'Подпись к фото'],
      ['items', 'Пункты', 'list', [['num', 'Номер'], ['title', 'Заголовок'], ['text', 'Текст']]]
    ]},
    { key: 'faq', title: 'Частые вопросы', fields: [
      ['title', 'Заголовок'], ['subtitle', 'Описание', 'area'],
      ['items', 'Вопросы', 'list', [['q', 'Вопрос'], ['a', 'Ответ', 'area']], 'Вопрос']
    ]},
    { key: 'showroom', title: 'Шоурум', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок'], ['text', 'Текст', 'area'],
      ['badge', 'Бейдж'], ['btn', 'Кнопка']
    ]},
    { key: 'cta', title: 'Блок «Отправьте размеры»', fields: [
      ['title', 'Заголовок', 'area'], ['sub', 'Описание', 'area'],
      ['button', 'Кнопка 1'], ['button2', 'Кнопка 2'], ['image', 'Фон', 'image']
    ]},
    { key: 'articlesBlock', title: 'Блок «Статьи» на главной', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок', 'area'], ['lead', 'Описание', 'area']
    ]},
    { key: 'standardsBlock', title: 'Блок «Стандарты» на главной', fields: [
      ['eyebrow', 'Надстрочник'], ['title', 'Заголовок', 'area'], ['lead', 'Описание', 'area']
    ]},
    { key: 'common', title: 'Контакты и подвал', fields: [
      ['phone1', 'Телефон 1'], ['phone2', 'Телефон 2'], ['hours', 'Часы работы'],
      ['tg', 'Telegram (без @)'], ['tagline', 'Текст в подвале', 'area'], ['copyright', 'Копирайт']
    ]}
  ];


  /* ---------------------------------------------------------- компоненты */
  function fieldText(label, value, onChange, type) {
    var input = el(type === 'area' ? 'textarea' : 'input', {
      class: type === 'area' ? 'fld__area' : 'fld__input'
    });
    if (type === 'area') input.value = value == null ? '' : String(value);
    else { input.setAttribute('type', 'text'); input.value = value == null ? '' : String(value); }
    input.addEventListener('input', function () { onChange(input.value); });
    return el('label', { class: 'fld' }, el('span', { class: 'fld__label', text: label }), input);
  }

  function fieldSelect(label, value, options, onChange) {
    var sel = el('select', { class: 'fld__sel' });
    [''].concat(options).forEach(function (opt) {
      var o = el('option', { value: opt, text: opt || '— не выбрано —' });
      if (opt === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return el('label', { class: 'fld' }, el('span', { class: 'fld__label', text: label }), sel);
  }

  function fieldCheck(label, value, onChange, hint) {
    var box = el('input', { type: 'checkbox' });
    box.checked = !!value;
    box.addEventListener('change', function () { onChange(box.checked); });
    return el('label', { class: 'fld' },
      el('span', { class: 'row' }, box, el('span', { text: label })),
      hint ? el('span', { class: 'fld__hint', text: hint }) : null);
  }

  function fieldChips(label, values, options, onChange) {
    var current = (values || []).slice();
    var wrap = el('div', { class: 'chips' });
    options.forEach(function (opt) {
      var chip = el('button', { type: 'button', class: 'chip' + (current.indexOf(opt) !== -1 ? ' is-on' : ''), text: opt });
      chip.addEventListener('click', function () {
        var i = current.indexOf(opt);
        if (i === -1) current.push(opt); else current.splice(i, 1);
        chip.classList.toggle('is-on', i === -1);
        onChange(current.slice());
      });
      wrap.appendChild(chip);
    });
    return el('div', { class: 'fld' }, el('span', { class: 'fld__label', text: label }), wrap);
  }

  function fieldImage(label, value, onChange) {
    var wrap = el('div', { class: 'fld' });
    wrap.appendChild(el('span', { class: 'fld__label', text: label }));
    var preview = el('div', { class: 'photos', style: 'max-width:220px' });
    var input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });

    function paint() {
      clear(preview);
      if (value) {
        preview.appendChild(el('div', { class: 'photo' },
          el('img', { src: '/' + String(value).replace(/^\//, ''), alt: '' }),
          el('div', { class: 'photo__tools' },
            el('button', { type: 'button', class: 'photo__btn', text: 'Заменить', onclick: function () { input.click(); } }),
            el('button', { type: 'button', class: 'photo__btn', text: 'Удалить', onclick: function () { value = ''; onChange(''); paint(); } })
          )));
      } else {
        preview.appendChild(el('button', { type: 'button', class: 'photo photo--add', text: '+ Загрузить', onclick: function () { input.click(); } }));
      }
    }
    input.addEventListener('change', async function () {
      var file = input.files[0];
      if (!file) return;
      try {
        busy(true, 'Загружаю фото…');
        var name = slugify(file.name.replace(/\.[^.]+$/, '')) + '-' + Date.now().toString(36) + '.' + (file.name.split('.').pop() || 'jpg');
        var path = 'images/uploads/' + name;
        await putBinary(path, file, 'image: ' + name);
        value = path;
        onChange(path);
        paint();
        toast('Фото загружено', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      } finally { busy(false); input.value = ''; }
    });
    paint();
    wrap.appendChild(preview);
    wrap.appendChild(input);
    return wrap;
  }

  function stringListField(label, values, onChange, placeholder) {
    var current = (values || []).filter(Boolean).slice();
    var box = el('div', { class: 'fld' });
    box.appendChild(el('span', { class: 'fld__label', text: label }));
    var list = el('div', { class: 'chips' });
    function paint() {
      clear(list);
      current.forEach(function (v, i) {
        var chip = el('span', { class: 'chip is-on', text: v + ' ' });
        var x = el('button', { type: 'button', style: 'background:none;border:0;color:inherit;cursor:pointer;padding:0 0 0 6px', text: '✕' });
        x.addEventListener('click', function () { current.splice(i, 1); onChange(current.slice()); paint(); });
        chip.appendChild(x);
        list.appendChild(chip);
      });
    }
    var input = el('input', { class: 'fld__input', placeholder: placeholder || 'Добавить…' });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        current.push(input.value.trim());
        input.value = '';
        onChange(current.slice());
        paint();
      }
    });
    paint();
    box.appendChild(list);
    box.appendChild(input);
    return box;
  }

  function listField(label, items, itemFields, onChange, itemWord) {
    var current = Array.isArray(items) ? items.slice() : [];
    var box = el('div', { class: 'fld' });
    box.appendChild(el('span', { class: 'fld__label', text: label }));
    var list = el('div', { style: 'display:grid;gap:10px' });

    function move(i, dir) {
      var j = i + dir;
      if (j < 0 || j >= current.length) return;
      var tmp = current[i]; current[i] = current[j]; current[j] = tmp;
      onChange(current.slice());
      paint();
    }

    function paint() {
      clear(list);
      current.forEach(function (item, i) {
        var head = el('div', { class: 'li__head' },
          el('span', { class: 'li__num', text: String(i + 1).padStart(2, '0') }),
          el('div', { class: 'li__tools' },
            el('button', { type: 'button', class: 'iconbtn', title: 'Выше', text: '↑', onclick: function () { move(i, -1); } }),
            el('button', { type: 'button', class: 'iconbtn', title: 'Ниже', text: '↓', onclick: function () { move(i, 1); } }),
            el('button', {
              type: 'button', class: 'iconbtn iconbtn--danger', title: 'Удалить', text: '✕',
              onclick: function () {
                if (!confirmDialog('Удалить ' + (itemWord || 'элемент') + '?')) return;
                current.splice(i, 1); onChange(current.slice()); paint();
              }
            })
          )
        );
        var body = el('div', { style: 'display:grid;gap:10px' });
        itemFields.forEach(function (f) {
          var key = f[0], flabel = f[1], ftype = f[2] || 'text';
          body.appendChild(fieldText(flabel, item[key], function (v) { item[key] = v; onChange(current.slice()); }, ftype));
        });
        list.appendChild(el('div', { class: 'li' }, head, body));
      });
      list.appendChild(el('button', {
        type: 'button', class: 'btn btn--sm btn--ghost', text: '+ Добавить',
        onclick: function () {
          var blank = {};
          itemFields.forEach(function (f) { blank[f[0]] = ''; });
          if (itemFields.some(function (f) { return f[0] === 'num'; })) blank.num = String(current.length + 1).padStart(2, '0');
          current.push(blank);
          onChange(current.slice());
          paint();
        }
      }));
    }
    paint();
    box.appendChild(list);
    return box;
  }

  function cardNode(title, bodyNodes, opened) {
    var body = el('div', { class: 'card__body' }, bodyNodes);
    var card = el('div', { class: 'card' + (opened === false ? ' is-closed' : '') });
    var head = el('div', { class: 'card__head' },
      el('h2', { text: title }),
      el('span', { class: 'card__chev', text: '▾' })
    );
    head.addEventListener('click', function () { card.classList.toggle('is-closed'); });
    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  /* --------------------------------------------------------------- главная */
  function renderHome() {
    var box = clear($('#content'));
    box.appendChild(el('p', { class: 'help', text: 'Все тексты главной страницы. После сохранения сайт пересоберётся автоматически — обновление займёт 1–2 минуты.' }));

    HOME_SCHEMA.forEach(function (section) {
      state.site[section.key] = state.site[section.key] || {};
      var obj = state.site[section.key];
      var nodes = section.fields.map(function (f) {
        var key = f[0], label = f[1], type = f[2] || 'text';
        if (type === 'list') return listField(label, obj[key], f[3], function (v) { obj[key] = v; markDirty(); }, f[4]);
        if (type === 'image') return fieldImage(label, obj[key], function (v) { obj[key] = v; markDirty(); });
        return fieldText(label, obj[key], function (v) { obj[key] = v; markDirty(); }, type);
      });
      box.appendChild(cardNode(section.title, nodes, section.key === 'hero' || section.key === 'tpk' || section.key === 'faq'));
    });
  }

  /* ------------------------------------------------------------- портфолио */
  function projectCardHtml(p) {
    var img = p.cover ? el('img', { class: 'item__img', src: '/' + p.cover.replace(/^\//, ''), alt: '', loading: 'lazy' })
      : el('div', { class: 'item__img' });
    var meta = [p.type, p.materials.join(', '), p.price ? p.price + ' ₽' : ''].filter(Boolean).join(' · ');
    var pills = [];
    if (p.featured) pills.push(el('span', { class: 'pill pill--feat', text: 'на главной' }));
    if (p.draft) pills.push(el('span', { class: 'pill pill--draft', text: 'черновик' }));

    return el('div', { class: 'item' },
      img,
      el('div', {},
        el('h3', { class: 'item__title', text: p.title || '(без названия)' }),
        el('div', { class: 'item__meta' }, el('span', { text: meta }), pills)
      ),
      el('div', { class: 'item__tools' },
        el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: 'Изменить', onclick: function () { openProject(p.slug); } }),
        el('a', { class: 'btn btn--sm btn--ghost', href: '/portfolio/' + p.slug + '.html', target: '_blank', rel: 'noopener', text: '↗' }),
        el('button', {
          type: 'button', class: 'btn btn--sm btn--danger', text: 'Удалить',
          onclick: function () { removeProject(p); }
        })
      )
    );
  }

  function renderProjects() {
    var box = clear($('#content'));
    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('button', { type: 'button', class: 'btn btn--sm btn--solid', text: '+ Новый проект', onclick: function () { openProject(null); } }),
      el('div', { class: 'spacer' }),
      el('span', { class: 'help', text: 'Проектов: ' + state.projects.length })
    ));
    if (!state.projects.length) {
      box.appendChild(el('div', { class: 'empty', text: 'Проектов пока нет' }));
      return;
    }
    var list = el('div', { class: 'list' });
    state.projects.forEach(function (p) { list.appendChild(projectCardHtml(p)); });
    box.appendChild(list);
  }

  function blankProject() {
    return {
      slug: '', title: '', type: 'Кухня', featured: false, draft: true, style: '',
      materials: [], layouts: [], price: '', description: '',
      facades: '', countertop: '', hardware: '', equipment: '',
      cover: '', gallery: []
    };
  }

  function openProject(slug) {
    var p = slug ? state.projects.filter(function (x) { return x.slug === slug; })[0] : null;
    var data = p ? JSON.parse(JSON.stringify(p)) : blankProject();
    state.editing = { kind: 'project', data: data, originalSlug: p ? p.slug : null, isNew: !p };
    state.page = 'project';
    renderProjectEditor();
    markDirty(false);
  }

  function renderProjectEditor() {
    var box = clear($('#content'));
    var d = state.editing.data;

    $('#page-title').textContent = state.editing.isNew ? 'Новый проект' : 'Проект';
    $('#page-sub').textContent = d.title || 'Заполните поля и сохраните';

    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: '← К списку', onclick: function () { state.page = 'projects'; markDirty(false); renderProjects(); } }),
      el('div', { class: 'spacer' }),
      state.editing.isNew ? null : el('a', { class: 'btn btn--sm btn--ghost', href: '/portfolio/' + state.editing.originalSlug + '.html', target: '_blank', rel: 'noopener', text: 'Открыть на сайте ↗' })
    ));

    var basic = cardNode('Основное', [
      fieldText('Название', d.title, function (v) { d.title = v; if (!state.editing.originalSlug) d.slug = slugify(v); markDirty(); $('#page-sub').textContent = v; }),
      el('div', { class: 'grid2' },
        fieldText('Slug (латиница, имя файла)', d.slug, function (v) { d.slug = v; markDirty(); }),
        fieldSelect('Тип', d.type, TYPES, function (v) { d.type = v; markDirty(); })
      ),
      el('div', { class: 'grid2' },
        fieldCheck('Показать на главной (до 4 проектов)', d.featured, function (v) { d.featured = v; markDirty(); }),
        fieldCheck('Черновик (не публиковать)', d.draft, function (v) { d.draft = v; markDirty(); }, 'Проект не появится в портфолио')
      ),
      fieldText('Цена, ₽', d.price, function (v) { d.price = String(v).replace(/[^\d]/g, ''); markDirty(); })
    ]);

    var specs = cardNode('Характеристики', [
      fieldChips('Материалы фасадов', d.materials, MATERIALS, function (v) { d.materials = v; markDirty(); }),
      fieldChips('Планировка', d.layouts, LAYOUTS, function (v) { d.layouts = v; markDirty(); }),
      fieldText('Описание (текст на странице)', d.description, function (v) { d.description = v; markDirty(); }, 'area'),
      el('div', { class: 'grid2' },
        fieldText('Фасады подробно', d.facades, function (v) { d.facades = v; markDirty(); }),
        fieldText('Столешница', d.countertop, function (v) { d.countertop = v; markDirty(); })
      ),
      el('div', { class: 'grid2' },
        fieldText('Фурнитура', d.hardware, function (v) { d.hardware = v; markDirty(); }),
        fieldText('Комплектация', d.equipment, function (v) { d.equipment = v; markDirty(); })
      ),
      fieldText('Стиль', d.style, function (v) { d.style = v; markDirty(); })
    ]);

    var photosCard = cardNode('Фотографии', [projectPhotos(d)]);

    box.appendChild(basic);
    box.appendChild(specs);
    box.appendChild(photosCard);
  }

  function projectPhotos(d) {
    var wrap = el('div', { class: 'fld' });
    wrap.appendChild(el('p', { class: 'card__hint', text: 'Первое фото — обложка. Остальные попадут в галерею проекта.' }));
    var grid = el('div', { class: 'photos', style: 'margin-top:10px' });
    var input = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });

    function setCover(path) {
      d.gallery = (d.gallery || []).filter(function (g) { return g !== path; });
      if (d.cover && d.cover !== path) d.gallery.unshift(d.cover);
      d.cover = path;
      markDirty(); paint();
    }
    function removePhoto(path) {
      if (d.cover === path) d.cover = (d.gallery || []).shift() || '';
      else d.gallery = (d.gallery || []).filter(function (g) { return g !== path; });
      markDirty(); paint();
    }

    function paint() {
      clear(grid);
      if (d.cover) grid.appendChild(photoTile(d.cover, true));
      (d.gallery || []).forEach(function (g) { grid.appendChild(photoTile(g, false)); });
      grid.appendChild(el('button', {
        type: 'button', class: 'photo photo--add', text: '+ Добавить фото',
        onclick: function () { input.click(); }
      }));
    }

    function photoTile(path, isCover) {
      return el('div', { class: 'photo' },
        el('img', { src: '/' + String(path).replace(/^\//, ''), alt: '', loading: 'lazy' }),
        isCover ? el('span', { class: 'photo__badge', text: 'обложка' }) : null,
        el('div', { class: 'photo__tools' },
          isCover ? el('button', { type: 'button', class: 'photo__btn', text: '↑', title: 'Вверх', onclick: function () { moveUp(path); } })
            : el('button', { type: 'button', class: 'photo__btn', text: 'Обложка', onclick: function () { setCover(path); } }),
          el('button', { type: 'button', class: 'photo__btn', text: '✕', onclick: function () { removePhoto(path); } })
        )
      );
    }

    function moveUp(path) {
      var i = (d.gallery || []).indexOf(path);
      if (i > 0) { d.gallery.splice(i, 1); d.gallery.unshift(path); markDirty(); paint(); }
    }

    input.addEventListener('change', async function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (!files.length) return;
      try {
        busy(true, 'Загружаю фото…');
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          var ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
          var base = slugify(d.slug || d.title || 'project');
          var name = base + '-' + Date.now().toString(36) + '-' + i + '.' + ext;
          var path = 'images/uploads/' + name;
          await putBinary(path, f, 'image: ' + name);
          if (!d.cover) d.cover = path; else (d.gallery = d.gallery || []).push(path);
        }
        markDirty(); paint();
        toast('Фото загружены', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { busy(false); input.value = ''; }
    });

    paint();
    wrap.appendChild(grid);
    wrap.appendChild(input);
    return wrap;
  }

  async function saveProject() {
    var d = state.editing.data;
    if (!d.title) { toast('Введите название проекта', 'err'); return; }
    if (!d.slug) d.slug = slugify(d.title);
    if (!/^[a-z0-9-]+$/.test(d.slug)) { toast('Slug: только латиница, цифры и дефис', 'err'); return; }

    var order = ['slug', 'title', 'featured', 'type', 'style', 'layout', 'material', 'price', 'description', 'cover', 'gallery', 'facades', 'countertop', 'hardware', 'equipment', 'island', 'draft'];
    var payload = {
      slug: d.slug,
      title: d.title,
      featured: !!d.featured,
      type: d.type || 'Кухня',
      style: d.style || '',
      layout: (d.layouts || []).join(', '),
      material: d.materials || [],
      price: Number(d.price || 0),
      description: d.description || '',
      cover: d.cover ? '/' + String(d.cover).replace(/^\//, '') : '',
      gallery: (d.gallery || []).map(function (g) { return '/' + String(g).replace(/^\//, ''); }),
      facades: d.facades || '',
      countertop: d.countertop || '',
      hardware: d.hardware || '',
      equipment: d.equipment || '',
      island: (d.layouts || []).indexOf('С островом') !== -1,
      draft: !!d.draft
    };

    var md = buildFrontMatter(order, payload) + '\n';
    try {
      busy(true, 'Сохраняю проект…');
      await putFile('_projects/' + d.slug + '.md', md, 'project: ' + d.title);
      if (state.editing.originalSlug && state.editing.originalSlug !== d.slug) {
        await deleteFile('_projects/' + state.editing.originalSlug + '.md', 'rename: ' + d.slug);
      }
      toast('Проект сохранён. Сайт пересоберётся за 1–2 минуты.', 'ok');
      markDirty(false);
      await loadProjects(true);
      state.page = 'projects';
      renderProjects();
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  async function removeProject(p) {
    if (!confirmDialog('Удалить проект «' + p.title + '»? Файл будет удалён из репозитория.')) return;
    try {
      busy(true, 'Удаляю…');
      await deleteFile('_projects/' + p.slug + '.md', 'delete: ' + p.slug);
      toast('Проект удалён', 'ok');
      await loadProjects(true);
      renderProjects();
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  async function loadProjects(force) {
    if (state.projects.length && !force) return;
    var files = (await listDir('_projects')).filter(function (f) { return /\.md$/.test(f.name); });
    var out = [];
    for (var i = 0; i < files.length; i += 8) {
      var chunk = files.slice(i, i + 8);
      var parsed = await Promise.all(chunk.map(async function (f) {
        var res = await fetch(f.download_url, { cache: 'no-cache' });
        var text = await res.text();
        var fm = parseFrontMatter(text).data;
        return {
          slug: fm.slug || f.name.replace(/\.md$/, ''),
          title: fm.title || '',
          type: fm.type || '',
          featured: fm.featured === true,
          draft: fm.draft === true,
          price: fm.price || '',
          materials: Array.isArray(fm.material) ? fm.material : (fm.material ? String(fm.material).split(',').map(function (s) { return s.trim(); }) : []),
          layouts: Array.isArray(fm.layout) ? fm.layout : String(fm.layout || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          cover: String(fm.cover || '').replace(/^\//, ''),
          gallery: (Array.isArray(fm.gallery) ? fm.gallery : []).map(function (g) { return String(g).replace(/^\//, ''); }),
          description: fm.description || '',
          facades: fm.facades || '',
          countertop: fm.countertop || '',
          hardware: fm.hardware || '',
          equipment: fm.equipment || '',
          style: fm.style || '',
          file: f.name
        };
      }));
      out = out.concat(parsed);
    }
    out.sort(function (a, b) { return (a.title || '').localeCompare(b.title || '', 'ru'); });
    state.projects = out;
  }


  /* ---------------------------------------------------------------- статьи */
  function articleCardHtml(a) {
    var img = a.cover ? el('img', { class: 'item__img', src: '/' + a.cover.replace(/^\//, ''), alt: '', loading: 'lazy' })
      : el('div', { class: 'item__img' });
    var pills = [];
    if (a.draft) pills.push(el('span', { class: 'pill pill--draft', text: 'черновик' }));
    return el('div', { class: 'item' },
      img,
      el('div', {},
        el('h3', { class: 'item__title', text: a.title || '(без названия)' }),
        el('div', { class: 'item__meta' },
          el('span', { text: [a.category, a.date].filter(Boolean).join(' · ') }), pills)
      ),
      el('div', { class: 'item__tools' },
        el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: 'Изменить', onclick: function () { openArticle(a.slug); } }),
        el('a', {
          class: 'btn btn--sm btn--ghost', target: '_blank', rel: 'noopener', text: '↗',
          href: (a.draft ? '/preview/' : '/articles/') + a.slug + '.html'
        }),
        el('button', { type: 'button', class: 'btn btn--sm btn--danger', text: 'Удалить', onclick: function () { removeArticle(a); } })
      )
    );
  }

  function renderArticles() {
    var box = clear($('#content'));
    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('button', { type: 'button', class: 'btn btn--sm btn--solid', text: '+ Новая статья', onclick: function () { openArticle(null); } }),
      el('div', { class: 'spacer' }),
      el('span', { class: 'help', text: 'Статей: ' + state.articles.length })
    ));
    if (!state.articles.length) {
      box.appendChild(el('div', { class: 'empty', text: 'Статей пока нет' }));
      return;
    }
    var list = el('div', { class: 'list' });
    state.articles.forEach(function (a) { list.appendChild(articleCardHtml(a)); });
    box.appendChild(list);
  }

  function blankArticle() {
    return {
      slug: '', title: '', h1: '', description: '', lead: '', cover: '', category: 'Цены',
      date: new Date().toISOString().slice(0, 10), updated: '', author: '40/60 Design',
      tags: [], keywords: [], draft: true, body: ''
    };
  }

  function openArticle(slug) {
    var a = slug ? state.articles.filter(function (x) { return x.slug === slug; })[0] : null;
    state.editing = {
      kind: 'article',
      data: a ? JSON.parse(JSON.stringify(a)) : blankArticle(),
      originalSlug: a ? a.slug : null,
      isNew: !a
    };
    state.page = 'article';
    renderArticleEditor();
    markDirty(false);
  }

  function renderArticleEditor() {
    var box = clear($('#content'));
    var d = state.editing.data;
    $('#page-title').textContent = state.editing.isNew ? 'Новая статья' : 'Статья';
    $('#page-sub').textContent = d.title || 'Заполните поля и сохраните';

    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: '← К списку', onclick: function () { state.page = 'articles'; markDirty(false); renderArticles(); } }),
      el('div', { class: 'spacer' }),
      state.editing.isNew ? null : el('a', {
        class: 'btn btn--sm btn--ghost', target: '_blank', rel: 'noopener', text: 'Открыть превью ↗',
        href: (d.draft ? '/preview/' : '/articles/') + state.editing.originalSlug + '.html'
      })
    ));

    box.appendChild(cardNode('Основное', [
      fieldText('Заголовок (Title)', d.title, function (v) { d.title = v; if (!state.editing.originalSlug) d.slug = slugify(v); markDirty(); $('#page-sub').textContent = v; }),
      fieldText('H1', d.h1, function (v) { d.h1 = v; markDirty(); }),
      el('div', { class: 'grid2' },
        fieldText('Slug (латиница)', d.slug, function (v) { d.slug = v; markDirty(); }),
        fieldSelect('Категория', d.category, CATEGORIES, function (v) { d.category = v; markDirty(); })
      ),
      fieldText('Description (140–160 символов)', d.description, function (v) { d.description = v; markDirty(); }, 'area'),
      fieldText('Лид (короткий ответ под H1)', d.lead, function (v) { d.lead = v; markDirty(); }, 'area'),
      fieldText('Дата', d.date, function (v) { d.date = v; markDirty(); }),
      fieldCheck('Черновик (не публиковать)', d.draft, function (v) { d.draft = v; markDirty(); }, 'Страница будет доступна только по адресу /preview/…')
    ]));

    box.appendChild(cardNode('Обложка и теги', [
      fieldImage('Обложка', d.cover, function (v) { d.cover = v; markDirty(); }),
      stringListField('Теги', d.tags, function (v) { d.tags = v; markDirty(); }, 'Добавить тег и Enter'),
      stringListField('Ключевые запросы', d.keywords, function (v) { d.keywords = v; markDirty(); }, 'Добавить запрос и Enter')
    ]));

    var bodyArea = el('textarea', { class: 'fld__area fld__area--code' });
    bodyArea.value = d.body || '';
    bodyArea.addEventListener('input', function () { d.body = bodyArea.value; markDirty(); });
    box.appendChild(cardNode('Текст статьи (Markdown)', [
      el('p', { class: 'card__hint', html: 'Заголовки — <b>## H2</b> и <b>### H3</b>. Списки — через «- ». Фото — <b>![подпись](путь)</b>. Блок «Частые вопросы» собирается из H3.' }),
      bodyArea
    ]));
  }

  async function saveArticle() {
    var d = state.editing.data;
    if (!d.title) { toast('Введите заголовок', 'err'); return; }
    if (!d.slug) d.slug = slugify(d.title);
    if (!/^[a-z0-9-]+$/.test(d.slug)) { toast('Slug: только латиница, цифры и дефис', 'err'); return; }

    var order = ['title', 'h1', 'description', 'lead', 'cover', 'category', 'tags', 'keywords', 'date', 'updated', 'author', 'draft', 'slug'];
    var payload = {
      title: d.title,
      h1: d.h1 || d.title,
      description: d.description || '',
      lead: d.lead || '',
      cover: d.cover ? String(d.cover).replace(/^\//, '') : '',
      category: d.category || 'Цены',
      tags: d.tags || [],
      keywords: d.keywords || [],
      date: d.date || new Date().toISOString().slice(0, 10),
      updated: new Date().toISOString().slice(0, 10),
      author: d.author || '40/60 Design',
      draft: !!d.draft,
      slug: d.slug
    };
    var md = buildFrontMatter(order, payload) + (d.body || '') + '\n';

    try {
      busy(true, 'Сохраняю статью…');
      await putFile('_articles/' + d.slug + '.md', md, 'article: ' + d.title);
      if (state.editing.originalSlug && state.editing.originalSlug !== d.slug) {
        await deleteFile('_articles/' + state.editing.originalSlug + '.md', 'rename: ' + d.slug);
      }
      toast('Статья сохранена. Страница появится через 1–2 минуты.', 'ok');
      markDirty(false);
      await loadArticles(true);
      state.page = 'articles';
      renderArticles();
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  async function removeArticle(a) {
    if (!confirmDialog('Удалить статью «' + a.title + '»?')) return;
    try {
      busy(true, 'Удаляю…');
      await deleteFile('_articles/' + a.slug + '.md', 'delete: ' + a.slug);
      toast('Статья удалена', 'ok');
      await loadArticles(true);
      renderArticles();
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  async function loadArticles(force) {
    if (state.articles.length && !force) return;
    var files = (await listDir('_articles')).filter(function (f) { return /\.md$/.test(f.name); });
    var out = [];
    for (var i = 0; i < files.length; i += 8) {
      var chunk = files.slice(i, i + 8);
      var parsed = await Promise.all(chunk.map(async function (f) {
        var res = await fetch(f.download_url, { cache: 'no-cache' });
        var text = await res.text();
        var fm = parseFrontMatter(text);
        return {
          slug: fm.data.slug || f.name.replace(/\.md$/, ''),
          title: fm.data.title || '',
          h1: fm.data.h1 || '',
          description: fm.data.description || '',
          lead: fm.data.lead || '',
          cover: String(fm.data.cover || ''),
          category: fm.data.category || '',
          date: fm.data.date || '',
          tags: Array.isArray(fm.data.tags) ? fm.data.tags : [],
          keywords: Array.isArray(fm.data.keywords) ? fm.data.keywords : [],
          draft: fm.data.draft === true,
          author: fm.data.author || '',
          body: fm.body.replace(/^\n+/, '').replace(/\s+$/, ''),
          file: f.name
        };
      }));
      out = out.concat(parsed);
    }
    out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    state.articles = out;
  }

  /* --------------------------------------------------------------- страницы */
  var DOCS = [
    { id: 'about', file: '_content/about.md', title: 'Страница «О нас»' },
    { id: 'warranty', file: '_content/warranty.md', title: 'Страница «Гарантия»' },
    { id: 'partners', file: '_content/partners.md', title: 'Страница «Партнёрам»' },
    { id: 'standards', file: '_content/standards.md', title: 'Страница «Стандарты»' },
    { id: 'requirements', file: '_content/requirements.md', title: 'Страница «Требования к мебели»' }
  ];

  function renderPages() {
    var box = clear($('#content'));
    box.appendChild(el('p', { class: 'help', text: 'Документы-страницы: стандарты производства и требования к мебели. Текст в Markdown.' }));
    DOCS.forEach(function (doc) {
      box.appendChild(cardNode(doc.title, [
        el('p', { class: 'card__hint', text: doc.file }),
        el('button', {
          type: 'button', class: 'btn btn--sm', text: 'Редактировать',
          onclick: function () { openDoc(doc); }
        })
      ], false));
    });
  }

  async function openDoc(doc) {
    try {
      busy(true, 'Загружаю документ…');
      var file = await getFile(doc.file);
      if (!file) throw new Error('Файл не найден');
      var fm = parseFrontMatter(file.text);
      state.editing = { kind: 'doc', doc: doc, data: fm.data, body: fm.body.replace(/^\n+/, ''), sha: file.sha };
      state.page = 'doc';
      renderDocEditor();
      markDirty(false);
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  function renderDocEditor() {
    var box = clear($('#content'));
    var d = state.editing.data;
    $('#page-title').textContent = state.editing.doc.title;
    $('#page-sub').textContent = state.editing.doc.file;

    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' },
      el('button', { type: 'button', class: 'btn btn--sm btn--ghost', text: '← Назад', onclick: function () { state.page = 'pages'; markDirty(false); renderPages(); } })
    ));

    box.appendChild(cardNode('Заголовки и описание', [
      fieldText('Title', d.title, function (v) { d.title = v; markDirty(); }),
      fieldText('H1', d.h1, function (v) { d.h1 = v; markDirty(); }),
      fieldText('SEO-заголовок', d.seo_title, function (v) { d.seo_title = v; markDirty(); }),
      fieldText('Description', d.description, function (v) { d.description = v; markDirty(); }, 'area'),
      fieldText('Надстрочник', d.eyebrow, function (v) { d.eyebrow = v; markDirty(); }),
      fieldText('Лид', d.lead, function (v) { d.lead = v; markDirty(); }, 'area')
    ]));

    var area = el('textarea', { class: 'fld__area fld__area--code' });
    area.value = state.editing.body;
    area.addEventListener('input', function () { state.editing.body = area.value; markDirty(); });
    box.appendChild(cardNode('Текст (Markdown)', [area]));
  }

  async function saveDoc() {
    var e = state.editing;
    var order = ['title', 'h1', 'seo_title', 'description', 'eyebrow', 'lead', 'date', 'form'];
    var data = Object.assign({}, e.data);
    var md = buildFrontMatter(order, data) + (e.body || '') + '\n';
    try {
      busy(true, 'Сохраняю…');
      await putFile(e.doc.file, md, 'doc: ' + e.doc.id, e.sha);
      toast('Документ сохранён', 'ok');
      markDirty(false);
    } catch (err) { toast(err.message, 'err'); }
    finally { busy(false); }
  }

  /* ----------------------------------------------------------- фотографии */
  function renderPhotos() {
    var box = clear($('#content'));
    box.appendChild(el('p', { class: 'help', text: 'Ключевые фотографии сайта. Замена сразу уходит в репозиторий, страницы пересоберутся автоматически.' }));
    var grid = el('div', { class: 'photos' });
    SITE_IMAGES.forEach(function (pair) {
      var path = pair[0], label = pair[1];
      var input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      var tile = el('div', { class: 'photo' },
        el('img', { src: '/' + path, alt: '', loading: 'lazy' }),
        el('div', { class: 'photo__tools' },
          el('button', { type: 'button', class: 'photo__btn', text: 'Заменить', onclick: function () { input.click(); } })
        )
      );
      input.addEventListener('change', async function () {
        var file = input.files[0];
        if (!file) return;
        try {
          busy(true, 'Загружаю…');
          await putBinary(path, file, 'image: ' + path);
          tile.querySelector('img').src = '/' + path + '?t=' + Date.now();
          toast('Фото заменено', 'ok');
        } catch (e) { toast(e.message, 'err'); }
        finally { busy(false); input.value = ''; }
      });
      var wrap = el('div', {}, tile, el('p', { class: 'split__caption', style: 'margin:6px 0 0', text: label }));
      wrap.appendChild(input);
      grid.appendChild(wrap);
    });
    box.appendChild(grid);
  }

  /* ------------------------------------------------------- визуальный режим */
  var VIS_PAGES = [
    ['index.html', 'Главная'],
    ['portfolio.html', 'Портфолио'],
    ['about.html', 'О нас'],
    ['warranty.html', 'Гарантия'],
    ['partners.html', 'Партнёрам']
  ];

  function renderVisual() {
    var box = clear($('#content'));
    var select = el('select', { class: 'fld__sel' });
    VIS_PAGES.forEach(function (p) {
      select.appendChild(el('option', { value: p[0], text: p[1] }));
    });
    var frame = el('iframe', { src: '../' + VIS_PAGES[0][0], title: 'Предпросмотр' });
    var frameBox = el('div', { class: 'visual__frame' }, frame);

    // страница рендерится в десктопной ширине и масштабируется под колонку
    function fitFrame() {
      var w = frameBox.clientWidth || 900;
      var scale = Math.min(1, w / 1440);
      frame.style.transform = 'scale(' + scale + ')';
      frameBox.style.height = Math.min(window.innerHeight * 0.78, 900 * scale + 2) + 'px';
    }
    window.addEventListener('resize', fitFrame);
    setTimeout(fitFrame, 60);
    var pathEl = el('div', { class: 'visual__path', text: 'Кликните по тексту на странице' });
    var area = el('textarea', { class: 'fld__area', style: 'min-height:120px' });
    var saveBtn = el('button', { type: 'button', class: 'btn btn--sm btn--solid', text: 'Сохранить текст', disabled: 'disabled' });
    var activeNode = null;
    var activePath = null;

    function selectNode(node) {
      if (activeNode) activeNode.classList.remove('is-active');
      activeNode = node;
      activePath = node.getAttribute('data-cms');
      node.classList.add('is-active');
      pathEl.textContent = activePath;
      area.value = node.innerHTML;
      saveBtn.disabled = false;
    }

    saveBtn.addEventListener('click', async function () {
      if (!activePath) return;
      setPath(state.site, activePath, area.value);
      markDirty(true);
      await saveSite();
      if (activeNode) activeNode.innerHTML = area.value;
    });

    frame.addEventListener('load', function () {
      fitFrame();
      try {
        var doc = frame.contentDocument;
        state.visualDoc = doc;
        var nodes = doc.querySelectorAll('[data-cms]');
        Array.prototype.forEach.call(nodes, function (n) {
          n.classList.add('cms-hit');
          n.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            selectNode(n);
          }, true);
        });
        if (!nodes.length) pathEl.textContent = 'На этой странице нет редактируемых текстов';
      } catch (e) {
        pathEl.textContent = 'Не удалось открыть страницу';
      }
    });

    select.addEventListener('change', function () {
      frame.src = '../' + select.value + '?t=' + Date.now();
      activeNode = null; activePath = null;
      pathEl.textContent = 'Кликните по тексту на странице';
      area.value = ''; saveBtn.disabled = true;
    });

    box.appendChild(el('div', { class: 'row', style: 'margin-bottom:12px' },
      el('span', { class: 'help', text: 'Страница:' }), select,
      el('div', { class: 'spacer' }),
      el('span', { class: 'help', text: 'Пунктиром обведены тексты, которые можно править' })
    ));
    box.appendChild(el('div', { class: 'visual' },
      frameBox,
      el('div', { class: 'visual__panel' },
        el('p', { class: 'fld__label', text: 'Выбранный текст' }),
        pathEl,
        area,
        saveBtn,
        el('p', { class: 'help', text: 'Можно вставлять HTML: <em>курсив</em>, <b>жирный</b>, <br>.' })
      )
    ));
  }

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  /* ---------------------------------------------------------------- сохранение */
  async function saveSite() {
    try {
      busy(true, 'Сохраняю тексты…');
      var text = JSON.stringify(state.site, null, 2) + '\n';
      await putFile('_data/site.json', text, 'content: site.json');
      toast('Сохранено. Сайт обновится через 1–2 минуты.', 'ok');
      markDirty(false);
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  }

  function saveCurrent() {
    if (state.page === 'home' || state.page === 'visual') return saveSite();
    if (state.page === 'project') return saveProject();
    if (state.page === 'article') return saveArticle();
    if (state.page === 'doc') return saveDoc();
    return Promise.resolve();
  }

  /* ------------------------------------------------------------------ роутер */
  var TITLES = {
    home: ['Главная', 'Тексты и блоки главной страницы'],
    projects: ['Портфолио', 'Проекты: добавить, изменить, удалить'],
    articles: ['Статьи', 'Публикации блога'],
    pages: ['Страницы', 'Стандарты и требования к мебели'],
    photos: ['Фотографии', 'Замена ключевых изображений сайта'],
    visual: ['Визуальный режим', 'Редактирование текстов прямо на странице']
  };

  async function showPage(page) {
    state.page = page;
    try { history.replaceState(null, '', '#' + page); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('.navi'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-page') === page);
    });
    var t = TITLES[page] || ['', ''];
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];
    markDirty(false);

    try {
      if (page === 'home') { await loadSite(); renderHome(); }
      else if (page === 'projects') { busy(true, 'Загружаю проекты…'); await loadProjects(); renderProjects(); }
      else if (page === 'articles') { busy(true, 'Загружаю статьи…'); await loadArticles(); renderArticles(); }
      else if (page === 'pages') renderPages();
      else if (page === 'photos') renderPhotos();
      else if (page === 'visual') renderVisual();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy(false);
    }
  }

  async function loadSite(force) {
    if (state.site && !force) return;
    var file = await getFile('_data/site.json');
    state.site = file ? JSON.parse(file.text) : {};
    state.siteSha = file ? file.sha : null;
  }

  /* -------------------------------------------------------------------- boot */
  function showApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    var initial = (location.hash || '').replace('#', '');
    showPage(TITLES[initial] ? initial : 'home');
  }

  async function checkToken() {
    var res = await fetch('https://api.github.com/repos/' + state.repo, {
      headers: { authorization: 'Bearer ' + state.token, accept: 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Токен не подошёл (401)' : 'Репозиторий недоступен (' + res.status + ')');
    var data = await res.json();
    if (!data.permissions || (!data.permissions.push && !data.permissions.admin)) {
      throw new Error('У токена нет права записи (Contents: Read and write)');
    }
    return data;
  }

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    state.token = $('#in-token').value.trim();
    state.repo = $('#in-repo').value.trim();
    state.branch = $('#in-branch').value.trim() || 'main';
    var err = $('#login-err');
    err.hidden = true;
    try {
      busy(true, 'Проверяю доступ…');
      await checkToken();
      localStorage.setItem('cms.token', state.token);
      localStorage.setItem('cms.repo', state.repo);
      localStorage.setItem('cms.branch', state.branch);
      busy(false);
      showApp();
    } catch (ex) {
      busy(false);
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#logout').addEventListener('click', function () {
    localStorage.removeItem('cms.token');
    location.reload();
  });

  $('#btn-save').addEventListener('click', saveCurrent);
  $('#btn-refresh').addEventListener('click', async function () {
    try {
      busy(true, 'Обновляю…');
      if (state.page === 'home') { await loadSite(true); renderHome(); }
      if (state.page === 'projects') { await loadProjects(true); renderProjects(); }
      if (state.page === 'articles') { await loadArticles(true); renderArticles(); }
      if (state.page === 'visual') renderVisual();
      markDirty(false);
      toast('Данные обновлены');
    } catch (e) { toast(e.message, 'err'); }
    finally { busy(false); }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.navi'), function (btn) {
    btn.addEventListener('click', function () { showPage(btn.getAttribute('data-page')); });
  });

  $('#open-site').addEventListener('click', function (e) {
    e.preventDefault();
    window.open('../index.html', '_blank');
  });

  // восстановление сессии
  (function boot() {
    var token = localStorage.getItem('cms.token');
    if (!token) {
      // ?preview=1 — посмотреть интерфейс без токена (только чтение, сохранение вернёт 401)
      if (new URLSearchParams(location.search).get('preview') === '1') {
        state.token = '';
        state.repo = localStorage.getItem('cms.repo') || 'stastitov002-arch/4060-site';
        state.branch = localStorage.getItem('cms.branch') || 'main';
        showApp();
      }
      return;
    }
    state.token = token;
    state.repo = localStorage.getItem('cms.repo') || 'stastitov002-arch/4060-site';
    state.branch = localStorage.getItem('cms.branch') || 'main';
    busy(true, 'Проверяю доступ…');
    checkToken().then(function () {
      busy(false);
      showApp();
    }).catch(function (e) {
      busy(false);
      $('#login-err').textContent = e.message;
      $('#login-err').hidden = false;
      localStorage.removeItem('cms.token');
    });
  })();
})();
