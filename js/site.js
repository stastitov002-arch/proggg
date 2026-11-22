/* 40/60 Design — общий скрипт сайта
   Шапка/меню, модальные окна, формы заявок, FAQ, галерея проекта,
   фильтрация портфолио (ИЛИ внутри группы, И между группами). */
(function () {
  'use strict';

  var LEAD_ENDPOINT = (document.querySelector('meta[name="lead-endpoint"]') || {}).content ||
    'https://hidden-bar-8272form-to-telegram.stas-titov-002.workers.dev';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var on = function (el, ev, fn, opts) { if (el) el.addEventListener(ev, fn, opts); };

  /* ---------------------------------------------------------------- шапка */
  function initHeader() {
    var hdr = $('.hdr');
    if (!hdr) return;
    var burger = $('.burger', hdr);
    var drawer = $('.drawer', hdr);
    if (!burger || !drawer) return;

    function setOpen(open) {
      hdr.classList.toggle('hdr--open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    }
    on(burger, 'click', function () { setOpen(!hdr.classList.contains('hdr--open')); });
    on(drawer, 'click', function (e) { if (e.target.closest('a')) setOpen(false); });
    on(document, 'keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    on(window, 'resize', function () { if (window.innerWidth > 1000) setOpen(false); });
  }

  /* --------------------------------------------------------------- модалки */
  var openModalEl = null;

  function openModal(name) {
    var m = document.getElementById('modal-' + name);
    if (!m) return;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    openModalEl = m;
    var body = m.querySelector('.modal__body');
    if (body) body.scrollTop = 0;
    var first = m.querySelector('input:not([type=hidden]),textarea,select,button');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 60);
  }

  function closeModal() {
    if (!openModalEl) return;
    var form = openModalEl.querySelector('form[data-lead-form]');
    if (form) sendDraft(form);
    openModalEl.classList.remove('is-open');
    openModalEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    openModalEl = null;
  }

  function initModals() {
    document.addEventListener('click', function (e) {
      var opener = e.target.closest('[data-modal-open]');
      if (opener) {
        e.preventDefault();
        var name = opener.getAttribute('data-modal-open');
        var project = opener.getAttribute('data-project');
        var projectSlug = opener.getAttribute('data-project-slug');
        if (name === 'lead' && project) {
          var inp = document.getElementById('lead-project');
          var lbl = document.getElementById('lead-project-label');
          var box = document.getElementById('lead-project-box');
          if (inp) inp.value = projectSlug || project;
          if (lbl) lbl.textContent = project;
          if (box) box.hidden = false;
        }
        openModal(name);
        return;
      }
      if (e.target.closest('[data-modal-close]')) { e.preventDefault(); closeModal(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  /* ---------------------------------------------------------------- формы */
  function sendLead(payload) {
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.ok) return { ok: true };
      return r.text().then(function (t) {
        var msg = 'Ошибка отправки';
        try { var j = JSON.parse(t); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      });
    });
  }

  /* Черновик формы: клиент заполнил, но не нажал «Отправить».
     Отправляем только если стоит галочка согласия и есть контакт. */
  function formDraftPayload(form) {
    var data = new FormData(form);
    var get = function (k) { return String(data.get(k) || '').trim(); };
    var name = get('name');
    var phone = get('phone');
    var tg = get('tg');
    var contact = get('contact');
    var sphere = get('sphere');
    var message = get('message');
    var project = get('project');

    var digits = phone.replace(/\D/g, '');
    var hasContact = digits.length >= 6 || tg.length > 0 || contact.length > 0;
    if (!hasContact) return null;

    var consent = form.querySelector('.consent input[type=checkbox]') || form.querySelector('input[type=checkbox]');
    if (consent && !consent.checked) return null;

    return {
      source: (form.getAttribute('data-source') || 'Заявка с сайта') + ' — НЕ ОТПРАВЛЕНО (черновик)',
      page: document.body.getAttribute('data-page') || '',
      name: name,
      phone: phone,
      tg: tg,
      contact: contact,
      sphere: sphere,
      message: '[Клиент заполнил форму, но не нажал «Отправить»]' + (message ? '\n' + message : ''),
      project: project
    };
  }

  function sendDraft(form) {
    if (!form || form.dataset.draftSent === '1' || form.dataset.sent === '1') return;
    if (form.style.display === 'none') return;
    var payload = formDraftPayload(form);
    if (!payload) return;
    form.dataset.draftSent = '1';
    try {
      fetch(LEAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  function initDraftSaves() {
    on(window, 'pagehide', function () {
      $$('form[data-lead-form]').forEach(sendDraft);
    });
  }

  function bindConsent(form) {
    var input = form.querySelector('.consent input[type=checkbox]') || form.querySelector('input[type=checkbox]');
    var wrap = input ? input.closest('label') : form.querySelector('.consent');
    var err = form.querySelector('.consent__err, [class*="consent-error"]');
    if (!input) return { check: function () { return true; } };
    on(input, 'change', function () {
      if (wrap) wrap.classList.remove('is-error');
      if (err) err.classList.remove('is-on');
      if (err) err.classList.remove('is-visible');
    });
    return {
      check: function () {
        if (input.checked) return true;
        if (wrap) wrap.classList.add('is-error');
        if (err) { err.classList.add('is-on'); err.classList.add('is-visible'); }
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        return false;
      }
    };
  }

  function initForms() {
    $$('form[data-lead-form]').forEach(function (form) {
      var consent = bindConsent(form);
      var btn = form.querySelector('[type=submit]');
      var success = form.parentNode.querySelector('.form-success, [class*="success"]');
      var errBox = form.querySelector('.form-error');

      on(form, 'submit', function (e) {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        if (!consent.check()) return;

        var data = new FormData(form);
        var sphere = String(data.get('sphere') || '').trim();
        var comment = String(data.get('message') || '').trim();
        var payload = {
          source: (form.getAttribute('data-source') || 'Заявка с сайта'),
          page: document.body.getAttribute('data-page') || '',
          name: String(data.get('name') || '').trim(),
          phone: String(data.get('phone') || '').trim(),
          tg: String(data.get('tg') || '').trim(),
          contact: String(data.get('contact') || '').trim(),
          sphere: sphere,
          message: [sphere ? 'Сфера: ' + sphere : '', comment].filter(Boolean).join('\n'),
          project: String(data.get('project') || '').trim()
        };

        var orig = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
        if (errBox) { errBox.hidden = true; errBox.textContent = ''; }

        sendLead(payload).then(function () {
          var scrollBox = form.closest('.modal__body');
          form.dataset.sent = '1';
          if (success) {
            form.style.display = 'none';
            success.classList.add('is-on');
            if (scrollBox) scrollBox.scrollTop = 0;
          } else {
            form.reset();
            if (btn) { btn.disabled = false; btn.textContent = 'Отправлено ✓'; }
          }
        }).catch(function (err) {
          if (btn) { btn.disabled = false; btn.textContent = orig; }
          if (errBox) {
            errBox.hidden = false;
            errBox.textContent = 'Не удалось отправить. Позвоните нам или попробуйте ещё раз. ' + (err.message || '');
          }
        });
      });
    });

    // сброс состояния модалки при закрытии
    $$('.modal').forEach(function (m) {
      m.addEventListener('transitionend', function () {});
    });
  }

  /* ------------------------------------------------------------ мессенджеры */
  function initTabs() {
    var tabs = $$('.tab[data-contact]');
    if (!tabs.length) return;
    var form = $('#contact-form');
    var field = $('#contact-value');
    var map = {
      telegram: '@username или телефон',
      whatsapp: '+7 (___) ___-__-__',
      vk: 'Ссылка на профиль',
      max: 'Телефон или @username'
    };
    tabs.forEach(function (tab) {
      on(tab, 'click', function () {
        tabs.forEach(function (t) { t.classList.remove('is-on'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('is-on');
        tab.setAttribute('aria-selected', 'true');
        var key = tab.getAttribute('data-contact');
        if (field && map[key]) field.placeholder = map[key];
        if (form) form.setAttribute('data-source', 'Сообщение — ' + tab.textContent.trim());
      });
    });
  }

  /* ------------------------------------------------------------------ FAQ */
  function initFaq() {
    $$('.faq__item').forEach(function (item) {
      var btn = $('.faq__q', item);
      var panel = $('.faq__a', item);
      if (!btn || !panel) return;
      on(btn, 'click', function () {
        var isOpen = item.classList.contains('faq__item--open');
        if (isOpen) {
          panel.style.maxHeight = '0px';
          item.classList.remove('faq__item--open');
          btn.setAttribute('aria-expanded', 'false');
        } else {
          item.classList.add('faq__item--open');
          btn.setAttribute('aria-expanded', 'true');
          panel.style.maxHeight = panel.scrollHeight + 'px';
        }
      });
    });
  }

  /* -------------------------------------------------------------- галерея */
  function initGallery() {
    var main = $('#gallery-main');
    var thumbs = $$('.gallery__thumb');
    if (!main || !thumbs.length) return;
    thumbs.forEach(function (thumb) {
      on(thumb, 'click', function () {
        var src = thumb.getAttribute('data-src');
        if (!src) return;
        main.src = src;
        var alt = thumb.getAttribute('data-alt');
        if (alt) main.alt = alt;
        thumbs.forEach(function (t) { t.setAttribute('aria-pressed', 'false'); });
        thumb.setAttribute('aria-pressed', 'true');
      });
    });
  }

  /* -------------------------------------------------- фильтр портфолио */
  function initPortfolioFilter() {
    var root = $('#pf');
    if (!root) return;

    var grid = $('#pf-grid');
    var cards = $$('.pcard', grid || root);
    var fields = {
      material: $('#pf-material'),
      type: $('#pf-type'),
      layout: $('#pf-layout'),
      budget: $('#pf-budget')
    };
    var island = $('#pf-island');
    var islandWrap = $('#pf-island-wrap');
    var counter = $('#pf-count');
    var reset = $('#pf-reset');
    var empty = $('#pf-empty');

    function snapshot() {
      var s = {};
      Object.keys(fields).forEach(function (k) {
        if (fields[k] && fields[k].value) s[k] = fields[k].value;
      });
      if (island && island.checked) s.island = '1';
      return s;
    }

    function readSaved() {
      var params = new URLSearchParams(location.search);
      var found = {};
      ['material', 'type', 'layout', 'budget', 'island'].forEach(function (k) {
        if (params.get(k)) found[k] = params.get(k);
      });
      if (Object.keys(found).length) return found;
      try { return JSON.parse(sessionStorage.getItem('pf') || '{}') || {}; } catch (e) { return {}; }
    }

    function persist() {
      var s = snapshot();
      try { sessionStorage.setItem('pf', JSON.stringify(s)); } catch (e) {}
      var q = new URLSearchParams();
      Object.keys(s).forEach(function (k) { q.set(k, s[k]); });
      var qs = q.toString();
      try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) {}
    }

    function matches(card) {
      var mat = fields.material.value;
      var type = fields.type.value;
      var lay = fields.layout.value;
      var bud = fields.budget.value;

      if (mat && (card.getAttribute('data-materials') || '').split('|').indexOf(mat) === -1) return false;
      if (type && card.getAttribute('data-type') !== type) return false;
      if (lay && (card.getAttribute('data-layouts') || '').split('|').indexOf(lay) === -1) return false;
      if (bud && card.getAttribute('data-budget') !== bud) return false;
      if (island && island.checked && card.getAttribute('data-island') !== '1') return false;
      return true;
    }

    function apply() {
      var shown = 0;
      cards.forEach(function (card) {
        var ok = matches(card);
        var item = card.closest('li') || card;
        item.hidden = !ok;
        if (ok) shown++;
      });

      if (counter) counter.innerHTML = 'Показано <b>' + shown + '</b> из <b>' + cards.length + '</b>';
      if (empty) empty.hidden = shown !== 0;

      Object.keys(fields).forEach(function (k) {
        if (fields[k]) fields[k].classList.toggle('is-active', !!fields[k].value);
      });
      if (islandWrap) islandWrap.classList.toggle('is-on', !!(island && island.checked));

      var any = !!Object.keys(snapshot()).length;
      if (reset) reset.classList.toggle('is-on', any);
      persist();
    }

    function restore() {
      var saved = readSaved();
      Object.keys(fields).forEach(function (k) {
        if (!fields[k] || !saved[k]) return;
        var ok = Array.prototype.some.call(fields[k].options, function (o) { return o.value === saved[k]; });
        if (ok) fields[k].value = saved[k];
      });
      if (island && saved.island === '1') island.checked = true;
    }

    Object.keys(fields).forEach(function (k) {
      on(fields[k], 'change', apply);
    });
    on(island, 'change', apply);
    on(reset, 'click', function () {
      Object.keys(fields).forEach(function (k) { if (fields[k]) fields[k].value = ''; });
      if (island) island.checked = false;
      apply();
    });

    var emptyReset = $('#pf-empty-reset');
    on(emptyReset, 'click', function () {
      Object.keys(fields).forEach(function (k) { if (fields[k]) fields[k].value = ''; });
      if (island) island.checked = false;
      apply();
    });

    restore();
    apply();
  }

  /* --------------------------------------------------- рубрики журнала */
  function initBlogFilter() {
    var bar = document.querySelector('[data-blog-filter]');
    if (!bar) return;
    var chips = $$('.fchip', bar);
    var items = $$('.acard-block');
    var empty = $('#blog-empty');
    if (!chips.length || !items.length) return;

    chips.forEach(function (chip) {
      on(chip, 'click', function (e) {
        e.preventDefault();
        var cat = chip.getAttribute('data-blog-filter') || '';
        chips.forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        chip.setAttribute('aria-pressed', 'true');
        var shown = 0;
        items.forEach(function (li) {
          var ok = !cat || li.getAttribute('data-cat') === cat;
          li.hidden = !ok;
          if (ok) shown++;
        });
        if (empty) empty.hidden = shown > 0;
      });
    });
  }

  /* --------------------------------------------------- возврат к фильтрам */
  function initBackLinks() {
    $$('[data-back]').forEach(function (link) {
      on(link, 'click', function (e) {
        var ref = document.referrer || '';
        var sameSite = false;
        try { sameSite = !!ref && new URL(ref).origin === location.origin; } catch (err) { sameSite = false; }
        if (sameSite && window.history.length > 1) {
          e.preventDefault();
          window.history.back();
        }
      });
    });
  }

  /* ------------------------------------- запоминание места в портфолио */
  function initPortfolioScrollMemory() {
    var grid = document.getElementById('pf-grid');
    if (!grid) return;
    var KEY = 'pf-scroll-pos';

    $$('.pcard', grid).forEach(function (card) {
      on(card, 'click', function () {
        try {
          sessionStorage.setItem(KEY, JSON.stringify({ y: window.scrollY, t: Date.now() }));
        } catch (e) {}
      });
    });

    var raw = null;
    try { raw = sessionStorage.getItem(KEY); } catch (e) {}
    if (!raw) return;

    var saved;
    try { saved = JSON.parse(raw); } catch (e) { saved = null; }
    if (!saved || typeof saved.y !== 'number') return;
    if (Date.now() - Number(saved.t || 0) > 10 * 60 * 1000) {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      return;
    }

    var ref = document.referrer || '';
    var fromProject = ref.indexOf('/portfolio/') !== -1 || ref.indexOf('portfolio/') !== -1;
    if (!fromProject) return;

    requestAnimationFrame(function () {
      var html = document.documentElement;
      var prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      window.scrollTo(0, saved.y);
      html.style.scrollBehavior = prev;
      setTimeout(function () {
        try { sessionStorage.removeItem(KEY); } catch (e) {}
      }, 600);
    });
  }

  /* ---------------------------------------------------------------- куки */
  function initCookie() {
    var bar = $('#cookie');
    if (!bar) return;
    var key = 'cookie-ok';
    var accepted = false;
    try { accepted = localStorage.getItem(key) === '1'; } catch (e) {}
    if (accepted) { bar.hidden = true; return; }

    setTimeout(function () {
      bar.hidden = false;
      document.body.classList.add('cookie-open');
    }, 1200);

    var btn = $('#cookie-ok');
    on(btn, 'click', function () {
      try { localStorage.setItem(key, '1'); } catch (e) {}
      bar.hidden = true;
      document.body.classList.remove('cookie-open');
    });
  }

  /* ----------------------------------------------------------- анимации */
  function initHero() {
    var hero = $('.hero');
    if (!hero) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    hero.classList.add('hero--anim');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { hero.classList.add('hero--in'); });
    });
    // страховка: если анимация почему-то не стартовала, контент всё равно показываем
    setTimeout(function () { hero.classList.add('hero--in'); }, 900);
  }

  function initImgFallback() {
    $$('img[data-fallback]').forEach(function (img) {
      var fail = function () {
        img.style.display = 'none';
        var parent = img.parentElement;
        if (parent && !parent.querySelector('.img-fallback')) {
          var fb = document.createElement('div');
          fb.className = 'img-fallback';
          parent.insertBefore(fb, parent.firstChild);
        }
      };
      img.addEventListener('error', fail);
      if (img.complete && img.naturalWidth === 0) fail();
    });
  }

  function initYear() {
    $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initHeader();
    initModals();
    initForms();
    initTabs();
    initFaq();
    initGallery();
    initPortfolioFilter();
    initBlogFilter();
    initBackLinks();
    initPortfolioScrollMemory();
    initDraftSaves();
    initCookie();
    initHero();
    initImgFallback();
    initYear();
  });

  window.SiteUI = { openModal: openModal, closeModal: closeModal };
})();
