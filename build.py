# -*- coding: utf-8 -*-
"""
40/60 Design — статический генератор сайта.

Читает:
  _data/site.json          — общие тексты (переопределяются на клиенте через data-cms)
  _projects/*.md           — проекты портфолио (YAML front matter)
  _articles/*.md           — статьи блога (YAML front matter + markdown)
  _content/standards.md    — страница «Стандарты»
  _content/requirements.md — страница «Требования к мебели»
  _content/pages/*.html    — тела «остальных» страниц (about, partners, warranty, 404)

Пишет:
  index.html, portfolio.html, articles.html, standards.html,
  requirements.html, about.html, warranty.html, partners.html, 404.html,
  portfolio/<slug>.html, articles/<slug>.html, preview/<slug>.html,
  sitemap.xml, robots.txt

Запуск:  python build.py
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

try:  # консоль Windows часто в cp1251 — принудительно UTF-8
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
SITE = "https://4060design.ru"
BRAND = "40/60 Design"
PHONE1 = "+7 901 586-14-88"
PHONE1_HREF = "tel:+79015861488"
PHONE2 = "+7 901 744-88-55"
PHONE2_HREF = "tel:+79017448855"
TG = "https://t.me/design4060"
TG_NAME = "@design4060"

NAV = [
    ("portfolio.html", "Портфолио"),
    ("articles.html", "Статьи"),
    ("standards.html", "Стандарты"),
    ("about.html", "О нас"),
    ("warranty.html", "Гарантия"),
    ("partners.html", "Партнёрам"),
]

MATERIAL_ORDER = ["ЛДСП", "AGT", "Пленка ПВХ", "Пластик", "ALVIC Luxe", "Массив", "Шпон", "Эмаль"]
TYPE_BY_PREFIX = {
    "kitchen": "Кухня",
    "wardrobe": "Гардеробная",
    "bathroom": "Санузел",
    "hallway": "Прихожая",
    "living": "Гостиная",
    "room": "Другое",
}
BUDGETS = [("0", "До 300 000 ₽"), ("1", "300 000–500 000 ₽"), ("2", "От 500 000 ₽")]

DEFAULT_TPK = [
    {"num": "01", "icon": "📞", "title": "Консультация", "text": "Наш дизайнер встретит вас в шоуруме и проконсультирует по материалам."},
    {"num": "02", "icon": "📐", "title": "Замер", "text": "Делаем точный замер на объекте, чтобы мебель встала идеально."},
    {"num": "03", "icon": "📋", "title": "Проект", "text": "Полный проект с учётом пожеланий, особенностей помещения и бюджета."},
    {"num": "04", "icon": "🪑", "title": "Мебель", "text": "Производим корпусную мебель на заказ по индивидуальным размерам из проверенных материалов."},
    {"num": "05", "icon": "🔌", "title": "Техника", "text": "Подбираем и комплектуем кухню надёжной встраиваемой техникой."},
    {"num": "06", "icon": "🧱", "title": "Камень", "text": "Изготавливаем столешницы и фартуки: кварц, акрил, натуральный камень."},
    {"num": "07", "icon": "🚚", "title": "Доставка", "text": "Доставим всё до квартиры в целости — в установленный день."},
    {"num": "08", "icon": "🔧", "title": "Сборка", "text": "Соберём мебель на месте, подключим технику и проверим результат."},
]

DEFAULT_STEPS = [
    {"num": "01", "title": "Знакомство и сбор ТЗ", "text": "Лично или дистанционно."},
    {"num": "02", "title": "Предварительный расчёт", "text": "Бюджет, объёмы, сроки."},
    {"num": "03", "title": "Подбор материалов", "text": "Встреча на нашей выставке."},
    {"num": "04", "title": "Замер объекта", "text": "Выезд специалиста."},
    {"num": "05", "title": "Финальное техническое задание", "text": "Детальная спецификация работ."},
    {"num": "06", "title": "Коммерческое предложение", "text": "Фиксированная стоимость."},
    {"num": "07", "title": "Договор и запуск", "text": "Предоплата и производство."},
    {"num": "08", "title": "Доставка и монтаж", "text": "Технадзор и сборщики."},
    {"num": "09", "title": "Проверка объекта", "text": "Совместный осмотр."},
    {"num": "10", "title": "Подписание актов", "text": "Готовый проект — ваш."},
]

DEFAULT_PROD_ITEMS = [
    {"num": "01", "title": "Замер и проект", "text": "Бесплатно, с учётом коммуникаций"},
    {"num": "02", "title": "Смета", "text": "Фиксированная, без «доплат»"},
    {"num": "03", "title": "Производство", "text": "21 день, фотоотчёт из цеха"},
    {"num": "04", "title": "Монтаж", "text": "Своей бригадой, с уборкой"},
]

DEFAULT_FAQ = [
    {"q": "Сколько стоит выезд дизайнера или замерщика?",
     "a": "Бесплатно на территории Москвы и ближнего Подмосковья. Дизайнер приезжает с образцами материалов, замерщик снимает геометрию помещения."},
    {"q": "Сколько изготавливается мебель?",
     "a": "В среднем 21 день с момента подписания договора и согласования проекта. Сложные проекты с камнем и эмалью — до 35 дней."},
    {"q": "Можно ли собрать мебель самостоятельно?",
     "a": "Можно, но гарантия на монтаж в этом случае не распространяется. Мы рекомендуем сборку нашими сборщиками — это фиксированная доля от стоимости."},
    {"q": "Сколько стоит сборка?",
     "a": "10% от стоимости мебели. В стоимость входит подключение встроенной техники и настройка фурнитуры."},
    {"q": "Что входит в цену кухни?",
     "a": "Корпус, фасады, фурнитура, столешница с выпилами, кромка, доставка и монтаж. Техника, мойка и подъём на этаж без лифта — обсуждаются отдельно."},
]

warnings: list[str] = []


# --------------------------------------------------------------------------
# утилиты
# --------------------------------------------------------------------------

def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=True)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        items = value
    else:
        items = re.split(r"\s*[,;]\s*", str(value))
    out = []
    for item in items:
        clean = str(item).strip().strip('"').strip("'").strip()
        if clean and clean not in out:
            out.append(clean)
    return out


def norm_layouts(values: list[str]) -> list[str]:
    """«Угловая С островом» → «Угловая» + «С островом»; приводит регистр к единому виду."""
    out: list[str] = []
    for raw in values:
        s = re.sub(r"\s+", " ", str(raw)).strip(" ,;")
        if not s:
            continue
        parts = [s]
        m = re.search(r"\s*,?\s*с\s+островом", s, re.I)
        if m:
            head = s[: m.start()].strip(" ,")
            parts = ([head] if head else []) + ["С островом"]
        for part in parts:
            part = part.strip(" ,")
            if not part:
                continue
            if part[0].islower():
                part = part[0].upper() + part[1:]
            if part.lower() in out:
                continue
            out.append(part)
    return out


def money(value) -> str:
    try:
        num = int(float(str(value).replace(" ", "").replace("\u00a0", "")))
    except (TypeError, ValueError):
        return ""
    return f"{num:,}".replace(",", " ") + " ₽"


def budget_key(price) -> str:
    try:
        num = int(float(str(price).replace(" ", "").replace("\u00a0", "")))
    except (TypeError, ValueError):
        return ""
    if num < 300000:
        return "0"
    if num < 500000:
        return "1"
    return "2"


def norm_path(url: str) -> str:
    url = str(url or "").strip()
    if not url:
        return ""
    if url.startswith("http") or url.startswith("data:"):
        return url
    return url.lstrip("/")


def ru_date(value: str) -> str:
    formats = ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y", "%Y/%m/%d")
    for fmt in formats:
        try:
            return datetime.strptime(str(value).strip(), fmt).strftime("%d.%m.%Y")
        except ValueError:
            continue
    return str(value or "")


def iso_date(value: str) -> str:
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(str(value).strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date.today().isoformat()


def sort_key_date(value: str) -> str:
    return iso_date(value)


# --------------------------------------------------------------------------
# YAML-подмножество для front matter
# --------------------------------------------------------------------------

def parse_scalar(raw: str):
    val = raw.strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
        return val[1:-1]
    low = val.lower()
    if low in ("true", "yes"):
        return True
    if low in ("false", "no"):
        return False
    if low in ("", "~", "null"):
        return ""
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [parse_scalar(part) for part in re.split(r",(?![^\[]*\])", inner)]
    return val


def parse_front_matter(text: str) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n")
    match = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*(?:\n|$)(.*)$", text, re.S)
    if not match:
        return {}, text

    meta: dict = {}
    key = None
    for raw in match.group(1).split("\n"):
        if not raw.strip() or raw.strip().startswith("#"):
            continue
        item = re.match(r"^\s*-\s+(.*)$", raw)
        if item and key:
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(parse_scalar(item.group(1)))
            continue
        kv = re.match(r"^([A-Za-z0-9_\-]+)\s*:\s*(.*)$", raw)
        if kv:
            key = kv.group(1)
            value = kv.group(2)
            meta[key] = parse_scalar(value) if value.strip() else []
            continue
        if key and isinstance(meta.get(key), str):
            meta[key] = (meta[key] + " " + raw.strip()).strip()
    return meta, match.group(2)


# --------------------------------------------------------------------------
# Markdown → HTML (достаточно для статей и страниц-документов)
# --------------------------------------------------------------------------

INLINE_CODE = re.compile(r"`([^`]+)`")


def inline_md(text: str) -> str:
    slots: list[str] = []

    def keep(fragment: str) -> str:
        slots.append(fragment)
        return f"\x00{len(slots) - 1}\x00"

    text = INLINE_CODE.sub(lambda m: keep("<code>" + html.escape(m.group(1)) + "</code>"), text)
    text = html.escape(text)

    text = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)",
                  lambda m: keep(f'<img src="{esc(norm_path(m.group(2)))}" alt="{esc(m.group(1))}" loading="lazy" data-fallback>'), text)
    text = re.sub(r"\[([^\]]+)\]\(([^)\s]+)(?:\s+\"([^\"]*)\")?\)",
                  lambda m: keep(f'<a href="{esc(m.group(2))}">{m.group(1)}</a>'), text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"<em>\1</em>", text)
    text = text.replace(" -- ", " — ")

    def restore(match):
        return slots[int(match.group(1))]

    return re.sub(r"\x00(\d+)\x00", restore, text)


def md(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    total = len(lines)

    def is_block_start(s: str) -> bool:
        return bool(
            re.match(r"^#{2,4}\s", s)
            or re.match(r"^```", s)
            or re.match(r"^>\s?", s)
            or re.match(r"^[-*+]\s", s)
            or re.match(r"^\d+\.\s", s)
            or re.match(r"^---+$", s)
            or s.startswith("|")
            or s.startswith("<")
        )

    while i < total:
        raw = lines[i]
        s = raw.strip()

        if not s:
            i += 1
            continue

        if s.startswith("```"):
            i += 1
            buf = []
            while i < total and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>")
            continue

        if s.startswith("<"):
            buf = [raw]
            i += 1
            while i < total and lines[i].strip() and not is_block_start(lines[i].strip()):
                buf.append(lines[i])
                i += 1
            out.append("\n".join(buf))
            continue

        heading = re.match(r"^(#{2,4})\s+(.*)$", s)
        if heading:
            level = len(heading.group(1))
            content = inline_md(heading.group(2).strip())
            anchor = re.sub(r"[^a-zа-я0-9]+", "-", heading.group(2).lower()).strip("-")[:60]
            out.append(f'<h{level} id="{anchor}">{content}</h{level}>')
            i += 1
            continue

        if re.match(r"^---+$", s):
            out.append("<hr>")
            i += 1
            continue

        if s.startswith("|") and i + 1 < total and re.match(r"^\|?[\s:|-]+\|?$", lines[i + 1].strip()):
            header = [c.strip() for c in s.strip("|").split("|")]
            i += 2
            rows = []
            while i < total and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            thead = "".join(f"<th>{inline_md(c)}</th>" for c in header)
            tbody = "".join(
                "<tr>" + "".join(f"<td>{inline_md(c)}</td>" for c in row) + "</tr>" for row in rows
            )
            out.append(f"<table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>")
            continue

        if re.match(r"^[-*+]\s", s):
            items = []
            while i < total and re.match(r"^[-*+]\s", lines[i].strip()):
                items.append(inline_md(re.sub(r"^[-*+]\s+", "", lines[i].strip())))
                i += 1
            out.append("<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>")
            continue

        if re.match(r"^\d+\.\s", s):
            items = []
            while i < total and re.match(r"^\d+\.\s", lines[i].strip()):
                items.append(inline_md(re.sub(r"^\d+\.\s+", "", lines[i].strip())))
                i += 1
            out.append("<ol>" + "".join(f"<li>{x}</li>" for x in items) + "</ol>")
            continue

        if s.startswith(">"):
            buf = []
            while i < total and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^>\s?", "", lines[i].strip()))
                i += 1
            out.append("<blockquote><p>" + inline_md(" ".join(buf)) + "</p></blockquote>")
            continue

        buf = [raw.strip()]
        i += 1
        while i < total and lines[i].strip() and not is_block_start(lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        out.append("<p>" + inline_md(" ".join(buf)) + "</p>")

    return "\n".join(out)


# --------------------------------------------------------------------------
# шаблон страницы
# --------------------------------------------------------------------------

def fonts_link() -> str:
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">\\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\\n'
        '<link href="https://fonts.googleapis.com/css2?'
        'family=Cormorant+Garamond:ital,wght@0,400;1,400&'
        'family=Manrope:wght@400;500&display=swap" rel="stylesheet">'
    )


def head(
    title: str,
    description: str,
    canonical: str,
    page_css: str = "",
    ld: list[dict] | None = None,
    og_image: str = "images/og-cover.jpg",
    extra_head: str = "",
    noindex: bool = False,
    base: str = "",
) -> str:
    ld_html = ""
    for block in ld or []:
        ld_html += '\n<script type="application/ld+json">' + json.dumps(block, ensure_ascii=False, indent=2) + "</script>"
    css_html = ""
    if page_css:
        css_html = "\n<style>\n" + page_css + "\n</style>"
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical)}">
<meta name="lead-endpoint" content="https://hidden-bar-8272form-to-telegram.stas-titov-002.workers.dev">

<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){{m[i]=m[i]||function(){{(m[i].a=m[i].a||[]).push(arguments)}};
    m[i].l=1*new Date();
    for (var j = 0; j < document.scripts.length; j++) {{if (document.scripts[j].src === r) {{ return; }}}}
    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    }})(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=113666449', 'ym');
    ym(113666449, 'init', {{ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true}});
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/113666449" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
<!-- /Yandex.Metrika counter -->

<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-P51ZT8LJPG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-P51ZT8LJPG');
</script>

<link rel="icon" type="image/png" href="{base}favicon-96x96.png" sizes="96x96">
<link rel="icon" type="image/svg+xml" href="{base}favicon.svg">
<link rel="shortcut icon" href="{base}favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="{base}apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="{BRAND}">
<link rel="manifest" href="{base}site.webmanifest">
<meta name="theme-color" content="#0c160e">

<meta property="og:type" content="website">
<meta property="og:site_name" content="{BRAND}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:image" content="{SITE}/{esc(norm_path(og_image))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="{'noindex, nofollow' if noindex else 'index, follow, max-image-preview:large'}">

{fonts_link()}
<link rel="preload" href="{base}css/site.css" as="style">
<link rel="stylesheet" href="{base}css/site.css">{css_html}
{extra_head}
{ld_html}
</head>"""


def brand_block(base: str = "", href: str = "index.html", sub: str = "Мебель на заказ") -> str:
    return f"""    <a class="brand" href="{base}{href}" aria-label="{BRAND} — на главную">
      <img class="brand__mark" src="{base}images/brand-mark-128.png" width="44" height="44" alt="" aria-hidden="true">
      <span class="brand__txt"><span class="brand__name">40/60</span><span class="brand__sub">{esc(sub)}</span></span>
    </a>"""


def header(active: str = "", base: str = "") -> str:
    items = []
    for href, label in NAV:
        current = ' aria-current="page"' if href == active else ""
        items.append(f'<li><a class="nav__link" href="{base}{href}"{current}>{label}</a></li>')
    nav_html = "\n          ".join(items)

    drawer_items = []
    for href, label in NAV:
        current = ' aria-current="page"' if href == active else ""
        drawer_items.append(f'<li><a class="drawer__link" href="{base}{href}"{current}>{label}</a></li>')
    drawer_nav = "\n            ".join(drawer_items)

    return f"""<header class="hdr">
  <div class="hdr__in">
{brand_block(base)}
    <nav class="nav" aria-label="Основная навигация">
      <ul class="nav__list">
          {nav_html}
      </ul>
    </nav>
    <div class="hdr__actions">
      <a class="hdr__phone" href="{PHONE1_HREF}">
        <span class="hdr__phone-num">{PHONE1}</span>
        <span class="hdr__phone-sub">пн–сб 10:00–21:00</span>
      </a>
      <button type="button" class="btn btn--hdr" data-modal-open="lead">Рассчитать</button>
      <button class="burger" type="button" aria-expanded="false" aria-controls="drawer" aria-label="Открыть меню">
        <span class="burger__lines" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="drawer" id="drawer">
    <ul class="drawer__list">
            {drawer_nav}
    </ul>
    <div class="drawer__contacts">
      <a href="{PHONE1_HREF}">{PHONE1}</a>
      <a href="{PHONE2_HREF}">{PHONE2}</a>
      <a href="{TG}" target="_blank" rel="noopener">Telegram {TG_NAME}</a>
      <span>пн–сб 10:00–21:00</span>
    </div>
  </div>
</header>"""


def footer(base: str = "") -> str:
    return f"""<footer class="ftr">
  <div class="ftr__in">
    <div class="ftr__brand">
      {brand_block(base)}
      <p class="ftr__tag" data-cms="common.tagline">Студия интерьерной мебели. Кухни и корпусная мебель на заказ в Москве и области: проектирование, комплектация, производство и монтаж.</p>
    </div>
    <div>
      <p class="ftr__col-title">Разделы</p>
      <ul class="ftr__links">
        <li><a href="{base}portfolio.html">Портфолио</a></li>
        <li><a href="{base}articles.html">Статьи</a></li>
        <li><a href="{base}standards.html">Стандарты</a></li>
        <li><a href="{base}about.html">О компании</a></li>
      </ul>
    </div>
    <div>
      <p class="ftr__col-title">Документы</p>
      <ul class="ftr__links">
        <li><a href="{base}requirements.html">Требования к мебели</a></li>
        <li><a href="{base}warranty.html">Гарантия</a></li>
        <li><a href="{base}partners.html">Партнёрам</a></li>
        <li><button type="button" data-modal-open="lead">Записаться на замер</button></li>
      </ul>
    </div>
    <div>
      <p class="ftr__col-title">Контакты</p>
      <ul class="ftr__links">
        <li><a href="{PHONE1_HREF}">{PHONE1}</a></li>
        <li><a href="{PHONE2_HREF}">{PHONE2}</a></li>
        <li><a href="{TG}" target="_blank" rel="noopener">Telegram {TG_NAME}</a></li>
        <li><span style="opacity:.6">пн–сб 10:00–21:00</span></li>
      </ul>
    </div>
  </div>
  <div class="ftr__bottom">
    <span data-cms="common.copyright">© 2009–<span data-year>2026</span> {BRAND}. Производство мебели на заказ в Москве.</span>
    <span>Москва и Московская область · <a href="{base}requirements.html">Требования к мебели</a></span>
  </div>
</footer>"""


def modals(base: str = "") -> str:
    """Одна модалка заявки и одна модалка «написать нам» на весь сайт."""
    return f"""<div class="modal" id="modal-lead" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="lead-title">
  <div class="modal__bd" data-modal-close></div>
  <div class="modal__dlg">
    <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">✕</button>
    <p class="modal__eyebrow">Заявка</p>
    <h2 class="modal__title" id="lead-title">Рассчитаем стоимость кухни</h2>
    <p class="modal__sub">Оставьте контакт — дизайнер свяжется в течение 15 минут, уточнит размеры и пришлёт смету. Замер и расчёт бесплатны.</p>
    <div class="form-success">
      <div class="form-success__icon">✓</div>
      <p class="form-success__title">Заявка отправлена</p>
      <p class="form-success__text">Спасибо! Специалист свяжется с вами в рабочее время.</p>
    </div>
    <form data-lead-form data-source="Заявка с сайта" novalidate>
      <div class="field" id="lead-project-box" hidden>
        <span class="field__label">Проект</span>
        <p style="margin:0;color:var(--c-gold)"><span id="lead-project-label"></span></p>
        <input type="hidden" name="project" id="lead-project" value="">
      </div>
      <div class="field">
        <label class="field__label" for="lead-name">Имя</label>
        <input class="field__input" id="lead-name" name="name" type="text" placeholder="Например, Андрей Белов" required autocomplete="name">
      </div>
      <div class="field">
        <label class="field__label" for="lead-phone">Телефон</label>
        <input class="field__input" id="lead-phone" name="phone" type="tel" placeholder="+7 (___) ___-__-__" required autocomplete="tel">
      </div>
      <div class="field">
        <label class="field__label" for="lead-tg">Telegram — не обязательно</label>
        <input class="field__input" id="lead-tg" name="tg" type="text" placeholder="nickname">
      </div>
      <label class="consent">
        <input type="checkbox">
        <span class="consent__box">✓</span>
        <span>Я согласен на обработку персональных данных</span>
      </label>
      <p class="consent__err">Поставьте галочку — без согласия мы не можем принять заявку</p>
      <p class="form-error" hidden style="color:var(--c-error);font-size:12px;margin:0 0 12px"></p>
      <button type="submit" class="btn btn--solid btn--block">Отправить заявку</button>
      <p class="form-note">Или позвоните: <a href="{PHONE1_HREF}" style="color:var(--c-gold)">{PHONE1}</a></p>
    </form>
  </div>
</div>

<div class="modal" id="modal-contact" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="contact-title">
  <div class="modal__bd" data-modal-close></div>
  <div class="modal__dlg">
    <button type="button" class="modal__close" data-modal-close aria-label="Закрыть">✕</button>
    <p class="modal__eyebrow">Связаться</p>
    <h2 class="modal__title" id="contact-title">Напишите нам</h2>
    <p class="modal__sub">Ответим в рабочее время — пн–сб с 10:00 до 21:00.</p>
    <div class="tabs" role="tablist">
      <button type="button" class="tab is-on" data-contact="telegram" role="tab" aria-selected="true">Telegram</button>
      <button type="button" class="tab" data-contact="whatsapp" role="tab" aria-selected="false">WhatsApp</button>
      <button type="button" class="tab" data-contact="vk" role="tab" aria-selected="false">VK</button>
    </div>
    <div class="form-success">
      <div class="form-success__icon">✓</div>
      <p class="form-success__title">Сообщение отправлено</p>
      <p class="form-success__text">Мы свяжемся с вами в ближайшее время.</p>
    </div>
    <form id="contact-form" data-lead-form data-source="Сообщение — Telegram" novalidate>
      <div class="field">
        <label class="field__label" for="contact-value">Контакт</label>
        <input class="field__input" id="contact-value" name="contact" type="text" placeholder="@username или телефон" required>
      </div>
      <div class="field">
        <label class="field__label" for="contact-name">Имя</label>
        <input class="field__input" id="contact-name" name="name" type="text" placeholder="Как к вам обращаться" required>
      </div>
      <div class="field">
        <label class="field__label" for="contact-message">Сообщение</label>
        <textarea class="field__textarea" id="contact-message" name="message" placeholder="Опишите задачу: размеры, сроки, пожелания" required></textarea>
      </div>
      <label class="consent">
        <input type="checkbox">
        <span class="consent__box">✓</span>
        <span>Я согласен на обработку персональных данных</span>
      </label>
      <p class="consent__err">Поставьте галочку — без согласия мы не можем принять сообщение</p>
      <p class="form-error" hidden style="color:var(--c-error);font-size:12px;margin:0 0 12px"></p>
      <button type="submit" class="btn btn--solid btn--block">Отправить</button>
    </form>
  </div>
</div>

<button class="fab" type="button" data-modal-open="contact" aria-label="Написать нам">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
</button>"""


def cookie_bar() -> str:
    return """<div class="cookie" id="cookie" hidden role="dialog" aria-label="Использование cookies">
  <p class="cookie__text">Мы используем cookies, чтобы сайт работал корректно и чтобы понимать, какие разделы полезны. Продолжая пользоваться сайтом, вы соглашаетесь с этим. Персональные данные из форм обрабатываются только для связи по вашей заявке.</p>
  <div class="cookie__actions">
    <button type="button" class="btn btn--sm btn--solid" id="cookie-ok">Принять</button>
  </div>
</div>"""


def page(
    *,
    title: str,
    description: str,
    canonical: str,
    body: str,
    active: str = "",
    page_css: str = "",
    ld: list[dict] | None = None,
    og_image: str = "images/og-cover.jpg",
    body_attrs: str = "",
    noindex: bool = False,
    scripts: str = "",
    base: str = "",
    extra_head: str = "",
) -> str:
    return f"""{head(title, description, canonical, page_css, ld, og_image, noindex=noindex, base=base, extra_head=extra_head)}
<body data-page="{esc(active.replace('.html', ''))}"{(' ' + body_attrs) if body_attrs else ''}>
{header(active, base)}

{body}

{footer(base)}

{modals(base)}

{cookie_bar()}

<script src="{base}js/site-content.js" defer></script>
<script src="{base}js/site.js" defer></script>
{scripts}
</body>
</html>
"""


# --------------------------------------------------------------------------
# CTA-полоса (общая)
# --------------------------------------------------------------------------

def cta_band(title: str = "", sub: str = "", button: str = "", base: str = "", _site: dict | None = None) -> str:
    cta = (_site or {}).get("cta") or {}
    title = title or cta.get("title") or "Отправьте размеры или дизайн-проект — <em>рассчитаем стоимость</em>"
    sub = sub or cta.get("sub") or "Смета с реальными ценами на материалы и фурнитуру. Замер и расчёт — бесплатно, по Москве и ближнему МО."
    button = button or cta.get("button") or "Рассчитать кухню"
    second = cta.get("button2") or "Написать в Telegram"
    bg = norm_path(cta.get("image") or "images/cta-bg.jpg")
    return f"""<section class="cta-band">
  <div class="cta-band__bg" aria-hidden="true"><img src="{base}{esc(bg)}" alt="" loading="lazy" data-fallback></div>
  <div class="cta-band__in">
    <div>
      <h2 class="cta-band__title"{' data-cms="cta.title"' if _site else ''}>{title}</h2>
      <p class="cta-band__sub"{' data-cms="cta.sub"' if _site else ''}>{esc(sub)}</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn--solid" data-modal-open="lead">{esc(button)}</button>
      <a class="btn btn--ghost" href="{TG}" target="_blank" rel="noopener">{esc(second)}</a>
    </div>
  </div>
</section>"""


# --------------------------------------------------------------------------
# данные
# --------------------------------------------------------------------------

def load_site() -> dict:
    path = ROOT / "_data" / "site.json"
    if not path.exists():
        return {}
    return json.loads(read(path))


def load_projects() -> list[dict]:
    items: list[dict] = []
    seen_slugs: dict[str, str] = {}
    for path in sorted((ROOT / "_projects").glob("*.md")):
        meta, body = parse_front_matter(read(path))
        stem = path.stem
        slug = str(meta.get("slug") or stem).strip() or stem
        if slug in seen_slugs:
            base_slug, counter = slug, 2
            while f"{base_slug}-{counter}" in seen_slugs:
                counter += 1
            slug = f"{base_slug}-{counter}"
            warnings.append(f"дубликат slug «{base_slug}»: {path.name} → сохранён как {slug}")
        seen_slugs[slug] = path.name

        prefix = stem.split("-")[0]
        ptype = str(meta.get("type") or "").strip() or TYPE_BY_PREFIX.get(prefix, "Другое")
        materials = as_list(meta.get("material")) or as_list(meta.get("facades"))
        layouts = norm_layouts(as_list(meta.get("layout")))
        price = meta.get("price")
        island = bool(meta.get("island")) or any("остров" in x.lower() for x in layouts) or "остров" in str(meta.get("title", "")).lower()
        gallery = [norm_path(x) for x in as_list(meta.get("gallery"))]
        cover = norm_path(meta.get("cover")) or (gallery[0] if gallery else "")
        gallery = [cover] + [g for g in gallery if g and g != cover] if cover else gallery

        items.append({
            "slug": slug,
            "file": path.name,
            "title": str(meta.get("title") or "Проект").strip(),
            "type": ptype,
            "featured": bool(meta.get("featured")),
            "style": str(meta.get("style") or "").strip(),
            "layouts": layouts,
            "materials": materials,
            "price": price,
            "price_label": money(price),
            "budget": budget_key(price),
            "island": island,
            "description": str(meta.get("description") or "").strip(),
            "body": md(body) if body.strip() else "",
            "cover": cover,
            "gallery": gallery,
            "facades": str(meta.get("facades") or "").strip(),
            "countertop": str(meta.get("countertop") or "").strip(),
            "hardware": str(meta.get("hardware") or "").strip(),
            "equipment": str(meta.get("equipment") or "").strip(),
            "order": str(meta.get("date") or "").strip(),
            "draft": str(meta.get("draft", "")).lower() in ("true", "1", "yes"),
        })

    items.sort(key=lambda p: (not p["featured"], p["order"] or "", p["title"]))
    return items


def load_articles(include_drafts: bool = True) -> list[dict]:
    items: list[dict] = []
    folder = ROOT / "_articles"
    if not folder.exists():
        return items
    for path in sorted(folder.glob("*.md")):
        meta, body = parse_front_matter(read(path))
        slug = str(meta.get("slug") or path.stem).strip() or path.stem
        draft = str(meta.get("draft", "")).lower() in ("true", "1", "yes")
        tags = as_list(meta.get("tags"))
        keywords = as_list(meta.get("keywords"))
        items.append({
            "slug": slug,
            "file": path.name,
            "title": str(meta.get("title") or meta.get("h1") or slug).strip(),
            "h1": str(meta.get("h1") or meta.get("title") or slug).strip(),
            "description": str(meta.get("description") or "").strip(),
            "lead": str(meta.get("lead") or "").strip(),
            "cover": norm_path(meta.get("cover")),
            "category": str(meta.get("category") or "Мебель").strip(),
            "tags": tags,
            "keywords": keywords,
            "date": str(meta.get("date") or "").strip(),
            "updated": str(meta.get("updated") or "").strip(),
            "author": str(meta.get("author") or BRAND).strip(),
            "draft": draft,
            "body_md": body.strip(),
            "body_html": md(body),
        })
    items.sort(key=lambda a: sort_key_date(a["date"]), reverse=True)
    return [a for a in items if include_drafts or not a["draft"]]


def load_content_page(name: str) -> dict:
    """_content/pages/<name>.json + .body.html + .css"""
    base = ROOT / "_content" / "pages" / name
    data = {}
    if base.with_suffix(".json").exists():
        data = json.loads(read(base.with_suffix(".json")))
    body = read(base.with_suffix(".body.html")) if base.with_suffix(".body.html").exists() else ""
    css = read(base.with_suffix(".css")) if base.with_suffix(".css").exists() else ""
    data.update({"body": body, "css": css})
    return data


def load_doc(name: str) -> dict:
    path = ROOT / "_content" / f"{name}.md"
    if not path.exists():
        return {}
    meta, body = parse_front_matter(read(path))
    return {
        "meta": meta,
        "body_md": body.strip(),
        "body_html": md(body),
    }


# --------------------------------------------------------------------------
# компоненты
# --------------------------------------------------------------------------

def project_card(p: dict, base: str = "") -> str:
    tags = "".join(f'<span class="tag">{esc(m)}</span>' for m in p["materials"][:3])
    price = f'<span class="pcard__price">{esc(p["price_label"])}</span>' if p["price_label"] else "<span></span>"
    badge = esc(p["type"]) if p["type"] else ""
    return f"""<li>
  <a class="pcard" href="{base}portfolio/{esc(p['slug'])}.html"
     data-type="{esc(p['type'])}"
     data-materials="{esc('|'.join(p['materials']))}"
     data-layouts="{esc('|'.join(p['layouts']))}"
     data-budget="{esc(p['budget'])}"
     data-island="{1 if p['island'] else 0}">
    <div class="pcard__media">
      <img class="pcard__img" src="{base}{esc(p['cover'])}" alt="{esc(p['title'])} — проект мебели на заказ" loading="lazy" width="640" height="480" data-fallback>
      <div class="pcard__grad"></div>
      {'<span class="pcard__badge">' + badge + '</span>' if badge else ''}
      <div class="pcard__head"><h3 class="pcard__title">{esc(p['title'])}</h3></div>
    </div>
    <div class="pcard__body">
      <div class="pcard__tags">{tags}</div>
      <div class="pcard__foot">{price}<span class="pcard__more">Смотреть →</span></div>
    </div>
  </a>
</li>"""


def article_card(a: dict, base: str = "") -> str:
    cover = (f'<img src="{base}{esc(a["cover"])}" alt="{esc(a["title"])}" loading="lazy" width="640" height="400" data-fallback>'
             if a["cover"] else '<div class="img-fallback"></div>')
    lead = esc(a["description"])[:180]
    date_html = f'<time datetime="{iso_date(a["date"])}">{ru_date(a["date"])}</time>' if a["date"] else ""
    return f"""<li>
  <a class="acard" href="{base}articles/{esc(a['slug'])}.html">
    <div class="acard__media">{cover}</div>
    <div class="acard__body">
      <div class="acard__meta"><span>{esc(a['category'])}</span>{date_html}</div>
      <h3 class="acard__title">{esc(a['title'])}</h3>
      <p class="acard__text">{lead}</p>
      <span class="acard__more">Читать →</span>
    </div>
  </a>
</li>"""


def breadcrumbs(items: list[tuple[str, str]]) -> str:
    parts = []
    for i, (href, label) in enumerate(items):
        if href:
            parts.append(f'<a href="{href}">{esc(label)}</a>')
        else:
            parts.append(f'<span aria-current="page">{esc(label)}</span>')
        if i < len(items) - 1:
            parts.append("<span>/</span>")
    return '<nav class="crumbs" aria-label="Хлебные крошки">' + "".join(parts) + "</nav>"


# --------------------------------------------------------------------------
# страницы
# --------------------------------------------------------------------------

def build_index(site: dict, projects: list[dict], articles: list[dict]) -> str:
    featured = [p for p in projects if p["featured"]][:4]
    if len(featured) < 4:
        extra = [p for p in projects if p not in featured][: 4 - len(featured)]
        featured += extra
    cards = "\n".join(project_card(p) for p in featured)

    published = [a for a in articles if not a["draft"]][:3]
    article_cards = "\n".join(article_card(a) for a in published) if published else ""
    articles_block = ""
    if article_cards:
        art_head = site.get("articlesBlock") or {}
        articles_block = f"""<section class="sec sec--line" id="articles">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow" data-cms="articlesBlock.eyebrow">{esc(art_head.get('eyebrow') or 'Журнал 40/60')}</p>
        <h2 class="display display--xl" data-cms="articlesBlock.title">{art_head.get('title') or 'Статьи о кухнях <em>и материалах</em>'}</h2>
      </div>
      <div>
        <p class="lead" data-cms="articlesBlock.lead">{esc(art_head.get('lead') or 'Разбираем реальные цены, материалы и ошибки — на основе наших проектов, а не чужих статей.')}</p>
        <p style="margin-top:18px"><a class="sec__link" href="articles.html">Все статьи →</a></p>
      </div>
    </div>
    <ul class="pgrid pgrid--4" style="list-style:none">{article_cards}</ul>
  </div>
</section>"""

    std_head = site.get("standardsBlock") or {}
    standards_block = f"""<section class="sec" id="standards">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow" data-cms="standardsBlock.eyebrow">{esc(std_head.get('eyebrow') or 'Стандарты')}</p>
        <h2 class="display display--xl" data-cms="standardsBlock.title">{std_head.get('title') or 'Как мы производим <em>мебель</em>'}</h2>
      </div>
      <div>
        <p class="lead" data-cms="standardsBlock.lead">{esc(std_head.get('lead') or 'Правила, по которым проектируем, собираем и сдаём мебель: материалы, фурнитура, допуски, контроль и гарантия.')}</p>
        <p style="margin-top:18px"><a class="sec__link" href="standards.html">Все стандарты →</a></p>
      </div>
    </div>
    <ul class="std-grid">
      <li class="std-card"><span class="std-card__num">01</span><h3 class="std-card__title">Материалы</h3><p class="std-card__text">ЛДСП E1, МДФ, эмаль по RAL, натуральный шпон, кварцевый агломерат. Что допускаем в производство — и почему.</p></li>
      <li class="std-card"><span class="std-card__num">02</span><h3 class="std-card__title">Фурнитура</h3><p class="std-card__text">Blum, Hettich — петли, ящики, механизмы. Подбор под вес и сценарий эксплуатации, а не «что дешевле».</p></li>
      <li class="std-card"><span class="std-card__num">03</span><h3 class="std-card__title">Допуски и эргономика</h3><p class="std-card__text">Зазоры 2–3 мм, отклонения до ±2 мм на погонный метр, рабочая высота 890 мм, эргономические коридоры.</p></li>
      <li class="std-card"><span class="std-card__num">04</span><h3 class="std-card__title">Контроль и сдача</h3><p class="std-card__text">Три этапа проверки, фотоотчёт перед монтажом и итоговая приёмка по чек-листу вместе с клиентом.</p></li>
    </ul>
    <div style="margin-top:clamp(20px,3vw,32px);display:flex;flex-wrap:wrap;gap:14px">
      <a class="btn" href="standards.html">Стандарты производства</a>
      <a class="btn btn--ghost" href="requirements.html">Требования к мебели</a>
    </div>
  </div>
</section>"""

    # ---- «Проект под ключ»
    tpk = site.get("tpk") or {}
    tpk_cards = tpk.get("cards") if isinstance(tpk.get("cards"), list) and tpk["cards"] else DEFAULT_TPK
    tpk_items = "\n".join(
        f'<li class="tpk-card"><span class="tpk-card__num">{esc(c.get("num", i + 1))}</span>'
        f'<span class="tpk-card__icon" aria-hidden="true">{c.get("icon", "")}</span>'
        f'<h3 class="tpk-card__title">{esc(c.get("title", ""))}</h3>'
        f'<p class="tpk-card__text">{esc(c.get("text", ""))}</p></li>'
        for i, c in enumerate(tpk_cards)
    )
    tpk_block = f"""<section class="sec sec--tight" id="turnkey">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow" data-cms="tpk.eyebrow">{esc(tpk.get('eyebrow') or 'Комплексный подход')}</p>
        <h2 class="display display--xl" data-cms="tpk.title">{tpk.get('title') or 'Проект <em>под ключ</em>'}</h2>
      </div>
      <div>
        <p class="lead" data-cms="tpk.subtitle">{esc(tpk.get('subtitle') or 'Берём на себя весь путь: от первой консультации до подключённой техники. Вам не нужно искать отдельных подрядчиков на замер, камень, доставку и сборку.')}</p>
      </div>
    </div>
    <ol class="tpk__grid" style="counter-reset:none">{tpk_items}</ol>
  </div>
</section>"""

    # ---- «Этапы работы»
    steps = site.get("steps") or {}
    step_items = steps.get("items") if isinstance(steps.get("items"), list) and steps["items"] else DEFAULT_STEPS
    flow_items = "\n".join(
        f'<li class="journey__step"><span class="journey__dot">{esc(s.get("num", f"{i + 1:02d}"))}</span>'
        f'<div class="journey__body"><h3 class="journey__title">{esc(s.get("title", ""))}</h3>'
        f'<p class="journey__text">{esc(s.get("text", ""))}</p></div></li>'
        for i, s in enumerate(step_items)
    )
    steps_block = f"""<section class="sec sec--alt sec--line" id="process">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow">Процесс</p>
        <h2 class="display display--xl" data-cms="steps.title">{steps.get('title') or 'Этапы <em>работы</em>'}</h2>
      </div>
      <div>
        <p class="lead" data-cms="steps.lead">{esc(steps.get('lead') or 'От первой встречи до подписанных актов — десять понятных шагов. На каждом этапе вы понимаете, что происходит и что будет дальше.')}</p>
      </div>
    </div>
    <ol class="journey is-ready" id="journey">{flow_items}</ol>
  </div>
</section>"""

    # ---- «Производство» (две колонки; на мобилке фото уходит под текст)
    prod = site.get("production") or {}
    prod_items = prod.get("items") if isinstance(prod.get("items"), list) and prod["items"] else DEFAULT_PROD_ITEMS
    prod_steps = "\n".join(
        f'<li class="steps__item"><span class="steps__num">{esc(p.get("num", f"{i + 1:02d}"))}</span>'
        f'<div><p class="steps__title">{esc(p.get("title", ""))}</p>'
        f'<p class="steps__text">{esc(p.get("text", ""))}</p></div></li>'
        for i, p in enumerate(prod_items)
    )
    production_block = f"""<section class="sec sec--line" id="production">
  <div class="wrap split">
    <div>
      <p class="eyebrow" data-cms="production.eyebrow">{esc(prod.get('eyebrow') or 'Производство')}</p>
      <h2 class="display display--l" data-cms="production.title">{prod.get('title') or 'Свой цех — значит <em>свои сроки</em>'}</h2>
      <p class="lead" style="margin-top:18px" data-cms="production.text">{esc(prod.get('text') or 'Мы не перепродаём чужие кухни. Проектируем, раскраиваем, кромкуем и собираем сами: поэтому отвечаем за каждый зазор и не зависим от подрядчиков.')}</p>
      <ul class="steps" style="margin-top:26px;grid-template-columns:1fr 1fr">{prod_steps}</ul>
    </div>
    <figure class="split__media">
      <img src="{esc(norm_path(prod.get('image') or 'images/showroom.jpg'))}" alt="{esc(prod.get('caption') or 'Шоурум 40/60 Design: образцы фасадов и камня')}" width="900" height="700" loading="lazy" data-fallback>
      <figcaption class="split__caption">{esc(prod.get('caption') or 'Шоурум: образцы фасадов, эмалей и кварцевого камня — можно потрогать до заказа.')}</figcaption>
    </figure>
  </div>
</section>"""

    # ---- FAQ
    faq_data = site.get("faq") or {}
    faq_items_src = faq_data.get("items") if isinstance(faq_data.get("items"), list) and faq_data["items"] else DEFAULT_FAQ
    faq_items = [(str(x.get("q", "")), str(x.get("a", ""))) for x in faq_items_src if x.get("q")]
    faq_html = "\n".join(
        f'<li class="faq__item"><button class="faq__q" type="button" aria-expanded="false">{esc(q)}<span class="faq__icon" aria-hidden="true"></span></button>'
        f'<div class="faq__a"><div class="faq__a-in"><p>{esc(a)}</p></div></div></li>'
        for q, a in faq_items
    )
    faq_ld = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq_items
        ],
    }

    hero = site.get("hero") or {}
    body = f"""<section class="hero" id="top">
  <div class="hero__media">
    <img class="hero__img" src="images/hero.jpg" alt="Кухня на заказ в тёмном орехе с каменным островом" width="1920" height="1080">
    <div class="hero__veil"></div>
  </div>
  <div class="hero__in">
    <p class="hero__eyebrow" data-cms="hero.eyebrow">{esc(hero.get('eyebrow') or 'Производство мебели · Москва')}</p>
    <h1 class="hero__title" data-cms="hero.title">{hero.get('title') or 'Кухни, которые <em>живут</em> дольше ремонта<span style="color:var(--c-gold-hi)">.</span>'}</h1>
    <p class="hero__sub" data-cms="hero.subtitle">{esc(hero.get('subtitle') or 'Проектируем и производим кухни и корпусную мебель по индивидуальным размерам. Своё производство, срок 21 день, гарантия 3 года.')}</p>
    <div class="hero__badges">
      <span class="hero__badge" data-cms="hero.badge1">{esc(hero.get('badge1') or '21 день')}</span>
      <span class="hero__badge" data-cms="hero.badge2">{esc(hero.get('badge2') or 'Гарантия 3 года')}</span>
      <span class="hero__badge" data-cms="hero.badge3">{esc(hero.get('badge3') or 'От 150 000 ₽')}</span>
      <span class="hero__badge" data-cms="hero.badge4">{esc(hero.get('badge4') or 'Замер бесплатно')}</span>
    </div>
    <div class="hero__actions">
      <a class="btn btn--solid" href="portfolio.html" data-cms="hero.btn1">{esc(hero.get('btn1') or 'Смотреть проекты')}</a>
      <button class="btn btn--ghost" type="button" data-modal-open="lead" data-cms="hero.btn2">{esc(hero.get('btn2') or 'Получить расчёт')}</button>
    </div>
  </div>
</section>

<section class="sec" id="portfolio">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow">Портфолио</p>
        <h2 class="display display--xl">Реализованные <em>проекты</em></h2>
      </div>
      <div>
        <p class="lead">Реальные объекты с ценами, материалами и фурнитурой. Откройте проект, чтобы увидеть комплектацию и фотографии.</p>
        <p style="margin-top:18px"><a class="sec__link" href="portfolio.html">Все проекты →</a></p>
      </div>
    </div>
    <ul class="pgrid pgrid--4" style="list-style:none">
{cards}
    </ul>
  </div>
</section>

{tpk_block}

{steps_block}

{production_block}

{articles_block}

{standards_block}

<section class="sec sec--line" id="faq">
  <div class="wrap">
    <div class="sec__head">
      <div>
        <p class="eyebrow">Вопросы</p>
        <h2 class="display display--xl" data-cms="faq.title">{faq_data.get('title') or 'Частые вопросы'}</h2>
      </div>
      <div>
        <p class="lead" data-cms="faq.subtitle">{esc(faq_data.get('subtitle') or 'Отвечаем на то, что спрашивают чаще всего — на замере, в переписке и на объектах.')}</p>
      </div>
    </div>
    <ul style="list-style:none;border-top:1px solid var(--c-line);max-width:900px">
{faq_html}
    </ul>
  </div>
</section>

{cta_band(_site=site)}"""

    return page(
        title="Кухни и корпусная мебель на заказ в Москве — 40/60 Design",
        description="Производство кухонь и корпусной мебели на заказ в Москве и области. Своё производство, срок 21 день, гарантия 3 года, бесплатный замер и расчёт.",
        canonical=SITE + "/",
        body=body,
        active="index.html",
        ld=[faq_ld, {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": BRAND,
            "url": SITE,
            "logo": SITE + "/images/brand-mark-512.png",
            "telephone": "+79015861488",
            "address": {"@type": "PostalAddress", "addressLocality": "Москва", "addressCountry": "RU"},
            "sameAs": [TG],
        }],
    )


def build_portfolio(projects: list[dict]) -> str:
    def counts(getter):
        tally: dict[str, int] = {}
        for p in projects:
            for value in getter(p):
                tally[value] = tally.get(value, 0) + 1
        return tally

    def options(values, all_label):
        rows = [f'<option value="">{esc(all_label)}</option>']
        for value, _ in values:
            rows.append(f'<option value="{esc(value)}">{esc(value)}</option>')
        return "".join(rows)

    type_values = sorted(counts(lambda p: [p["type"]]).items(), key=lambda kv: (-kv[1], kv[0]))
    material_values = sorted(
        counts(lambda p: p["materials"]).items(),
        key=lambda kv: (MATERIAL_ORDER.index(kv[0]) if kv[0] in MATERIAL_ORDER else 99, -kv[1], kv[0]),
    )
    layout_values = sorted(counts(lambda p: p["layouts"]).items(), key=lambda kv: (-kv[1], kv[0]))
    budget_values = [(label, key) for key, label in BUDGETS]
    budget_opts = '<option value="">Любой бюджет</option>' + "".join(
        f'<option value="{esc(key)}">{esc(label)}</option>' for label, key in budget_values
    )

    filters = f"""<div class="pf-bar" id="pf" role="search" aria-label="Фильтры проектов">
  <span class="pf-bar__label" data-cms="portfolio.filtersLabel">Фильтры</span>
  <label class="pf-select"><select id="pf-material" aria-label="Материал фасадов">{options(material_values, "Все материалы")}</select></label>
  <label class="pf-select"><select id="pf-type" aria-label="Тип мебели">{options(type_values, "Все типы")}</select></label>
  <label class="pf-select"><select id="pf-layout" aria-label="Планировка">{options(layout_values, "Все планировки")}</select></label>
  <label class="pf-select"><select id="pf-budget" aria-label="Бюджет">{budget_opts}</select></label>
  <label class="pf-check" id="pf-island-wrap"><input type="checkbox" id="pf-island"> Только с островом</label>
  <div class="pf-meta">
    <span class="pf-count" id="pf-count" aria-live="polite"></span>
    <button type="button" class="pf-reset" id="pf-reset">Сбросить</button>
  </div>
</div>"""

    cards = "\n".join(project_card(p) for p in projects)

    body = f"""<section class="cover-hero">
  <img class="cover-hero__img" src="images/portfolio-hero.jpg" alt="Кухня на заказ с каменным островом — реализованный проект 40/60 Design" width="1920" height="1080">
  <div class="cover-hero__in">
    <p class="eyebrow" style="color:var(--c-gold-hi)">Портфолио</p>
    <h1 class="cover-hero__title">Реализованные проекты мебели</h1>
    <p class="cover-hero__sub">Полный каталог работ — от компактных кухонь до гардеробных и санузлов. Выберите материал фасадов, планировку или бюджет, чтобы найти подходящее.</p>
  </div>
</section>

<section class="sec sec--tight">
  <div class="wrap" id="pf">
    {filters}
    <ul class="pgrid" id="pf-grid" style="list-style:none">
{cards}
      <li class="empty-state" id="pf-empty" hidden>По этим фильтрам ничего не нашлось. Уберите один из параметров или <button type="button" class="btn btn--sm btn--ghost" id="pf-empty-reset">сбросьте фильтры</button></li>
    </ul>
  </div>
</section>

{cta_band('Не нашли похожий проект? <em>Сделаем ваш</em>',
          'Расскажите размеры и задачу — подберём материалы, покажем близкие по бюджету проекты и посчитаем смету.')}"""

    ld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Реализованные проекты мебели — 40/60 Design",
        "url": SITE + "/portfolio.html",
        "hasPart": [
            {"@type": "CreativeWork", "name": p["title"], "url": f"{SITE}/portfolio/{p['slug']}.html"} for p in projects[:12]
        ],
    }

    return page(
        title="Портфолио — реализованные проекты кухонь и мебели | 40/60 Design",
        description="Реализованные проекты кухонь, гардеробных и корпусной мебели на заказ в Москве: фотографии, материалы фасадов, фурнитура и реальные цены.",
        canonical=SITE + "/portfolio.html",
        body=body,
        active="portfolio.html",
        ld=[ld],
        og_image="images/portfolio-hero.jpg",
    )


def build_project(p: dict, all_projects: list[dict], base: str = "../", noindex: bool = False) -> str:
    thumbs = "".join(
        f'<button type="button" class="gallery__thumb" data-src="{base}{esc(src)}" data-alt="{esc(p["title"])} — фото {i + 1}" '
        f'aria-pressed="{"true" if i == 0 else "false"}"><img src="{base}{esc(src)}" alt="" loading="lazy" width="320" height="320"></button>'
        for i, src in enumerate(p["gallery"])
    )

    rows = []
    if p["materials"]:
        rows.append(("Материал фасадов", ", ".join(p["materials"])))
    if p["facades"]:
        rows.append(("Фасады подробно", p["facades"]))
    if p["layouts"]:
        rows.append(("Планировка", ", ".join(p["layouts"])))
    if p["countertop"]:
        rows.append(("Столешница", p["countertop"]))
    if p["hardware"]:
        rows.append(("Фурнитура", p["hardware"]))
    if p["equipment"]:
        rows.append(("Комплектация", p["equipment"]))
    if p["style"]:
        rows.append(("Стиль", p["style"]))
    spec_rows = "".join(
        f'<li class="spec__row"><span class="spec__k">{esc(k)}</span><span class="spec__v">{esc(v)}</span></li>'
        for k, v in rows
    )

    price_block = ""
    if p["price_label"]:
        price_block = f'<p class="spec__price">{esc(p["price_label"])}</p><p class="spec__price-note">стоимость проекта «под ключ»</p>'

    related = [x for x in all_projects if x["slug"] != p["slug"] and (set(x["materials"]) & set(p["materials"]) or x["type"] == p["type"])][:3]
    related_html = ""
    if related:
        related_html = f"""<section class="sec sec--tight sec--line">
  <div class="wrap">
    <div class="sec__head"><div><p class="eyebrow">Похожие работы</p><h2 class="display display--l">Ещё проекты</h2></div><div></div></div>
    <ul class="pgrid" style="list-style:none">{''.join(project_card(x, base=base) for x in related)}</ul>
  </div>
</section>"""

    body = f"""<section class="proj__head">
  <div class="wrap">
    {breadcrumbs([("../index.html", "Главная"), ("../portfolio.html", "Портфолио"), ("", p["title"])])}
    <p class="proj__back"><a class="btn btn--sm btn--ghost" href="../portfolio.html" data-back>← Ко всем проектам</a></p>
    <h1 class="display display--xl">{esc(p["title"])}</h1>
    <div class="proj__layout">
      <div class="gallery">
        <div class="gallery__main"><img id="gallery-main" src="{base}{esc(p['gallery'][0])}" alt="{esc(p['title'])} — главное фото" width="1200" height="900" data-fallback></div>
        <div class="gallery__thumbs">{thumbs}</div>
      </div>
      <aside class="spec">
        <p class="spec__kicker">{esc(p['type'])} · проект под ключ</p>
        {price_block}
        <ul class="spec__list" style="list-style:none">{spec_rows}</ul>
        <button type="button" class="btn btn--solid btn--block" data-modal-open="lead" data-project="{esc(p['title'])}">Рассчитать похожую кухню</button>
        <p style="font-size:11px;color:var(--c-muted);margin:10px 0 0">Замер и расчёт — бесплатно. Ответим в течение 15 минут.</p>
      </aside>
    </div>
    <div class="proj__desc">
      <p>{esc(p['description'])}</p>
      {p['body'].replace('src="images/', 'src="' + base + 'images/')}
    </div>
  </div>
</section>

{cta_band('Хотите такую же кухню? <em>Посчитаем</em>',
          'Пришлите размеры помещения или дизайн-проект — вернёмся со сметой и вариантами материалов в рамках бюджета.',
          'Обсудить проект', base=base)}

{related_html}"""

    ld = {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": p["title"],
        "url": f"{SITE}/portfolio/{p['slug']}.html",
        "image": f"{SITE}/{p['cover']}",
        "description": p["description"][:300],
        "creator": {"@type": "Organization", "name": BRAND},
        "about": ", ".join(p["materials"]),
    }
    if p["price"]:
        ld["offers"] = {"@type": "Offer", "price": str(p["price"]), "priceCurrency": "RUB"}

    return page(
        title=("[черновик] " if noindex else "") + f"{p['title']} — проект мебели на заказ | 40/60 Design",
        description=(p["description"][:155] or f"{p['title']}: реализованный проект мебели на заказ в Москве."),
        canonical=f"{SITE}/{('preview/portfolio' if noindex else 'portfolio')}/{p['slug']}.html",
        body=body,
        active="portfolio.html",
        ld=[ld],
        og_image=p["cover"],
        base=base,
        noindex=noindex,
    )


def build_articles_index(articles: list[dict]) -> str:
    published = [a for a in articles if not a["draft"]]
    cards = "\n".join(article_card(a) for a in published)
    if not cards:
        cards = '<li class="empty-state">Статьи скоро появятся.</li>'

    body = f"""<section class="phero">
  <div class="phero__in">
    <p class="eyebrow">Журнал</p>
    <h1 class="phero__title">Статьи о кухнях, материалах и ценах</h1>
    <p class="phero__sub">Пишем на основе собственных проектов: реальные сметы, комплектации и ошибки, которые видим на объектах. Без пересказа чужих статей.</p>
  </div>
</section>

<section class="sec sec--tight">
  <div class="wrap">
    <ul class="pgrid" style="list-style:none">
{cards}
    </ul>
  </div>
</section>

{cta_band('Ищете цену под свой проект? <em>Посчитаем</em>',
          'Пришлите размеры или дизайн-проект — ответим со сметой, а не «от 100 000 рублей».')}"""

    return page(
        title="Статьи о кухнях и мебели на заказ | 40/60 Design",
        description="Статьи о том, сколько стоит кухня на заказ в Москве, из чего складывается цена, какие материалы и фурнитуру мы используем и на чём не стоит экономить.",
        canonical=SITE + "/articles.html",
        body=body,
        active="articles.html",
    )


def build_article(a: dict, articles: list[dict], preview: bool = False) -> str:
    base = "../"  # и /articles/<slug>.html, и /preview/<slug>.html лежат на один уровень
    cover = (f'<div class="article__cover"><img src="{base}{esc(a["cover"])}" alt="{esc(a["title"])}" width="1600" height="900"></div>'
             if a["cover"] else "")
    lead = f'<p class="article__lead">{esc(a["lead"])}</p>' if a["lead"] else ""
    meta_parts = [f'<span>{esc(a["category"])}</span>']
    if a["date"]:
        meta_parts.append(f'<time datetime="{iso_date(a["date"])}">{ru_date(a["date"])}</time>')
    meta_parts.append("<span>Читать 6–8 минут</span>")

    others = [x for x in articles if x["slug"] != a["slug"] and not x["draft"]][:3]
    more = ""
    if others:
        more = f"""<section class="sec sec--tight sec--line">
  <div class="wrap">
    <div class="sec__head"><div><p class="eyebrow">Ещё по теме</p><h2 class="display display--l">Другие статьи</h2></div><div></div></div>
    <ul class="pgrid" style="list-style:none">{''.join(article_card(x, base=base) for x in others)}</ul>
  </div>
</section>"""

    # FAQ для разметки: H3 под H2 «Частые вопросы»
    faq_ld = None
    faq_md = re.search(r"##\s+Частые вопросы\s*\n(.*?)(?=\n##\s|\Z)", a["body_md"], re.S | re.I)
    if faq_md:
        pairs = re.findall(r"###\s+(.+?)\n(.*?)(?=\n###\s|\Z)", faq_md.group(1), re.S)
        if pairs:
            faq_ld = {
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": [
                    {"@type": "Question", "name": q.strip(), "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"\s+", " ", t).strip()[:800]}}
                    for q, t in pairs
                ],
            }

    ld = [{
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": a["h1"],
        "description": a["description"],
        "datePublished": iso_date(a["date"]),
        "dateModified": iso_date(a["updated"] or a["date"]),
        "author": {"@type": "Organization", "name": a["author"]},
        "publisher": {"@type": "Organization", "name": BRAND, "logo": {"@type": "ImageObject", "url": SITE + "/images/brand-mark-512.png"}},
        "mainEntityOfPage": {"@type": "WebPage", "@id": f"{SITE}/articles/{a['slug']}.html"},
        "image": f"{SITE}/{a['cover']}" if a["cover"] else SITE + "/images/og-cover.jpg",
    }]
    if faq_ld:
        ld.append(faq_ld)

    canonical = f"{SITE}/{('preview' if preview else 'articles')}/{a['slug']}.html"
    notice = ""
    if preview:
        notice = ('<div style="background:#3a1f17;border-bottom:1px solid #e07a6a;color:#ffd9cf;padding:10px 20px;'
                  'font:13px/1.5 sans-serif;text-align:center">Черновик — страница не индексируется и не видна в списке статей. '
                  '<a href="' + f"{SITE}/articles.html" + '" style="color:#ffd9cf">Все статьи</a></div>')

    title = ("[черновик] " if preview else "") + a["h1"] + " — 40/60 Design"

    html_page = page(
        title=title,
        description=a["description"] or a["lead"] or a["title"],
        canonical=canonical,
        body=f"""{notice}<article class="article">
  <div class="article__head">
    {breadcrumbs([(base + 'index.html', 'Главная'), (base + 'articles.html', 'Статьи'), ('', a['title'])])}
    <h1 class="article__title">{esc(a['h1'])}</h1>
    <div class="article__meta">{''.join(meta_parts)}</div>
    {lead}
  </div>
  {cover}
  <div class="prose" style="margin-top:clamp(28px,4vw,48px)">
    {a['body_html'].replace('src="images/', 'src="' + base + 'images/')}
  </div>
</article>

{cta_band('Считаем не «от», а по вашей планировке',
          'Отправьте размеры или дизайн-проект — вернёмся со сметой, где видно цену каждой позиции.', base=base)}

{more}""",
        active="articles.html",
        ld=ld,
        og_image=a["cover"] or "images/og-cover.jpg",
        noindex=preview,
        base=base,
    )
    return html_page


def build_doc_page(doc: dict, name: str) -> str:
    meta = doc.get("meta", {})
    body_html = doc.get("body_html", "")
    title = str(meta.get("title") or name)
    h1 = str(meta.get("h1") or title)
    description = str(meta.get("description") or "")
    eyebrow = str(meta.get("eyebrow") or "")
    lead = str(meta.get("lead") or "")

    extra = partner_form() if str(meta.get("form", "")).strip() == "partner" else cta_band()

    body = f"""<section class="phero">
  <div class="phero__in">
    {breadcrumbs([("index.html", "Главная"), ("", eyebrow or h1)])}
    <p class="eyebrow">{esc(eyebrow)}</p>
    <h1 class="phero__title">{esc(h1)}</h1>
    <p class="phero__sub">{esc(lead)}</p>
  </div>
</section>

<section class="sec sec--tight">
  <div class="prose">
    {body_html}
  </div>
</section>

{extra}"""

    return page(
        title=str(meta.get("seo_title") or (h1 + " | 40/60 Design")),
        description=description,
        canonical=f"{SITE}/{name}.html",
        body=body,
        active=f"{name}.html",
        ld=[{
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": h1,
            "description": description,
            "publisher": {"@type": "Organization", "name": BRAND},
        }],
    )


def partner_form() -> str:
    """Форма заявки на партнёрство — как в исходнике, но на общих компонентах."""
    spheres = ["Дизайнер интерьеров", "Агентство недвижимости", "Строительная компания", "Мебельный салон", "Другое"]
    options = "".join(f'<option value="{esc(s)}">{esc(s)}</option>' for s in spheres)
    return f"""<section class="sec sec--line" id="partner-form">
  <div class="wrap split">
    <div>
      <p class="eyebrow">Заявка</p>
      <h2 class="display display--l">Стать <em>партнёром</em></h2>
      <p class="lead" style="margin-top:16px">Заполните форму — менеджер свяжется, расскажет об условиях, вознаграждении и ответит на вопросы. Или напишите напрямую в Telegram.</p>
      <div class="btn-row">
        <a class="btn btn--ghost" href="{TG}" target="_blank" rel="noopener">Написать в Telegram</a>
        <a class="btn" href="{PHONE1_HREF}">{PHONE1}</a>
      </div>
      <ul class="steps" style="margin-top:28px;grid-template-columns:1fr 1fr">
        <li class="steps__item"><span class="steps__num">01</span><div><p class="steps__title">Заявка</p><p class="steps__text">Отвечаем в течение 15 минут</p></div></li>
        <li class="steps__item"><span class="steps__num">02</span><div><p class="steps__title">Договор</p><p class="steps__text">Условия и вознаграждение</p></div></li>
        <li class="steps__item"><span class="steps__num">03</span><div><p class="steps__title">Проект</p><p class="steps__text">Берём работу на себя</p></div></li>
        <li class="steps__item"><span class="steps__num">04</span><div><p class="steps__title">Выплата</p><p class="steps__text">После сдачи объекта</p></div></li>
      </ul>
    </div>
    <div class="spec" style="position:static">
      <div class="form-success">
        <div class="form-success__icon">✓</div>
        <p class="form-success__title">Заявка отправлена</p>
        <p class="form-success__text">Спасибо! Менеджер свяжется с вами в ближайшее время.</p>
      </div>
      <form data-lead-form data-source="Партнёрская заявка" novalidate>
        <div class="field">
          <label class="field__label" for="pt-name">Ваше имя</label>
          <input class="field__input" id="pt-name" name="name" type="text" placeholder="Например, Андрей Белов" required autocomplete="name">
        </div>
        <div class="field">
          <label class="field__label" for="pt-phone">Телефон</label>
          <input class="field__input" id="pt-phone" name="phone" type="tel" placeholder="+7 (___) ___-__-__" required autocomplete="tel">
        </div>
        <div class="field">
          <label class="field__label" for="pt-sphere">Сфера деятельности</label>
          <select class="field__select" id="pt-sphere" name="sphere" required>
            <option value="">Выберите вариант</option>
            {options}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="pt-comment">Комментарий — не обязательно</label>
          <textarea class="field__textarea" id="pt-comment" name="message" placeholder="Коротко о вашей задаче или объёме проектов"></textarea>
        </div>
        <label class="consent">
          <input type="checkbox">
          <span class="consent__box">✓</span>
          <span>Я согласен на обработку персональных данных</span>
        </label>
        <p class="consent__err">Поставьте галочку — без согласия мы не можем принять заявку</p>
        <p class="form-error" hidden style="color:var(--c-error);font-size:12px;margin:0 0 12px"></p>
        <button type="submit" class="btn btn--solid btn--block">Отправить заявку</button>
      </form>
    </div>
  </div>
</section>"""


def build_legacy_page(name: str) -> str:
    data = load_content_page(name)
    if not data.get("body"):
        warnings.append(f"нет тела страницы _content/pages/{name}.body.html")
        return ""
    css = data.get("css", "")
    # Единая типографика для legacy-страниц: этот inline-блок загружается после site.css.
    css += """
.hd-block, .ft-block { display: none !important; }
.ab-hero__title, .pt-hero__title, .wt-hero__title, .wt-cta__title {
  font-family: var(--font-display) !important;
  font-weight: 400 !important;
  font-size: clamp(56px, 5.2vw, 72px) !important;
  line-height: 1.1 !important;
}
.ab-hero__right-title, .pt-sec__title, .wt-sec__title {
  font-family: var(--font-sans) !important;
  font-weight: 450 !important;
  font-size: clamp(40px, 3.5vw, 48px) !important;
  line-height: 1.15 !important;
}
.ab-adv__title, .ab-partners__title, .pt-who__title, .pt-gain__title,
.pt-steps__title, .wt-cover__title, .wt-terms__title, .wt-how__title {
  font-family: var(--font-sans) !important;
  font-weight: 500 !important;
  font-size: clamp(24px, 2vw, 28px) !important;
  line-height: 1.2 !important;
}
.ab-hero__desc, .ab-hero__right-text, .ab-adv__text,
.pt-hero__subtitle, .pt-sec__lead, .pt-who__text, .pt-gain__text, .pt-steps__text,
.wt-hero__subtitle, .wt-sec__lead, .wt-cover__text, .wt-terms__text, .wt-how__text {
  font-family: var(--font-sans) !important;
  font-weight: 400 !important;
  font-size: 17px !important;
  line-height: 1.65 !important;
}
@media (max-width: 900px) {
  .ab-hero__title, .pt-hero__title, .wt-hero__title, .wt-cta__title {
    font-size: clamp(34px, 8.5vw, 42px) !important;
    line-height: 1.1 !important;
  }
  .ab-hero__right-title, .pt-sec__title, .wt-sec__title {
    font-size: clamp(28px, 6.7vw, 34px) !important;
  }
  .ab-adv__title, .ab-partners__title, .pt-who__title, .pt-gain__title,
  .pt-steps__title, .wt-cover__title, .wt-terms__title, .wt-how__title {
    font-size: clamp(21px, 5.5vw, 24px) !important;
  }
  .ab-hero__desc, .ab-hero__right-text, .ab-adv__text,
  .pt-hero__subtitle, .pt-sec__lead, .pt-who__text, .pt-gain__text, .pt-steps__text,
  .wt-hero__subtitle, .wt-sec__lead, .wt-cover__text, .wt-terms__text, .wt-how__text {
    font-size: 16px !important;
  }
}
"""
    return page(
        title=data.get("title") or name,
        description=data.get("description") or "",
        canonical=data.get("canonical") or f"{SITE}/{name}.html",
        body=data["body"],
        active=f"{name}.html",
        page_css=css,
        og_image=data.get("og_image") or "images/og-cover.jpg",
        extra_head=data.get("extra_head", ""),
    )


def build_404() -> str:
    data = load_content_page("404")
    body = data.get("body") or f"""<section class="page-404">
  <div>
    <p class="page-404__code">404</p>
    <h1 class="page-404__title">Такой страницы нет</h1>
    <p class="page-404__text">Возможно, страница переехала. Посмотрите реализованные проекты или напишите нам — подскажем, где искать.</p>
    <div class="btn-row" style="justify-content:center">
      <a class="btn btn--solid" href="index.html">На главную</a>
      <a class="btn btn--ghost" href="portfolio.html">Портфолио</a>
    </div>
  </div>
</section>"""
    return page(
        title="Страница не найдена — 40/60 Design",
        description="Страница не найдена. Перейдите в портфолио или на главную страницу сайта 40/60 Design.",
        canonical=SITE + "/404.html",
        body=body,
        page_css=data.get("css", "") + """
.err-title{font-family:var(--font-display) !important;font-weight:500 !important;letter-spacing:-.02em !important}
""",
        noindex=True,
    )


# --------------------------------------------------------------------------
# sitemap / robots
# --------------------------------------------------------------------------

def build_sitemap(paths: list[tuple[str, str]]) -> str:
    rows = []
    for loc, lastmod in paths:
        rows.append(
            f"  <url>\n    <loc>{SITE}/{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{'weekly' if loc in ('', 'portfolio.html', 'articles.html') else 'monthly'}</changefreq>\n"
            f"    <priority>{'1.0' if loc == '' else '0.9' if loc in ('portfolio.html', 'articles.html') else '0.7'}</priority>\n  </url>"
        )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(rows) + "\n</urlset>\n")


def build_robots() -> str:
    return f"""User-agent: *
Allow: /
Disallow: /preview/
Disallow: /admin/
Disallow: /_articles/
Disallow: /_projects/
Disallow: /_content/
Disallow: /_data/

Sitemap: {SITE}/sitemap.xml
"""


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main() -> int:
    site = load_site()
    all_projects = load_projects()
    projects = [p for p in all_projects if not p["draft"]]
    articles = load_articles()
    published = [a for a in articles if not a["draft"]]
    today = date.today().isoformat()

    write(ROOT / "index.html", build_index(site, projects, articles))
    write(ROOT / "portfolio.html", build_portfolio(projects))
    write(ROOT / "articles.html", build_articles_index(articles))

    generated: set[Path] = set()

    for p in projects:
        path = ROOT / "portfolio" / f"{p['slug']}.html"
        write(path, build_project(p, projects))
        generated.add(path)

    for p in all_projects:
        if p["draft"]:
            path = ROOT / "preview" / "portfolio" / f"{p['slug']}.html"
            write(path, build_project(p, projects, base="../../", noindex=True))
            generated.add(path)

    for a in published:
        path = ROOT / "articles" / f"{a['slug']}.html"
        write(path, build_article(a, articles))
        generated.add(path)

    for a in articles:
        if a["draft"]:
            path = ROOT / "preview" / f"{a['slug']}.html"
            write(path, build_article(a, articles, preview=True))
            generated.add(path)

    # убираем устаревшие сгенерированные страницы (удалённые проекты и статьи)
    for folder in (ROOT / "portfolio", ROOT / "articles", ROOT / "preview", ROOT / "preview" / "portfolio"):
        if not folder.is_dir():
            continue
        for stale in folder.glob("*.html"):
            if stale not in generated:
                stale.unlink()
                print("удалена устаревшая страница:", stale.relative_to(ROOT))

    for doc_name in ("about", "warranty", "partners"):
        doc = load_doc(doc_name)
        if doc:
            write(ROOT / f"{doc_name}.html", build_doc_page(doc, doc_name))
        else:
            warnings.append(f"нет _content/{doc_name}.md — страница не создана")

    write(ROOT / "404.html", build_404())

    for doc_name in ("standards", "requirements"):
        doc = load_doc(doc_name)
        if doc:
            write(ROOT / f"{doc_name}.html", build_doc_page(doc, doc_name))
        else:
            warnings.append(f"нет _content/{doc_name}.md — страница не создана")

    paths = [("", today), ("portfolio.html", today), ("articles.html", today),
             ("standards.html", today), ("requirements.html", today),
             ("about.html", today), ("warranty.html", today), ("partners.html", today)]
    paths += [(f"portfolio/{p['slug']}.html", today) for p in projects]
    paths += [(f"articles/{a['slug']}.html", iso_date(a["updated"] or a["date"])) for a in published]
    write(ROOT / "sitemap.xml", build_sitemap(paths))
    write(ROOT / "robots.txt", build_robots())

    print(f"Проектов: {len(projects)}")
    print(f"Статей: {len(published)} опубликовано, {sum(1 for a in articles if a['draft'])} черновиков")
    print(f"Страниц проектов: {len(projects)}")
    if warnings:
        print("\nПредупреждения:")
        for w in warnings:
            print("  -", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
