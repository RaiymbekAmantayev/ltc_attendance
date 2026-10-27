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

  /* ---------- XLSX (один лист, без зависимостей: zip без сжатия + SpreadsheetML) ---------- */
  const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const zipStore = files => {
    const enc = new TextEncoder(), parts = [], dir = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
      loc.setUint32(14, crc, true); loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, name.length, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      parts.push(loc, name, data); dir.push(cen, name);
      offset += 30 + name.length + data.length;
    }
    const dirSize = dir.reduce((s, p) => s + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...dir, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  LTC.xlsx = (name, head, rows, sheetName = 'Лист1') => {
    const x = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
    const col = i => (i >= 26 ? col(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
    const cell = (v, ref, s) => v == null || v === '' ? ''
      : typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}" s="${s}"><v>${v}</v></c>`
      : `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    const all = [head, ...rows];
    const widths = head.map((_, c) => Math.min(60, Math.max(8, ...all.map(r => String(r[c] ?? '').length + 2))));
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${all.map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, col(c) + (i + 1), i ? 2 : 1)).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${col(head.length - 1)}${all.length}"/></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE7F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const blob = zipStore([
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(String(sheetName).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${x(String(sheetName).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).replace(/'/g, "''"))}'!$A$1:$${col(head.length - 1)}$${all.length}</definedName></definedNames></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  LTC.loader = '<div class="loader"><i></i></div>';

  window.LTC = LTC;
})();
