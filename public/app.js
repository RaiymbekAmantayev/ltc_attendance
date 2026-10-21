/* LTC · Личный кабинет преподавателя — ядро мини-аппа: вход, занятия, экран группы, профиль, оффлайн-очередь. */
(function () {
  const { $, $$, on, esc } = LTC;
  const tg = window.Telegram && window.Telegram.WebApp;
  const root = document.getElementById('app');

  const APP = (window.APP = {
    tg, views: {},
    state: { lang: LTC.store.get('ltc-lang') || null, me: null, tab: null, date: LTC.localToday(), group: null, rejected: [], offline: false },
  });
  const state = APP.state;
  const T = () => TEXTS[state.lang || 'ru'];
  const fmt = (text, vars = {}) => String(text).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? '');
  APP.T = T; APP.fmt = fmt;

  /* ============ API ============ */

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-init-data': (tg && tg.initData) || '' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw Object.assign(new Error('network'), { status: 0, network: true }); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || String(res.status)), { status: res.status, data });
    return data;
  }
  APP.api = api;
  const errText = e => (e.network ? T().offline : T().errors[e.message] || e.message);
  APP.errText = errText;

  /* Кэш на время сессии (не localStorage): состав группы содержит ПДн и не должен переживать закрытие приложения. */
  const session = {
    get: k => { try { return JSON.parse(sessionStorage.getItem('c:' + k)); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem('c:' + k, JSON.stringify(v)); } catch { /* переполнено */ } },
    del: k => { try { sessionStorage.removeItem('c:' + k); } catch { /* */ } },
  };
  async function cached(key, load) {
    try { const value = await load(); session.set(key, value); state.offline = false; return value; }
    catch (e) {
      const hit = e.network && session.get(key);
      if (hit) { state.offline = true; return hit; }
      throw e;
    }
  }

  /* ============ Оффлайн-очередь (разд. 7.3 ТЗ) ============ */

  const queue = {
    all: () => { try { return JSON.parse(localStorage.getItem('queue') || '[]'); } catch { return []; } },
    set: items => LTC.store.set('queue', JSON.stringify(items)),
    add: item => queue.set([...queue.all(), item]),
    remove: key => queue.set(queue.all().filter(p => p.key !== key)),
    has: (groupId, date) => queue.all().some(p => p.groupId === groupId && p.date === date),
  };
  APP.queue = queue;

  let flushing = false;
  // Сетевые сбои оставляют запись в очереди; отказ по данным (400/403/409/422) — снимает и показывает причину.
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const payload of queue.all()) {
        const { groupName, ...body } = payload;
        try {
          await api('/lessons', { method: 'POST', body });
          queue.remove(payload.key);
          session.del(`roster:${payload.groupId}:${payload.date}`);        // список группы после отправки не храним
        } catch (e) {
          if ([400, 403, 409, 422].includes(e.status)) {
            queue.remove(payload.key);
            state.rejected.push({ name: groupName || payload.groupId, reason: errText(e) });
          } else break;
        }
      }
    } finally { flushing = false; updateBanner(); }
  }
  APP.flush = flush;

  function updateBanner() {
    const el = $('#banner');
    if (!el) return;
    const parts = [];
    if (state.offline) parts.push(`<div class="insight"><div><div class="insight-title">${esc(T().offline)}</div></div></div>`);
    const n = queue.all().length;
    if (n) parts.push(`<div class="insight"><div><div class="insight-title">⏳ ${esc(fmt(T().queued, { n }))}</div></div></div>`);
    for (const r of state.rejected) parts.push(`<div class="insight crit"><div><div class="insight-title">${esc(fmt(T().rejected, r))}</div></div></div>`);
    el.innerHTML = parts.join('');
  }
  APP.updateBanner = updateBanner;

  /* ============ Оболочка ============ */

  const ICONS = {
    lessons: '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M9 15l2 2 4-4"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    groups: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 5 5"/>',
    teachers: '<path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11.5V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>',
  };
  const tabsFor = me => {
    const staff = me.role === 'coordinator' || me.role === 'director';
    return [...(staff ? ['overview', 'groups', 'teachers'] : []), ...(me.canMark ? ['lessons', 'profile'] : [])];
  };

  function shell() {
    const me = state.me;
    root.innerHTML = `
      <header class="appbar">
        <img class="brand-logo" src="/assets/logo.webp" alt="LTC">
        <div class="brand-txt"><div class="brand-title">LTC</div><div class="brand-sub" id="sub"></div></div>
        <div class="spacer"></div>
        <button class="iconbtn" data-act="lang" aria-label="Language">${(state.lang || 'ru').toUpperCase()}</button>
        ${LTC.themeButton()}
      </header>
      <div class="content"><div id="banner"></div><div id="view" class="view"></div></div>
      <nav class="mobile-nav"><div class="mobile-nav-inner" id="nav"></div></nav>`;
    $('#sub').textContent = `${me.name || ''} · ${T().roles[me.role] || ''}`;
    $('#nav').innerHTML = tabsFor(me).map(id => `
      <button class="nav-btn" data-tab="${id}" aria-selected="${id === state.tab}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[id]}</svg>
        <span>${esc(T().nav[id])}</span>
      </button>`).join('');
    updateBanner();
  }

  async function go(tab) {
    state.tab = tab; state.group = null;
    if (tg) tg.BackButton.hide();
    $$('.nav-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    window.scrollTo(0, 0);
    const view = $('#view');
    view.innerHTML = LTC.loader;
    try { await APP.views[tab](view); }
    catch (e) { view.innerHTML = errorBox(e); }
    updateBanner();
  }
  APP.go = go;
  APP.errorBox = errorBox;
  function errorBox(e) {
    return `<div class="empty">${esc(T().error)}: ${esc(errText(e))}<br><br><button class="btn ghost" data-act="reload">${esc(T().retry)}</button></div>`;
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }

  /* ============ Экран 1: «Мои занятия» ============ */

  const STATUS_CHIP = { none: '', pending: 'warn', partial: 'warn', attention: 'bad', done: 'good' };

  function lessonCard(l) {
    const t = T();
    const status = queue.has(l.id, state.date) ? 'pending' : l.status;
    const meta = [l.branch, l.days, l.students != null ? `${l.students} ${t.students}` : ''].filter(Boolean).join(' · ');
    return `
      <button class="tcard" data-group="${esc(l.id)}" data-name="${esc(l.name)}">
        <div class="tcard-top">
          <div class="avatar">${esc(LTC.initial(l.name))}</div>
          <div class="tcard-meta"><div class="tcard-name">${esc(l.name)}</div><div class="tcard-sub">${esc(meta)}</div></div>
          <div class="tcard-val">${esc(l.time || '')}</div>
        </div>
        <div class="tags">
          <span class="chip ${STATUS_CHIP[status] || ''}">${esc(t.status[status])}</span>
          ${l.substitution ? `<span class="chip brand">${esc(t.substitution)}</span>` : ''}
          ${(status === 'partial' || status === 'attention') && l.total ? `<span class="chip">${esc(fmt(t.written, l))}</span>` : ''}
        </div>
      </button>`;
  }

  APP.views.lessons = async view => {
    const t = T(), today = LTC.localToday();
    view.innerHTML = `
      <h2 class="title">${esc(t.lessonsTitle)}</h2>
      <div class="datebar">
        <button class="iconbtn" data-act="day" data-n="-1" aria-label="−1">‹</button>
        <input type="date" id="date" value="${state.date}">
        <button class="iconbtn" data-act="day" data-n="1" aria-label="+1">›</button>
        ${state.date !== today ? `<button class="pill" data-act="today">${esc(t.today)}</button>` : ''}
      </div>
      <div id="list">${LTC.loader}</div>`;
    const date = state.date;
    try {
      const lessons = await cached(`lessons:${date}`, () => api('/lessons?date=' + date));
      if (date !== state.date) return;                         // пользователь уже перешёл на другую дату
      $('#list').innerHTML = lessons.length ? lessons.map(lessonCard).join('') : `<div class="empty">${esc(t.noLessons)}</div>`;
    } catch (e) { $('#list').innerHTML = errorBox(e); }
    updateBanner();
  };

  /* ============ Экран 2: группа ============ */

  // Навыки с fixed (8 → всегда 45) в интерфейсе не показываем — их подставляет сервер.
  const skillsOf = () => ((state.me.testing && state.me.testing.skills) || []).filter(k => !k.fixed);

  /* Персональный тест урока (не больше одного): категория → тип теста HollyHop → навыки. */
  const personalCats = () => state.me.personalTests || [];
  const personalCat = id => personalCats().find(c => String(c.id) === String(id)) || null;
  const personalType = (categoryId, typeId) => {
    const c = personalCat(categoryId);
    return (c && c.types.find(x => String(x.id) === String(typeId))) || null;
  };
  /** Текущий выбор на экране: {category, type} (type = null, пока тип не выбран) либо null. */
  function personalChoice() {
    const cat = personalCat($('#pcat')?.value);
    if (!cat) return null;
    return { category: cat, type: cat.types.length === 1 ? cat.types[0] : personalType(cat.id, $('#ptype').value) };
  }

  function personalBlock(saved) {
    const t = T(), p = saved?.personal, cat = p ? personalCat(p.categoryId) : null;
    const opt = (value, label, on) => `<option value="${esc(value)}" ${on ? 'selected' : ''}>${esc(label)}</option>`;
    return `<div class="ptest"><div class="skills-title">${esc(t.personalTest)}</div>
      <div class="row">
        <select id="pcat" class="field grow">${opt('', t.personalNone, !cat)}${personalCats().map(c => opt(c.id, c.name, cat && c.id === cat.id)).join('')}</select>
        <select id="ptype" class="field grow" ${cat && cat.types.length > 1 ? '' : 'hidden'}>${cat && cat.types.length > 1
          ? opt('', t.personalPickType, false) + cat.types.map(x => opt(x.id, x.name, x.id === p.testTypeId)).join('') : ''}</select>
      </div></div>`;
  }

  /** Поля навыков персонального теста в карточке ученика (при повторном выборе того же типа значения сохраняются). */
  function paintPersonal(card, saved) {
    const box = $('.pskills', card), choice = personalChoice(), type = choice && choice.type;
    box.hidden = !type || card.dataset.status === 'absent';
    if (!type) { box.innerHTML = ''; box.dataset.type = ''; return; }
    if (box.dataset.type === `${choice.category.id}:${type.id}`) return;
    box.dataset.type = `${choice.category.id}:${type.id}`;
    const values = saved || {};
    box.innerHTML = `<div class="skills-title">${esc(choice.category.name)}${choice.category.types.length > 1 ? ' · ' + esc(type.name) : ''}</div>
      <div class="skills-grid">${type.skills.map(k => `<label class="sk"><span>${esc(k.name)}<em>0–${k.max}</em></span>
        <input class="pskill" type="text" inputmode="decimal" autocomplete="off" data-skill="${k.id}" data-max="${k.max}" value="${esc(values[k.id] ?? '')}"></label>`).join('')}</div>`;
  }

  /* Тема из КТП: темы уровня группы по категориям; выбор подставляет тему урока (её можно дописать). */
  const ktpTopic = id => (state.ktp?.categories || []).flatMap(c => c.topics).find(x => String(x.id) === String(id)) || null;
  const ktpLabel = x => [x.num != null ? `${x.num}.` : '', x.week ? fmt(T().ktpWeek, { n: x.week }) : '', x.lesson ? fmt(T().ktpLesson, { n: x.lesson }) : '', x.title]
    .filter(Boolean).join(' ');

  function ktpBlock(saved) {
    const t = T(), ktp = state.ktp;
    if (!ktp?.categories.length) return '';
    const selected = String(saved?.ktpTopicId ?? '');
    return `<select id="ktp" class="field"><option value="">${esc(fmt(t.ktpPick, { level: ktp.level }))}</option>
      ${ktp.categories.map(c => `<optgroup label="${esc(c.name)}">${c.topics.map(x =>
        `<option value="${x.id}" ${String(x.id) === selected ? 'selected' : ''}>${esc(ktpLabel(x))}</option>`).join('')}</optgroup>`).join('')}
      </select><div id="ktp-info" class="ktp-info"></div>`;
  }

  /** Подсказка по выбранной теме: страница SB, грамматика, лексика, ДЗ, контроль. */
  function paintKtpInfo() {
    const box = $('#ktp-info'); if (!box) return;
    const t = T(), x = ktpTopic($('#ktp').value);
    const rows = x ? [[t.ktpSection, x.section], [t.ktpPage, x.sb_page], [t.ktpGrammar, x.grammar], [t.ktpVocabulary, x.vocabulary],
      [t.ktpHomework, x.homework], [t.ktpTest, x.test_control]].filter(([, v]) => v) : [];
    box.hidden = !rows.length;
    box.innerHTML = rows.map(([k, v]) => `<div class="mrow"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
  }

  function studentCard(s, saved, readOnly) {
    const t = T();
    const status = saved.status || 'present';
    const seg = (value, cls) => `<button type="button" class="${cls} ${status === value ? 'on' : ''}" data-st="${value}" aria-pressed="${status === value}">${esc(t[value])}</button>`;
    // Навык с значением по умолчанию подставляется в новую отметку; в сохранённой показываем то, что записано.
    const skill = k => {
      const value = saved.status ? (saved.skills ? saved.skills[k.id] : '') : (k.default ?? '');
      return `<label class="sk"><span>${esc(k.name || fmt(t.skill, { id: k.id }))}<em>0–${k.max}</em></span>
        <input class="skill" type="text" inputmode="decimal" autocomplete="off"
          data-skill="${k.id}" data-max="${k.max}" data-default="${k.default ?? ''}" value="${esc(value ?? '')}"></label>`;
    };
    return `
      <div class="scard" data-student="${esc(s.id)}" data-name="${esc(s.name)}" data-status="${status}">
        <div class="tcard-top"><div class="avatar">${esc(LTC.initial(s.name))}</div><div class="tcard-name grow">${esc(s.name)}</div></div>
        <div class="seg3" role="group">${seg('present', 'p')}${seg('absent', 'a')}</div>
        <div class="skills" ${status === 'absent' ? 'hidden' : ''}><div class="skills-title">${esc(t.test)}</div><div class="skills-grid">${skillsOf().map(skill).join('')}</div></div>
        <div class="pskills" hidden></div>
      </div>`;
  }

  async function openGroup(groupId, groupName) {
    const t = T(), date = state.date, view = $('#view');
    state.group = { id: groupId, name: groupName };
    if (tg) tg.BackButton.show();
    window.scrollTo(0, 0);
    view.innerHTML = LTC.loader;
    try {
      const { students, submitted, ktp } = await cached(`roster:${groupId}:${date}`, () => api(`/groups/${groupId}/students?date=${date}`));
      const queuedItem = queue.all().find(p => p.groupId === groupId && p.date === date);
      const saved = submitted?.payload || (queuedItem && { topic: queuedItem.topic, ktpTopicId: queuedItem.ktpTopicId, personal: queuedItem.personal, students: queuedItem.students });
      state.ktp = ktp || null;
      const readOnly = !!saved;
      const byId = id => saved?.students.find(s => s.id === id) || {};
      const status = queuedItem && !submitted ? 'pending' : submitted?.status;
      const note = { attention: t.attentionNote, partial: t.partialNote, pending: t.pendingNote }[status];

      view.innerHTML = `
        <h2 class="title">${esc(groupName)}</h2>
        <div class="hint">${esc(LTC.fmtDate(date, state.lang))}</div>
        ${readOnly ? `<div class="insight ${status === 'attention' ? 'crit' : status === 'done' ? 'ok' : ''}"><div>
            <div class="insight-title">🔒 ${esc(t.readOnly)}</div>
            <div class="insight-body"><span class="chip ${STATUS_CHIP[status] || ''}">${esc(t.status[status] || '')}</span> ${note ? esc(note) : ''}</div></div></div>` : ''}
        <fieldset class="${readOnly ? 'lock' : ''}" ${readOnly ? 'disabled' : ''}>
          ${ktpBlock(saved)}
          <input type="text" id="topic" class="field" placeholder="${esc(t.topic)}" maxlength="500" value="${esc(saved?.topic || '')}">
          ${personalBlock(saved)}
          ${students.map(s => studentCard(s, byId(s.id), readOnly)).join('')}
        </fieldset>
        ${readOnly ? '' : `<div class="savebar"><button class="btn block" id="save">${esc(t.save)}</button></div>`}`;
      $$('.scard').forEach(card => paintPersonal(card, byId(card.dataset.student).personalSkills));
      paintKtpInfo();
    } catch (e) { view.innerHTML = errorBox(e); }
  }

  function closeGroup() { if (tg) tg.BackButton.hide(); go('lessons'); }

  /** Чтение формы + проверка правил ввода (разд. 5 ТЗ). Возвращает {students} либо {error, card}. */
  function collect() {
    const t = T(), rules = state.me.rules, config = skillsOf();
    const topic = $('#topic').value.trim();                // тема урока = комментарий в HollyHop
    if (rules.commentRequired && !topic) return { error: t.needTopic, card: $('#topic') };
    const choice = personalChoice();
    if (choice && !choice.type) return { error: t.needPersonalType, card: $('#ptype') };
    const personal = choice && { categoryId: choice.category.id, testTypeId: choice.type.id };
    const students = [];
    for (const card of $$('.scard')) {
      const s = { id: card.dataset.student, name: card.dataset.name, status: card.dataset.status, skills: null, personalSkills: null };
      const fail = text => ({ error: text, card });
      if (s.status !== 'absent') {
        const values = Object.fromEntries($$('.skill', card).map(i => [i.dataset.skill, i.value.trim().replace(',', '.')]));
        // Тест есть, если заполнены навыки без значения по умолчанию; тогда нужен полный набор (требование HollyHop).
        const required = config.filter(k => k.default == null);
        if (required.some(k => values[k.id] !== '')) {
          const skills = {};
          for (const k of config) {
            const raw = values[k.id] !== '' ? values[k.id] : k.default != null ? String(k.default) : '';
            if (raw === '') return fail(fmt(t.needTestFull, { skill: config.map(x => x.name || x.id).join(', '), name: s.name }));
            const n = Number(raw);
            if (!Number.isFinite(n)) return fail(fmt(t.badScore, s));
            if (n < 0 || n > k.max) return fail(fmt(t.scoreRange, { skill: k.name || k.id, max: k.max, name: s.name }));
            skills[k.id] = n;
          }
          s.skills = skills;
        } else return fail(fmt(t.needTest, s));                // ежедневный тест обязателен

        // Персональный тест — по желанию для каждого ученика, но если начат, нужен полный набор навыков.
        if (choice) {
          const raw = $$('.pskill', card).map(i => i.value.trim().replace(',', '.'));
          if (raw.some(v => v !== '')) {
            const skills = {};
            for (const [i, k] of choice.type.skills.entries()) {
              if (raw[i] === '') return fail(fmt(t.needTestFull, { skill: choice.type.skills.map(x => x.name).join(', '), name: s.name }));
              const n = Number(raw[i]);
              if (!Number.isFinite(n)) return fail(fmt(t.badScore, s));
              if (n < 0 || n > k.max) return fail(fmt(t.scoreRange, { skill: k.name, max: k.max, name: s.name }));
              skills[k.id] = n;
            }
            s.personalSkills = skills;
          }
        }
      }
      students.push(s);
    }
    if (personal && !students.some(s => s.personalSkills)) return { error: fmt(t.needPersonalScores, { test: choice.category.name }), card: $('#pcat') };
    const personalName = choice && [choice.category.name, choice.category.types.length > 1 ? choice.type.name : ''].filter(Boolean).join(' · ');
    return { students, personal, personalName };
  }

  function confirmSave() {
    const t = T(), result = collect();
    if (result.error) {
      LTC.toast(result.error, 'bad');
      result.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const body = LTC.modal.open(t.confirmTitle, `
      ${result.personal ? `<p>${esc(t.personalTest)}: <b>${esc(result.personalName)}</b> · ${result.students.filter(x => x.personalSkills).length} ${esc(t.students)}</p>` : ''}
      <div class="callout">${esc(t.confirmText)}</div>
      <div class="row"><button class="btn ghost grow" data-modal-close>${esc(t.cancel)}</button><button class="btn grow" id="confirm">${esc(t.confirmYes)}</button></div>`);
    $('#confirm', body).onclick = async () => {
      $('#confirm', body).disabled = true;
      LTC.modal.close();
      const g = state.group;
      queue.add({                                              // сначала в память телефона, затем отправка
        key: uuid(), groupId: g.id, groupName: g.name, date: state.date, topic: $('#topic').value.trim(), ktpTopicId: Number($('#ktp')?.value) || null, personal: result.personal,
        students: result.students.map(({ name, ...s }) => s),
      });
      await flush();
      const left = queue.has(g.id, state.date);
      LTC.toast(left ? T().queuedToast : T().saved, left ? '' : 'good');
      if (tg && tg.HapticFeedback) try { tg.HapticFeedback.notificationOccurred(left ? 'warning' : 'success'); } catch { /* */ }
      closeGroup();
    };
  }

  /* ============ Профиль ============ */

  APP.views.profile = async view => {
    const t = T(), p = await api('/profile');
    const c = p.checklist;
    view.innerHTML = `
      <h2 class="title">${esc(t.profileTitle)} · ${esc(p.month)}</h2>
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">${esc(t.lessonsMonth)}</div><div class="kpi-value">${p.lessons}</div><div class="kpi-sub">${p.students} ${esc(t.students)}</div></div>
        <div class="kpi ${LTC.sev(p.attendanceRate).replace('sev-crit', 'sev-crit')}"><div class="kpi-label">${esc(t.attendance)}</div><div class="kpi-value">${LTC.pct(p.attendanceRate)}</div></div>
        <div class="kpi ${LTC.sev(p.onTimeRate, 70, 90)}"><div class="kpi-label">${esc(t.onTime)}</div><div class="kpi-value">${LTC.pct(p.onTimeRate)}</div></div>
        <div class="kpi"><div class="kpi-label">${esc(t.avgTest)}</div><div class="kpi-value">${LTC.pct(p.avgTest)}</div></div>
      </div>
      <div class="card"><div class="card-title">${esc(t.checklist)}</div>
        ${LTC.hbars([
          { label: t.status.done, value: c.done, sev: 'sev-ok' },
          { label: t.status.pending, value: c.pending, sev: 'sev-warn' },
          { label: t.status.partial, value: c.partial, sev: 'sev-warn' },
          { label: t.status.attention, value: c.attention, sev: 'sev-crit' },
        ], { max: Math.max(1, p.lessons) })}
      </div>
      <div class="card"><div class="card-title">${esc(t.recent)}</div>
        ${p.recent.length ? `<div class="tscroll"><table><tr><th>${esc(t.subDate)}</th><th class="left">${esc(t.groupsTitle)}</th><th></th></tr>
          ${p.recent.map(r => `<tr><td>${esc(LTC.short(r.date))}</td><td class="left">${esc(r.group)}<br><span class="mut">${r.onTime ? esc(t.onTimeYes) : esc(t.onTimeNo)} · ${r.students} ${esc(t.students)}</span></td>
            <td><span class="chip ${STATUS_CHIP[r.status] || ''}">${esc(t.status[r.status])}</span></td></tr>`).join('')}</table></div>`
          : `<div class="empty">${esc(t.noRecent)}</div>`}
      </div>`;
  };

  /* ============ События ============ */

  on(root, 'click', '[data-tab]', el => go(el.dataset.tab));
  on(root, 'click', '[data-act]', el => {
    const act = el.dataset.act;
    if (act === 'theme') LTC.toggleTheme(tg);
    else if (act === 'lang') {
      state.lang = state.lang === 'en' ? 'ru' : 'en';
      LTC.store.set('ltc-lang', state.lang);
      shell(); go(state.tab);
    }
    else if (act === 'reload') go(state.tab);
    else if (act === 'day') { state.date = LTC.addDays(state.date, Number(el.dataset.n)); go('lessons'); }
    else if (act === 'today') { state.date = LTC.localToday(); go('lessons'); }
  });
  on(root, 'change', '#date', el => { if (/^\d{4}-\d\d-\d\d$/.test(el.value)) { state.date = el.value; go('lessons'); } });
  on(root, 'click', '.tcard[data-group]', el => openGroup(el.dataset.group, el.dataset.name));
  on(root, 'click', '[data-st]', el => {
    const card = el.closest('.scard');
    card.dataset.status = el.dataset.st;
    $$('[data-st]', card).forEach(b => { const on = b === el; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('.skills', card).hidden = el.dataset.st === 'absent';
    paintPersonal(card);
  });
  on(root, 'change', '#pcat', el => {
    const cat = personalCat(el.value), type = $('#ptype');
    type.hidden = !cat || cat.types.length < 2;
    type.innerHTML = type.hidden ? '' : `<option value="">${esc(T().personalPickType)}</option>` + cat.types.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    $$('.scard').forEach(card => paintPersonal(card));
  });
  on(root, 'change', '#ktp', el => {
    const x = ktpTopic(el.value);
    if (x) $('#topic').value = x.title.slice(0, 500);
    paintKtpInfo();
  });
  on(root, 'change', '#ptype', () => $$('.scard').forEach(card => paintPersonal(card)));
  on(root, 'click', '#save', confirmSave);

  /* ============ Старт ============ */

  async function boot() {
    LTC.initTheme(tg);
    if (tg) { tg.ready(); tg.expand(); tg.BackButton.onClick(() => { if (state.group) closeGroup(); }); }
    state.lang = state.lang || 'ru';

    if (!tg || !tg.initData) {
      root.innerHTML = `<div class="empty" style="padding-top:30vh">${esc(TEXTS.ru.openInTelegram)}<br>${esc(TEXTS.en.openInTelegram)}</div>`;
      return;
    }
    try { state.me = await api('/me'); }
    catch (e) {
      const id = tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : '';
      root.innerHTML = `<div class="empty" style="padding-top:26vh"><img class="brand-logo" src="/assets/logo.webp" alt="LTC"><p>${esc(e.status === 403 ? TEXTS.ru.notRegistered : errText(e))}</p>
        ${e.status === 403 ? `<h2 class="title" style="font-size:28px">${esc(id)}</h2><p class="mut">${esc(TEXTS.en.notRegistered)}</p>` : ''}</div>`;
      return;
    }
    if (!LTC.store.get('ltc-lang')) state.lang = state.me.lang || 'ru';        // язык из реестра: Local → RU, Foreign → EN
    state.tab = tabsFor(state.me)[0];
    shell();
    flush();
    await go(state.tab);

    setInterval(flush, 30000);
    addEventListener('online', flush);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  }
  APP.boot = boot;
  APP.collect = collect;
  boot();
})();
