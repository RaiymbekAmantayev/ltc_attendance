/* LTC · общие помощники для мини-аппа и админки (без сборки, без inline-обработчиков — совместимо с CSP). */
(function () {
  const LTC = {};

  LTC.esc = value => String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
  const esc = LTC.esc;

  LTC.$ = (selector, root = document) => root.querySelector(selector);
  LTC.$$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  /** Делегирование: on(root, 'click', '[data-act]', (el, event) => …) */
  LTC.on = (root, type, selector, handler) => root.addEventListener(type, event => {
    const el = event.target.closest(selector);
    if (el && root.contains(el)) handler(el, event);
  });

  /* ---------- Даты ---------- */
  LTC.localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  LTC.addDays = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  LTC.monthStart = iso => iso.slice(0, 7) + '-01';
  LTC.fmtDate = (iso, lang = 'ru') => {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', weekday: 'short', timeZone: 'UTC' });
  };
  LTC.short = iso => (iso || '').slice(5).split('-').reverse().join('.');

  /* ---------- Числа ---------- */
  LTC.pct = v => (v == null ? '—' : (Math.round(v) === v ? v : v.toFixed(1)) + '%');
  LTC.num = v => (v == null ? '—' : String(v));
  LTC.initial = name => (String(name || '?').trim()[0] || '?').toUpperCase();
  /** Светофор по проценту: ниже low — красный, ниже ok — жёлтый. */
  LTC.sev = (v, low = 60, ok = 80) => (v == null ? '' : v < low ? 'sev-crit' : v < ok ? 'sev-warn' : 'sev-ok');

  /* ---------- Диаграммы: только столбцы ---------- */
  /** rows: [{label, value, max?, text?, sev?}] */
  LTC.hbars = (rows, { max } = {}) => {
    const top = max ?? Math.max(1, ...rows.map(r => r.value || 0));
    return rows.map(r => `
      <div class="hbar-row">
        <div class="hbar-lab" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="hbar-track"><div class="hbar-fill ${r.sev || ''}" style="width:${Math.max(r.value ? 2 : 0, Math.min(100, ((r.value || 0) / top) * 100))}%"></div></div>
        <div class="hbar-val">${esc(r.text ?? r.value ?? 0)}</div>
      </div>`).join('');
  };
  /** cols: [{label, value, sev?}] */
  LTC.vbars = cols => {
    const top = Math.max(1, ...cols.map(c => c.value || 0));
    return `<div class="vbars">${cols.map(c => `
      <div class="vbar-col">
        <div class="vbar-val">${c.value || ''}</div>
        <div class="vbar-track"><div class="vbar-fill ${c.sev || ''}" style="height:${c.value ? Math.max(4, (c.value / top) * 100) : 0}%"></div></div>
        <div class="vbar-lab">${esc(c.label)}</div>
      </div>`).join('')}</div>`;
  };

  /* ---------- Тема ---------- */
  const THEME_KEY = 'ltc-theme';
  const store = {
    get: key => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* приватный режим */ } },
  };
  LTC.store = store;

  LTC.initTheme = (tgApp) => {
    const saved = store.get(THEME_KEY);
    const theme = saved || (tgApp && tgApp.colorScheme) || 'dark';
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    syncTelegramColors(tgApp);
  };
  LTC.toggleTheme = (tgApp) => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set(THEME_KEY, next);
    syncTelegramColors(tgApp);
  };
  function syncTelegramColors(tgApp) {
    if (!tgApp || !tgApp.setHeaderColor) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    try { tgApp.setHeaderColor(bg); tgApp.setBackgroundColor(bg); tgApp.setBottomBarColor && tgApp.setBottomBarColor(bg); } catch { /* старые клиенты */ }
  }

  LTC.icons = {
    sun: '<svg class="ic-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg class="ic-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  };
  LTC.themeButton = () => `<button class="iconbtn" data-act="theme" aria-label="Theme" title="Theme">${LTC.icons.sun}${LTC.icons.moon}</button>`;

  /* ---------- Уведомление и окно ---------- */
  let toastTimer;
  LTC.toast = (text, kind = '') => {
    let el = LTC.$('.toast');
    if (!el) { el = document.createElement('div'); el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.className = 'toast ' + kind;
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 3200);
  };

  LTC.modal = {
    el: null,
    ensure() {
      if (this.el) return this.el;
      const el = document.createElement('div');
      el.className = 'modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      el.innerHTML = '<div class="modal-sheet"><div class="modal-head"><div class="modal-title"></div><button class="modal-x" data-modal-close aria-label="Close">×</button></div><div class="modal-body"></div></div>';
      el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-modal-close]')) this.close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
      document.body.appendChild(el);
      return (this.el = el);
    },
    open(title, html) {
      const el = this.ensure();
      LTC.$('.modal-title', el).textContent = title;
      LTC.$('.modal-body', el).innerHTML = html;
      el.classList.add('open');
      return LTC.$('.modal-body', el);
    },
    close() { if (this.el) this.el.classList.remove('open'); },
  };

  /* ---------- CSV (Excel-совместимый: разделитель «;», BOM) ---------- */
  LTC.csv = (name, head, rows) => {
    const q = v => { v = v == null ? '' : String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head.join(';')].concat(rows.map(r => r.map(q).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  LTC.loader = '<div class="loader"><i></i></div>';

  window.LTC = LTC;
})();
