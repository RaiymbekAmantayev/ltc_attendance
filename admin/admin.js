/* LTC · Админка: обзор, преподаватели и роли, замены, отметки, аудит, правила. Basic-auth на стороне сервера. */
(function () {
  const { $, $$, on, esc } = LTC;
  const main = $('#main'), root = document.getElementById('app');

  const TABS = [['overview', 'Обзор'], ['teachers', 'Преподаватели'], ['subs', 'Замены'], ['subm', 'Отметки'], ['export', 'Выгрузка'], ['ktp', 'КТП'], ['audit', 'Аудит'], ['rules', 'Правила']];
  const STATUS = { done: ['good', '✅ В HollyHop'], pending: ['warn', '⏳ Ждёт отправки'], partial: ['warn', '⚠️ Частично'], attention: ['bad', '⚠️ Нужно внимание'] };
  const ROLE = { teacher: 'Преподаватель', coordinator: 'Координатор', director: 'Директор' };
  const ACTION = {
    save: 'Отметка сохранена', synced: 'Записано в HollyHop', retry: 'Повтор отправки', attention: 'Нужно внимание',
    teacher_create: 'Сотрудник добавлен', teacher_update: 'Сотрудник изменён', teacher_import: 'Импорт из HollyHop',
    substitution_add: 'Замена назначена', substitution_remove: 'Замена снята',
    ktp_category_add: 'КТП: категория добавлена', ktp_category_rename: 'КТП: категория переименована', ktp_category_remove: 'КТП: категория удалена',
    ktp_topic_add: 'КТП: тема добавлена', ktp_topic_update: 'КТП: тема изменена', ktp_topic_remove: 'КТП: тема удалена', ktp_import: 'КТП: вставка из Excel',
  };
  const chip = s => `<span class="chip ${STATUS[s]?.[0] || ''}">${esc(STATUS[s]?.[1] || s)}</span>`;
  const state = { tab: 'overview', period: null, subm: { date: '', from: '', to: '', status: '' }, auditAction: '', q: '', roleFilter: '', ktp: { category: '', level: '' } };
  const SKILL_NAMES = { 131: { 8: 'Was present for (min)', 11: 'Homework', 9: 'Engagement', 10: 'Discipline', 17: 'Discipline/Engagement' },
    132: { 8: 'Was present for (min)', 13: 'Домашнее задание', 9: 'Активность', 10: 'Дисциплина', 18: 'Дисциплина/Активность' } };   // 17/18 — старые отметки
  const skillName = (type, id) => (SKILL_NAMES[type] || SKILL_NAMES[132])[id] || `№${id}`;
  const PERSONAL_CATS = { 1: 'Progress Test', 4: 'Final Test', 6: 'Entry test', 5: 'Revise&Check', 45: 'File Test NEF' };
  const PERSONAL_SKILLS = { 1: 'Listening', 2: 'Reading', 3: 'Grammar', 4: 'Vocabulary', 5: 'Pronunciation', 6: 'Speaking', 7: 'Writing', 16: 'Practical English', 21: 'Attendance' };
  const personalLabel = p => (p.personal ? `${PERSONAL_CATS[p.personal.categoryId] || p.personal.categoryId} (тип ${p.personal.testTypeId})` : '');
  const personalScores = s => (s.personalSkills ? Object.entries(s.personalSkills).map(([k, v]) => `${PERSONAL_SKILLS[k] || '№' + k}: ${v}`).join(' · ') : '—');
  const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/admin-api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch { /* пустой ответ */ }
    if (!res.ok) throw new Error(data.error || 'Ошибка ' + res.status);
    return data;
  }

  /* ---------- Каркас ---------- */
  LTC.initTheme(null);
  $('[data-act="theme"]').innerHTML = LTC.icons.sun + LTC.icons.moon;
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button class="segbtn" role="tab" data-tab="${id}" aria-selected="false">${esc(label)}</button>`).join('');

  const views = {};
  async function show(tab) {
    state.tab = tab;
    $$('.segbtn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    main.innerHTML = LTC.loader;
    try { await views[tab](); }
    catch (e) { main.innerHTML = `<div class="empty err">${esc(e.message)}<br><br><button class="btn ghost" data-act="reload">Повторить</button></div>`; }
  }
  on(root, 'click', '[data-tab]', el => show(el.dataset.tab));
  on(root, 'click', '[data-act="theme"]', () => LTC.toggleTheme(null));
  on(root, 'click', '[data-act="reload"]', () => show(state.tab));

  /* ---------- Период ---------- */
  const preset = name => {
    const today = LTC.localToday();
    return name === 'today' ? { preset: name, from: today, to: today }
      : name === 'week' ? { preset: name, from: LTC.addDays(today, -6), to: today }
      : { preset: 'month', from: LTC.monthStart(today), to: today };
  };
  state.period = preset('month');
  const periodBar = () => {
    const p = state.period, pill = (id, label) => `<button class="pill ${p.preset === id ? 'active' : ''}" data-preset="${id}">${label}</button>`;
    return `<div class="toolbar">${pill('today', 'Сегодня')}${pill('week', 'Неделя')}${pill('month', 'Месяц')}
      <input type="date" id="p-from" value="${p.from}"><span class="mut">—</span><input type="date" id="p-to" value="${p.to}">
      <button class="btn sm" data-act="period-go">Показать</button></div>`;
  };
  on(root, 'click', '[data-preset]', el => { state.period = preset(el.dataset.preset); show(state.tab); });
  on(root, 'click', '[data-act="period-go"]', () => {
    const f = $('#p-from').value, t = $('#p-to').value;
    if (f && t) { state.period = { preset: 'custom', from: f <= t ? f : t, to: f <= t ? t : f }; show(state.tab); }
  });
  const qs = () => `from=${state.period.from}&to=${state.period.to}`;

  /* ---------- Обзор ---------- */
  let teacherStats = [];
  views.overview = async () => {
    const [ov, today, ts] = await Promise.all([api('/overview?' + qs()), api('/today'), api('/teacher-stats?' + qs())]);
    teacherStats = ts;
    const k = ov.kpi, s = ov.statuses, pend = today.pending || [];
    main.innerHTML = `
      ${periodBar()}
      <div class="kpi-grid wide">
        <div class="kpi"><div class="kpi-label">Занятий отмечено</div><div class="kpi-value">${k.lessons}</div><div class="kpi-sub">${k.teachersWorking} из ${k.activeTeachers} преподавателей</div></div>
        <div class="kpi"><div class="kpi-label">Учеников отмечено</div><div class="kpi-value">${k.students}</div></div>
        <div class="kpi ${LTC.sev(k.attendanceRate)}"><div class="kpi-label">Посещаемость</div><div class="kpi-value">${LTC.pct(k.attendanceRate)}</div></div>
        <div class="kpi ${LTC.sev(k.onTimeRate, 70, 90)}"><div class="kpi-label">Отмечено в день урока</div><div class="kpi-value">${LTC.pct(k.onTimeRate)}</div><div class="kpi-sub">цель пилота — задать</div></div>
        <div class="kpi ${LTC.sev(k.syncedRate, 80, 95)}"><div class="kpi-label">Записано в HollyHop</div><div class="kpi-value">${LTC.pct(k.syncedRate)}</div></div>
        <div class="kpi ${LTC.sev(k.testPassRate, 60, 80)}"><div class="kpi-label">Порог теста</div><div class="kpi-value">${LTC.pct(k.testPassRate)}</div><div class="kpi-sub">средний тест ${LTC.pct(k.avgTest)}</div></div>
      </div>
      <div class="grid2">
        <div class="card"><div class="card-title">Сегодня ${today.error ? '<span class="chip warn">расписание HollyHop недоступно</span>' : `<span class="chip ${pend.length ? 'warn' : 'good'}">${today.marked} / ${today.expected}</span>`}</div>
          ${today.error ? '' : pend.length ? `<div class="msec-title">Ещё не отмечено</div>` + pend.map(g => `<div class="mrow"><span>${esc(g.name)}<br><span class="mut">${esc([g.branch, g.time].filter(Boolean).join(' · '))}</span></span><span class="v">${esc(g.teacher || '')}${g.substitution ? ' <span class="chip brand">замена</span>' : ''}</span></div>`).join('') : '<p class="hint">Все занятия отмечены</p>'}
        </div>
        <div class="card"><div class="card-title">Отметки по дням</div>${LTC.vbars(ov.byDay.slice(-31).map(d => ({ label: LTC.short(d.date), value: d.count })))}</div>
        <div class="card"><div class="card-title">Посещаемость</div>${LTC.hbars([
          { label: 'Был', value: ov.attendance.present, sev: 'sev-ok' }, { label: 'Пропуск', value: ov.attendance.absent, sev: 'sev-crit' }])}</div>
        <div class="card"><div class="card-title">Статусы записи</div>${LTC.hbars([
          { label: 'В HollyHop', value: s.done, sev: 'sev-ok' }, { label: 'Ждёт отправки', value: s.pending, sev: 'sev-warn' },
          { label: 'Частично', value: s.partial, sev: 'sev-warn' }, { label: 'Нужно внимание', value: s.attention, sev: 'sev-crit' }])}</div>
      </div>
      <div class="card"><div class="card-title">Проблемные отметки</div>
        ${ov.problems.length ? `<div class="tscroll"><table><tr><th>Дата</th><th class="left">Группа</th><th class="left">Автор</th><th class="left">Статус</th><th class="left">Ошибка</th><th></th></tr>
          ${ov.problems.map(p => `<tr><td>${esc(p.date)}</td><td class="left">${esc(p.group)}</td><td class="left">${esc(p.teacher)}</td><td class="left">${chip(p.status)}</td>
            <td class="left"><span class="mut">${esc(p.error || '')}</span></td><td class="act"><button class="btn sm" data-retry="${esc(p.key)}">Повторить</button></td></tr>`).join('')}</table></div>`
          : '<div class="empty">✅ Проблем нет</div>'}
      </div>
      <div class="card"><div class="card-title">Преподаватели за период <button class="btn ghost sm" data-act="csv-tstats" style="margin-left:auto">📥 CSV</button></div>
        <div class="tscroll"><table><tr><th>Преподаватель</th><th>Занятий</th><th>Учеников</th><th>Посещ.</th><th>В день урока</th><th>В HollyHop</th><th>Проблем</th><th>Последнее</th></tr>
          ${ts.map(x => `<tr class="${x.active ? '' : 'off'}"><td class="left"><span class="tcell-name">${esc(x.name)}</span><br><span class="mut">${esc(x.branch || '')}${x.hasTelegram ? '' : ' · нет Telegram ID'}</span></td>
            <td>${x.lessons}</td><td>${x.students}</td><td class="${LTC.sev(x.attendance)}">${LTC.pct(x.attendance)}</td><td class="${LTC.sev(x.onTime, 70, 90)}">${LTC.pct(x.onTime)}</td>
            <td>${x.done}</td><td class="${x.problems ? 'sev-crit' : ''}">${x.problems}</td><td>${esc(x.last || '—')}</td></tr>`).join('')}</table></div>
      </div>`;
  };
  on(root, 'click', '[data-act="csv-tstats"]', () => LTC.csv(`LTC_teachers_${state.period.from}_${state.period.to}.csv`,
    ['Преподаватель', 'Филиал', 'Занятий', 'Учеников', 'Посещаемость %', 'В день урока %', 'В HollyHop', 'Проблем', 'Последнее занятие'],
    teacherStats.map(x => [x.name, x.branch, x.lessons, x.students, x.attendance, x.onTime, x.done, x.problems, x.last])));
  on(root, 'click', '[data-retry]', async el => {
    el.disabled = true;
    try { const r = await api(`/submissions/${el.dataset.retry}/retry`, { method: 'POST' }); LTC.toast('Статус: ' + (STATUS[r.status]?.[1] || r.status), r.status === 'done' ? 'good' : 'bad'); show(state.tab); }
    catch (e) { LTC.toast(e.message, 'bad'); el.disabled = false; }
  });

  /* ---------- Преподаватели ---------- */
  let teachers = [];
  const teacherRows = () => {
    const q = state.q.toLowerCase();
    return teachers.filter(t => (!q || String(t.full_name || '').toLowerCase().includes(q)) && (!state.roleFilter || t.role === state.roleFilter));
  };
  const paintTeachers = () => {
    const list = teacherRows();
    $('#ttable').innerHTML = `<tr><th class="left">ФИО</th><th class="left">Роль</th><th class="left">Telegram ID</th><th class="left">HollyHop ID</th><th class="left">Филиал</th><th>Язык</th><th>Активен</th><th></th></tr>` +
      list.map(t => `<tr class="${t.active ? '' : 'off'}"><td class="left tcell-name">${esc(t.full_name)}</td><td class="left">${esc(ROLE[t.role])}</td>
        <td class="left">${t.telegram_id ? esc(t.telegram_id) : '<span class="err">нет</span>'}</td><td class="left">${esc(t.hollihop_id || '—')}</td><td class="left">${esc(t.branch || '')}</td>
        <td>${t.lang === 'en' ? 'EN' : 'RU'}</td><td>${t.active ? '✅' : '—'}</td><td class="act"><button class="btn ghost sm" data-edit="${t.id}">Изменить</button></td></tr>`).join('');
  };
  views.teachers = async () => {
    teachers = await api('/teachers');
    main.innerHTML = `
      <div class="toolbar">
        <button class="btn" data-act="add-teacher">+ Добавить</button>
        <button class="btn ghost" data-act="import">Подтянуть из HollyHop</button>
        <input type="search" id="tsearch" placeholder="Поиск по ФИО" value="${esc(state.q)}">
        <select id="trole"><option value="">Все роли</option>${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${state.roleFilter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button class="btn ghost sm" data-act="xlsx-teachers" style="margin-left:auto">📥 Excel</button>
      </div>
      <p class="note">Без Telegram ID вход невозможен. Неактивные скрыты от приложения. Директору и координатору HollyHop ID не нужен — они видят разделы руководства.</p>
      <div class="card"><div class="tscroll"><table id="ttable"></table></div></div>`;
    paintTeachers();
  };
  on(root, 'input', '#tsearch', el => { state.q = el.value; paintTeachers(); });
  on(root, 'change', '#trole', el => { state.roleFilter = el.value; paintTeachers(); });
  // ID — строкой, чтобы Excel не превращал длинные Telegram ID в 1,23E+09
  on(root, 'click', '[data-act="xlsx-teachers"]', () => LTC.xlsx('LTC_staff.xlsx', ['ФИО', 'Роль', 'Telegram ID', 'HollyHop ID', 'Филиал', 'Язык', 'Активен'],
    teacherRows().map(t => [t.full_name, ROLE[t.role], t.telegram_id == null ? '' : String(t.telegram_id), t.hollihop_id == null ? '' : String(t.hollihop_id), t.branch, t.lang === 'en' ? 'EN' : 'RU', t.active ? 'да' : 'нет']), 'Сотрудники'));

  const teacherForm = t => `
    <div class="form-grid">
      <label class="full">ФИО<input id="f-name" value="${esc(t.full_name)}" placeholder="Иванова Анна"></label>
      <label>Telegram ID (число)<input id="f-tg" inputmode="numeric" value="${esc(t.telegram_id)}"></label>
      <label>HollyHop ID<input id="f-hh" value="${esc(t.hollihop_id)}"></label>
      <label>Филиал<input id="f-branch" value="${esc(t.branch)}"></label>
      <label>Роль<select id="f-role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${t.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Язык интерфейса<select id="f-lang"><option value="ru" ${t.lang !== 'en' ? 'selected' : ''}>Local → русский</option><option value="en" ${t.lang === 'en' ? 'selected' : ''}>Foreign → English</option></select></label>
      <label class="check"><input type="checkbox" id="f-active" ${t.active ? 'checked' : ''}> активен</label>
    </div>
    <div class="row" style="margin-top:14px"><button class="btn grow" data-act="save-teacher" data-id="${t.id || 0}">Сохранить</button><button class="btn ghost" data-modal-close>Отмена</button></div>`;
  const editTeacher = id => {
    const t = teachers.find(x => x.id === id) || { lang: 'ru', active: 1, role: 'teacher' };
    LTC.modal.open(id ? 'Редактирование' : 'Новый сотрудник', teacherForm(t));
  };
  on(document.body, 'click', '[data-edit]', el => editTeacher(Number(el.dataset.edit)));
  on(document.body, 'click', '[data-act="add-teacher"]', () => editTeacher());
  on(document.body, 'click', '[data-act="save-teacher"]', async el => {
    try {
      await api('/teachers', { method: 'POST', body: {
        id: Number(el.dataset.id) || undefined, full_name: $('#f-name').value, telegram_id: $('#f-tg').value, hollihop_id: $('#f-hh').value,
        branch: $('#f-branch').value, role: $('#f-role').value, lang: $('#f-lang').value, active: $('#f-active').checked } });
      LTC.modal.close(); LTC.toast('Сохранено', 'good'); show('teachers');
    } catch (e) { LTC.toast(e.message, 'bad'); }
  });
  on(root, 'click', '[data-act="import"]', async () => {
    try { const { added } = await api('/teachers/import', { method: 'POST' }); LTC.toast(`Добавлено новых: ${added}. Они неактивны — впишите Telegram ID и включите «активен».`, 'good'); show('teachers'); }
    catch (e) { LTC.toast(e.message, 'bad'); }
  });

  /* ---------- Замены ---------- */
  // Кто занят во время выбранного занятия: { teacherId: [{group, time}] } — такого назначить нельзя.
  let subTeachers = [], busy = {};
  const busyText = list => 'занят ' + list.map(x => `${x.time} · ${x.group}`).join('; ');
  views.subs = async () => {
    const [all, subs] = await Promise.all([api('/teachers'), api('/substitutions')]);
    subTeachers = all.filter(t => t.active && t.role === 'teacher');
    busy = {};
    main.innerHTML = `
      <div class="card"><div class="card-title">Замена на дату</div>
        <p class="hint">Заменяющий увидит группу только в этот день. В журнале фиксируется реальный автор отметки.</p>
        <div class="toolbar"><input type="date" id="s-date" value="${LTC.localToday()}"><select id="s-group" class="grow"></select><select id="s-teacher" class="grow"></select>
        <button class="btn" data-act="add-sub">Назначить</button></div>
        <div id="s-busy" class="err" hidden></div></div>
      <div class="card"><div class="card-title">Последние замены</div>
        ${subs.length ? `<div class="tscroll"><table><tr><th>Дата</th><th class="left">Группа (ID)</th><th class="left">Заменяет</th><th></th></tr>
          ${subs.map(x => `<tr><td>${esc(x.lesson_date)}</td><td class="left">${esc(x.group_id)}</td><td class="left">${esc(x.full_name)}</td><td class="act"><button class="btn ghost sm" data-rm-sub="${x.id}">Убрать</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Замен нет</div>'}</div>`;
    loadGroups();
  };
  async function loadGroups() {
    const select = $('#s-group'); if (!select) return;
    select.innerHTML = '<option>загрузка…</option>';
    try {
      const groups = await api('/groups?date=' + $('#s-date').value);
      select.innerHTML = groups.length ? groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)} · ${esc(g.branch)} ${esc(g.time)}</option>`).join('') : '<option value="">в этот день занятий нет</option>';
    } catch (e) { select.innerHTML = `<option value="">${esc(e.message)}</option>`; }
    loadBusy();
  }
  /** Занятость преподавателей на время выбранной группы: занятые помечены красным в списке. */
  async function loadBusy() {
    const select = $('#s-teacher'); if (!select) return;
    const group = $('#s-group').value, date = $('#s-date').value, chosen = select.value;
    busy = {};
    if (group) {
      try { busy = await api(`/substitutions/busy?date=${date}&group=${encodeURIComponent(group)}`); }
      catch (e) { LTC.toast('Не удалось проверить занятость: ' + e.message, 'bad'); }
    }
    select.innerHTML = subTeachers.map(t => busy[t.id]
      ? `<option value="${t.id}" class="busy">${esc(t.full_name)} — ${esc(busyText(busy[t.id]))}</option>`
      : `<option value="${t.id}">${esc(t.full_name)}</option>`).join('');
    if (chosen) select.value = chosen;
    paintBusy();
  }
  /** Выбран занятый преподаватель — ошибка под списком, кнопка «Назначить» недоступна. */
  function paintBusy() {
    const box = $('#s-busy'), select = $('#s-teacher');
    if (!box || !select) return;   // ушли с вкладки, пока ждали ответ
    const list = busy[select.value];
    box.hidden = !list;
    box.textContent = list ? `Нельзя выбрать этого преподавателя: на это время есть занятие (${busyText(list)})` : '';
    $('[data-act="add-sub"]').disabled = !!list;
  }
  on(root, 'change', '#s-date', loadGroups);
  on(root, 'change', '#s-group', loadBusy);
  on(root, 'change', '#s-teacher', paintBusy);
  on(root, 'click', '[data-act="add-sub"]', async () => {
    if (busy[$('#s-teacher').value]) return paintBusy();
    try { await api('/substitutions', { method: 'POST', body: { group_id: $('#s-group').value, lesson_date: $('#s-date').value, substitute_id: $('#s-teacher').value } }); LTC.toast('Замена назначена', 'good'); show('subs'); }
    catch (e) { LTC.toast(e.message, 'bad'); }
  });
  on(root, 'click', '[data-rm-sub]', async el => { await api('/substitutions/' + el.dataset.rmSub, { method: 'DELETE' }); show('subs'); });

  /* ---------- Отметки ---------- */
  let submissions = [];
  views.subm = async () => {
    const f = state.subm;
    if (!f.from) { f.from = LTC.addDays(LTC.localToday(), -6); f.to = LTC.localToday(); }
    const params = new URLSearchParams({ from: f.from, to: f.to, status: f.status });
    submissions = await api('/submissions?' + params);
    main.innerHTML = `
      <div class="toolbar">
        <input type="date" id="m-from" value="${f.from}"><span class="mut">—</span><input type="date" id="m-to" value="${f.to}">
        <select id="m-status"><option value="">Все статусы</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${esc(v[1])}</option>`).join('')}</select>
        <span class="mut">${submissions.length} записей</span>
        <button class="btn ghost sm" data-act="csv-subm" style="margin-left:auto">📥 CSV</button>
      </div>
      <div class="card"><div class="tscroll"><table><tr><th>Занятие</th><th class="left">Группа</th><th class="left">Автор</th><th class="left">Статус</th><th class="left">Данные</th><th></th></tr>
        ${submissions.map((x, i) => { const p = parse(x.payload); return `<tr><td>${esc(x.lesson_date)}</td>
          <td class="left">${esc(x.group_name || x.group_id)}<br><span class="mut">${esc(x.group_id)}</span></td><td class="left">${esc(x.full_name)}</td>
          <td class="left">${chip(x.status)}${x.last_error ? `<br><span class="mut">${esc(x.last_error)}</span>` : ''}</td>
          <td class="left"><button class="btn ghost sm" data-detail="${i}">${p.students.length} уч.${p.topic ? ' · ' + esc(p.topic.slice(0, 24)) : ''}</button></td>
          <td class="act">${x.status !== 'done' ? `<button class="btn sm" data-retry="${esc(x.idem_key)}">Повторить</button>` : ''}</td></tr>`; }).join('')}</table></div>
        ${submissions.length ? '' : '<div class="empty">Нет отметок за период</div>'}</div>`;
  };
  on(root, 'change', '#m-from', el => { state.subm.from = el.value; show('subm'); });
  on(root, 'change', '#m-to', el => { state.subm.to = el.value; show('subm'); });
  on(root, 'change', '#m-status', el => { state.subm.status = el.value; show('subm'); });
  on(root, 'click', '[data-detail]', el => {
    const x = submissions[Number(el.dataset.detail)], p = parse(x.payload), pr = parse(x.progress) || [];
    const label = { present: 'Был', late: 'Был', absent: 'Пропуск' };      // late — старые отметки
    LTC.modal.open(`${x.group_name || x.group_id} · ${x.lesson_date}`, `
      <div class="mrow"><span class="k">Автор</span><span class="v">${esc(x.full_name)}</span></div>
      <div class="mrow"><span class="k">Сохранено</span><span class="v">${esc(x.created_at)} UTC</span></div>
      <div class="mrow"><span class="k">Тема</span><span class="v">${esc(p.topic || '—')}</span></div>
      <div class="mrow"><span class="k">Доп. тест</span><span class="v">${esc(personalLabel(p) || '—')}</span></div>
      <div class="mrow"><span class="k">Шагов записано</span><span class="v">${pr.length}</span></div>
      <div class="mrow"><span class="k">Попыток подряд</span><span class="v">${x.attempts}</span></div>
      <div class="msec-title">Ученики (ID HollyHop)</div>
      <div class="tscroll"><table><tr><th class="left">ID</th><th class="left">Статус</th><th class="left">Тест (навык: балл)</th>${p.personal ? '<th class="left">Доп. тест</th>' : ''}<th class="left">Комментарий</th></tr>
      ${p.students.map(s => `<tr><td class="left"><span data-hh-id="${esc(s.id)}">…</span><br><span class="mut">ClientId ${esc(s.id)}</span></td><td class="left">${label[s.status]}</td><td class="left">${s.skills ? Object.entries(s.skills).map(([k, v]) => `${skillName(p.testTypeId, k)}: ${v}`).join(' · ') : '—'}</td>${p.personal ? `<td class="left">${esc(personalScores(s))}</td>` : ''}<td class="left">${esc(s.comment)}</td></tr>`).join('')}</table></div>`);
    // В отметке хранится ClientId (по нему идёт запись в HollyHop); Id ученика подтягиваем отдельно.
    api('/student-ids?clientIds=' + p.students.map(s => s.id).join(','))
      .then(ids => document.querySelectorAll('[data-hh-id]').forEach(el => { el.textContent = ids[el.dataset.hhId] ?? '—'; }))
      .catch(() => document.querySelectorAll('[data-hh-id]').forEach(el => { el.textContent = '—'; }));
  });
  on(root, 'click', '[data-act="csv-subm"]', () => LTC.csv('LTC_submissions.csv', ['Дата занятия', 'Группа ID', 'Группа', 'Автор', 'Статус', 'Тема', 'Ученик ID', 'Статус ученика', 'Присутствовал (мин), 8', 'Homework, 11', 'Домашнее задание, 13', 'Engagement / Активность, 9', 'Discipline / Дисциплина, 10', 'Discipline/Engagement (старое), 17', 'Дисциплина/Активность (старое), 18', 'Доп. тест', 'Доп. тест: баллы', 'Комментарий'],
    submissions.flatMap(x => { const p = parse(x.payload); return p.students.map(s => [x.lesson_date, x.group_id, x.group_name, x.full_name, x.status, p.topic, s.id, s.status, s.skills?.[8], s.skills?.[11], s.skills?.[13], s.skills?.[9], s.skills?.[10], s.skills?.[17], s.skills?.[18], personalLabel(p), s.personalSkills ? personalScores(s) : '', s.comment]); })));

  /* ---------- Выгрузка: расписание (HollyHop), фактические отметки по дням, тесты учеников ---------- */
  /** Расчётный период по умолчанию: с 21-го числа по 20-е следующего месяца. */
  const payPeriod = () => {
    const today = LTC.localToday(), [y, m, d] = today.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1 - (d >= 21 ? 0 : 1), 21));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 20));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  };
  state.exp = { ...payPeriod(), kind: 'schedule', sheet: 'foreign' };
  let expCache = {};                                     // переключение листа не перезапрашивает HollyHop
  views.export = async () => {
    const f = state.exp, schedule = f.kind === 'schedule', range = `from=${f.from}&to=${f.to}`, key = `${f.kind}:${range}`;
    // Расписание — тяжёлый запрос к HollyHop: только по кнопке «Показать», не при открытии раздела или вкладки.
    const requested = f.go; f.go = false;
    const rep = expCache[key] || (schedule && !requested ? null : (expCache[key] = await api(`/export/${f.kind}?${range}`)));
    const tests = f.kind === 'tests';
    if (rep && !tests && !rep.sheets.some(x => x.key === f.sheet)) f.sheet = rep.sheets[0].key;
    const sheet = rep && rep.sheets.find(x => x.key === f.sheet);
    const pill = (attr, value, label, active) => `<button class="pill ${active ? 'active' : ''}" ${attr}="${value}">${esc(label)}</button>`;
    const day = d => (schedule ? `${Number(d.slice(8))}.${d.slice(5, 7)}` : String(Number(d.slice(8))));
    main.innerHTML = `
      <div class="toolbar">
        <input type="date" id="e-from" value="${f.from}"><span class="mut">—</span><input type="date" id="e-to" value="${f.to}">
        <button class="btn sm" data-act="exp-go">Показать</button>
        ${pill('data-exp-kind', 'schedule', 'Расписание', schedule)}${pill('data-exp-kind', 'submissions', 'Фактические отметки', f.kind === 'submissions')}${pill('data-exp-kind', 'tests', 'Тесты учеников', tests)}
        ${rep ? `<a class="btn ghost sm" style="margin-left:auto" href="/admin-api/export/${f.kind}?${range}&format=xlsx" download>📥 Excel</a>` : ''}
      </div>
      <p class="hint">${schedule
        ? 'Уроки по расписанию HollyHop: сколько занятий по группам у преподавателя в каждый день. Ак. час — 45 минут. Ставку и ЗП заполните в Excel — ЗП посчитается формулой.'
        : tests ? 'Результаты доп. тестов по каждому ученику (по листу на категорию) и средние баллы ежедневного теста. Только тесты, внесённые через кабинет. Период — до года.'
        : 'Уроки, которые преподаватели отметили в кабинете и отправили в HollyHop, по дням. Автор — тот, кто заполнил (в том числе на замене).'}</p>
      ${tests ? testsView(rep, f) : rep ? `<div class="toolbar">${rep.sheets.map(x => pill('data-exp-sheet', x.key, `${x.name} · ${x.rows.length}`, x.key === f.sheet)).join('')}</div>
      <div class="card"><div class="tscroll"><table class="exp">
        <tr><th>№</th><th class="left">ФИО</th><th class="left">Должность</th>${rep.days.map(d => `<th>${esc(day(d))}</th>`).join('')}<th>Уроков</th>${schedule ? '<th>Ак. часы</th>' : ''}</tr>
        ${sheet.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="left">${esc(r.name)}</td><td class="left">${esc(r.position)}</td>
          ${rep.days.map(d => `<td>${r.counts[d] || ''}</td>`).join('')}<td><b>${r.lessons}</b></td>${schedule ? `<td>${r.hours}</td>` : ''}</tr>`).join('')}
      </table></div>${sheet.rows.length ? '' : '<div class="empty">Нет данных за период</div>'}</div>`
      : '<div class="card"><div class="empty">Выберите период и нажмите «Показать» — расписание загрузится из HollyHop</div></div>'}`;
  };
  /** Тесты учеников: «Отчет» по уровням или лист категории / Daily test. */
  const BANDS = [['good', '≥80%', 'sev-ok'], ['mid', '70–79%', 'sev-warn'], ['bad', '<70%', 'sev-crit']];
  const bandOf = pct => (pct >= 0.8 ? BANDS[0] : pct >= 0.7 ? BANDS[1] : BANDS[2]);
  const pct = v => `${(v * 100).toFixed(1)}%`;
  function testsView(rep, f) {
    const pill = (key, label) => `<button class="pill ${key === f.sheet ? 'active' : ''}" data-exp-sheet="${key}">${esc(label)}</button>`;
    if (f.sheet !== 'summary' && !rep.sheets.some(x => x.key === f.sheet)) f.sheet = 'summary';
    const pills = `<div class="toolbar">${pill('summary', 'Отчет')}${rep.sheets.map(x => pill(x.key, `${x.name} · ${x.rows.length}`)).join('')}</div>`;
    if (f.sheet === 'summary') {
      if (!rep.summary.length) return `${pills}<div class="card"><div class="empty">Нет доп. тестов за период</div></div>`;
      return pills + rep.summary.map(b => {
        const total = b.levels.reduce((a, l) => ({ count: a.count + l.count, good: a.good + l.good, mid: a.mid + l.mid, bad: a.bad + l.bad }), { count: 0, good: 0, mid: 0, bad: 0 });
        return `<div class="card"><div class="card-title">${esc(b.name)}</div><div class="tscroll"><table class="exp">
          <tr><th class="left">Уровень</th><th>Количество сдавших</th>${BANDS.map(([, label]) => `<th>${label}</th>`).join('')}</tr>
          ${b.levels.map(l => `<tr><td class="left">${esc(l.level)}</td><td>${l.count}</td>${BANDS.map(([k]) => `<td>${l[k]}</td>`).join('')}</tr>`).join('')}
          <tr><td class="left"><b>Итого</b></td><td><b>${total.count}</b></td>${BANDS.map(([k, , cls]) => `<td class="${cls}">${total[k]} · ${total.count ? Math.round(total[k] / total.count * 100) : 0}%</td>`).join('')}</tr>
        </table></div></div>`;
      }).join('');
    }
    const sheet = rep.sheets.find(x => x.key === f.sheet);
    const info = (r, key) => (key === 'date' ? r.date.split('-').reverse().join('.') : r[key]);
    return `${pills}<div class="card"><div class="tscroll"><table class="exp">
      <tr><th>№</th><th class="left">Ученик</th><th class="left">Преподаватель</th><th class="left">Группа</th><th class="left">Уровень</th>
        ${sheet.info.map(([, label]) => `<th>${esc(label)}</th>`).join('')}
        ${sheet.skills.map(k => `<th>${esc(k.name)}${k.max != null ? `<br><span class="mut">${k.max}</span>` : ''}</th>`).join('')}
        <th>${sheet.average ? 'Средний балл' : 'Результат'}</th><th>%</th></tr>
      ${sheet.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="left">${esc(r.student)}</td><td class="left">${esc(r.teacher)}</td><td class="left">${esc(r.group)}</td><td class="left">${esc(r.level)}</td>
        ${sheet.info.map(([key]) => `<td>${esc(info(r, key))}</td>`).join('')}
        ${sheet.skills.map(k => { const v = r.scores[k.id]; return `<td${Number(v) === 0 ? ' class="sev-crit"' : ''}>${v ?? ''}</td>`; }).join('')}
        <td><b>${r.total}</b> / ${r.max}</td><td class="${bandOf(r.pct)[2]}">${pct(r.pct)}</td></tr>`).join('')}
    </table></div></div>`;
  }
  on(root, 'click', '[data-act="exp-go"]', () => {
    const a = $('#e-from').value, b = $('#e-to').value;
    if (a && b) { Object.assign(state.exp, a <= b ? { from: a, to: b } : { from: b, to: a }, { go: true }); expCache = {}; show('export'); }
  });
  on(root, 'click', '[data-exp-kind]', el => { state.exp.kind = el.dataset.expKind; show('export'); });
  on(root, 'click', '[data-exp-sheet]', el => { state.exp.sheet = el.dataset.expSheet; show('export'); });

  /* ---------- КТП: категории и темы по уровням ---------- */
  // Колонки в порядке таблицы КТП — в этом же порядке вставляются строки из Excel.
  const KTP_COLS = [['num', '№'], ['week', 'Неделя'], ['day', 'День'], ['lesson', 'Урок'], ['teacher', 'Препод'], ['section', 'Секция'], ['sb_page', 'Стр.SB'],
    ['title', 'Тема / раздел книги'], ['role', 'Роль'], ['grammar', 'Грам./фокус'], ['vocabulary', 'Лексика'], ['homework', 'Домашнее задание (из книги)'], ['test_control', 'Тест/контроль']];
  let ktpCats = [], ktpLevels = [], ktpTopics = [];
  const ktpOptions = (list, value) => list.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');

  views.ktp = async () => {
    [ktpCats, ktpLevels] = await Promise.all([api('/ktp/categories'), api('/ktp/levels')]);
    const f = state.ktp;
    if (!ktpCats.some(c => String(c.id) === String(f.category))) f.category = ktpCats[0] ? String(ktpCats[0].id) : '';
    if (!ktpLevels.includes(f.level)) f.level = ktpLevels[0];
    ktpTopics = f.category ? await api(`/ktp/topics?category=${f.category}&level=${encodeURIComponent(f.level)}`) : [];
    main.innerHTML = `
      <div class="card"><div class="card-title">Категории</div>
        <div class="tscroll"><table><tr><th class="left">Категория</th><th>Тем</th><th></th></tr>
          ${ktpCats.map(c => `<tr><td class="left tcell-name">${esc(c.name)} <span class="mut">#${c.id}</span></td><td>${c.topics}</td>
            <td class="act"><button class="btn ghost sm" data-ktp-rename="${c.id}">Переименовать</button> <button class="btn ghost sm" data-ktp-rmcat="${c.id}">Удалить</button></td></tr>`).join('')}</table></div>
        <div class="toolbar" style="margin-top:12px"><input id="k-newcat" class="grow" maxlength="100" placeholder="Новая категория"><button class="btn" data-act="ktp-addcat">+ Добавить</button></div>
      </div>
      <div class="card"><div class="card-title">Темы</div>
        <div class="toolbar">
          <select id="k-cat">${ktpOptions(ktpCats.map(c => [c.id, c.name]), f.category)}</select>
          <select id="k-level">${ktpOptions(ktpLevels.map(l => [l, l]), f.level)}</select>
          <span class="mut">${ktpTopics.length} тем</span>
          <button class="btn" data-act="ktp-add" style="margin-left:auto" ${f.category ? '' : 'disabled'}>+ Тема</button>
          <button class="btn ghost" data-act="ktp-paste" ${f.category ? '' : 'disabled'}>Вставить из Excel</button>
        </div>
        <p class="note">Преподаватель видит темы уровня своей группы (уровень из HollyHop: «Inter + (plus)» = Intermediate Plus). Выбранная тема подставляется в «Тему урока».</p>
        ${ktpTopics.length ? `<div class="tscroll"><table><tr>${KTP_COLS.map(([, label]) => `<th class="left">${esc(label)}</th>`).join('')}<th></th></tr>
          ${ktpTopics.map(x => `<tr>${KTP_COLS.map(([k]) => `<td class="left">${esc(x[k] ?? '')}</td>`).join('')}
            <td class="act"><button class="btn ghost sm" data-ktp-edit="${x.id}">Изменить</button> <button class="btn ghost sm" data-ktp-rm="${x.id}">✕</button></td></tr>`).join('')}</table></div>`
          : '<div class="empty">Тем для этой категории и уровня пока нет</div>'}
      </div>`;
  };
  on(root, 'change', '#k-cat', el => { state.ktp.category = el.value; show('ktp'); });
  on(root, 'change', '#k-level', el => { state.ktp.level = el.value; show('ktp'); });

  const ktpCall = async (path, opts, message) => {
    try { const r = await api(path, opts); LTC.modal.close(); if (message) LTC.toast(typeof message === 'function' ? message(r) : message, 'good'); show('ktp'); }
    catch (e) { LTC.toast(e.message, 'bad'); }
  };
  on(root, 'click', '[data-act="ktp-addcat"]', () => ktpCall('/ktp/categories', { method: 'POST', body: { name: $('#k-newcat').value } }, 'Категория добавлена'));
  on(root, 'click', '[data-ktp-rename]', el => {
    const c = ktpCats.find(x => String(x.id) === el.dataset.ktpRename);
    LTC.modal.open('Переименовать категорию', `<div class="form-grid"><label class="full">Название<input id="k-catname" maxlength="100" value="${esc(c.name)}"></label></div>
      <div class="row" style="margin-top:14px"><button class="btn grow" data-act="ktp-savecat" data-id="${c.id}">Сохранить</button><button class="btn ghost" data-modal-close>Отмена</button></div>`);
  });
  on(document.body, 'click', '[data-act="ktp-savecat"]', el => ktpCall('/ktp/categories', { method: 'POST', body: { id: Number(el.dataset.id), name: $('#k-catname').value } }, 'Сохранено'));
  on(root, 'click', '[data-ktp-rmcat]', el => {
    const c = ktpCats.find(x => String(x.id) === el.dataset.ktpRmcat);
    if (confirm(`Удалить категорию «${c.name}»?`)) ktpCall('/ktp/categories/' + c.id, { method: 'DELETE' }, 'Категория удалена');
  });

  const topicForm = x => `
    <div class="form-grid">
      <label>Категория<select id="kf-cat">${ktpOptions(ktpCats.map(c => [c.id, c.name]), x.category_id ?? state.ktp.category)}</select></label>
      <label>Уровень<select id="kf-level">${ktpOptions(ktpLevels.map(l => [l, l]), x.level ?? state.ktp.level)}</select></label>
      ${KTP_COLS.map(([k, label]) => `<label class="${['title', 'homework'].includes(k) ? 'full' : ''}">${esc(label)}${k === 'title' ? ' *' : ''}
        <input data-kf="${k}" ${k === 'num' ? 'inputmode="numeric"' : ''} value="${esc(x[k] ?? '')}"></label>`).join('')}
    </div>
    <div class="row" style="margin-top:14px"><button class="btn grow" data-act="ktp-save" data-id="${x.id || 0}">Сохранить</button><button class="btn ghost" data-modal-close>Отмена</button></div>`;
  on(root, 'click', '[data-act="ktp-add"]', () => LTC.modal.open('Новая тема', topicForm({})));
  on(root, 'click', '[data-ktp-edit]', el => LTC.modal.open('Тема КТП', topicForm(ktpTopics.find(x => String(x.id) === el.dataset.ktpEdit))));
  on(document.body, 'click', '[data-act="ktp-save"]', el => {
    const body = { id: Number(el.dataset.id) || undefined, category_id: Number($('#kf-cat').value), level: $('#kf-level').value };
    $$('[data-kf]').forEach(input => { body[input.dataset.kf] = input.value; });
    ktpCall('/ktp/topics', { method: 'POST', body }, 'Сохранено');
  });
  on(root, 'click', '[data-ktp-rm]', el => { if (confirm('Удалить тему?')) ktpCall('/ktp/topics/' + el.dataset.ktpRm, { method: 'DELETE' }); });

  // Вставка из Excel: строки через перенос, ячейки через Tab; строка заголовка (начинается с «№») пропускается.
  const pasteRows = text => text.split(/\r?\n/).filter(line => line.trim()).map(line => line.split('\t'))
    .filter(cells => !/^\s*№/.test(cells[0]));
  on(root, 'click', '[data-act="ktp-paste"]', () => {
    const cat = ktpCats.find(c => String(c.id) === state.ktp.category);
    LTC.modal.open(`Вставить из Excel · ${cat.name} · ${state.ktp.level}`, `
      <p class="hint">Скопируйте строки таблицы КТП в Excel/Google Таблицах и вставьте сюда. Порядок колонок:<br><b>${KTP_COLS.map(([, l]) => esc(l)).join(' · ')}</b></p>
      <textarea id="k-paste" rows="10" style="width:100%;font-family:ui-monospace,monospace;font-size:12px"></textarea>
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px"><input type="checkbox" id="k-replace"> заменить все темы этой категории и уровня</label>
      <div class="row" style="margin-top:14px"><button class="btn grow" data-act="ktp-import">Загрузить</button><button class="btn ghost" data-modal-close>Отмена</button></div>`);
  });
  on(document.body, 'click', '[data-act="ktp-import"]', () => {
    const replace = $('#k-replace').checked;
    if (replace && !confirm('Текущие темы этой категории и уровня будут удалены. Продолжить?')) return;
    ktpCall('/ktp/topics/import', { method: 'POST', body: { category_id: Number(state.ktp.category), level: state.ktp.level, replace, rows: pasteRows($('#k-paste').value) } },
      r => `Добавлено тем: ${r.added}`);
  });

  /* ---------- Аудит ---------- */
  views.audit = async () => {
    const [rows, cfg] = await Promise.all([api('/audit?action=' + encodeURIComponent(state.auditAction)), api('/config')]);
    main.innerHTML = `
      <div class="toolbar"><select id="a-action"><option value="">Все действия</option>${Object.entries(ACTION).map(([k, v]) => `<option value="${k}" ${state.auditAction === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
        <span class="mut">Срок хранения: ${cfg.auditRetentionDays} дн. — старше удаляется автоматически. Показаны последние 300.</span></div>
      <div class="card"><div class="tscroll"><table><tr><th>Время (UTC)</th><th class="left">Кто</th><th class="left">Действие</th><th class="left">Группа</th><th>Дата</th><th class="left">Детали</th></tr>
        ${rows.map(a => `<tr><td>${esc(a.created_at)}</td><td class="left">${esc(a.full_name || a.actor || '—')}${a.actor ? `<br><span class="mut">${esc(a.actor)}</span>` : ''}</td>
          <td class="left">${esc(ACTION[a.action] || a.action)}</td><td class="left">${esc(a.group_id || '')}</td><td>${esc(a.lesson_date || '')}</td>
          <td class="left"><span class="mut">${esc(typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail))}</span></td></tr>`).join('')}</table></div>
        ${rows.length ? '' : '<div class="empty">Записей нет</div>'}</div>`;
  };
  on(root, 'change', '#a-action', el => { state.auditAction = el.value; show('audit'); });

  /* ---------- Правила (только чтение: задаются в .env) ---------- */
  views.rules = async () => {
    const c = await api('/config');
    const yes = v => (v ? 'да' : 'нет');
    main.innerHTML = `
      <div class="card"><div class="card-title">Правила ввода (разд. 5 ТЗ)</div>
        <dl class="kv">
          <dt>Ежедневный тест</dt><dd>обязателен для присутствовавших</dd>
          <dt>Типы теста HollyHop</dt><dd>Foreign (EN) → ${c.testing.testTypeIds.foreign} · Local (RU) → ${c.testing.testTypeIds.local}</dd>
          <dt>Навыки и баллы</dt><dd>${Object.entries(c.testing.skillsByType).map(([type, list]) => `<b>${type}</b>: ${list.map(k => `${esc(k.name)} (№${k.id ?? '— ID не указан'}): 0–${k.max}${k.default != null ? `, по умолч. ${k.default}` : ''}${k.pass != null ? `, порог ${k.pass}` : ''}`).join(' · ')}`).join('<br>')}</dd>
          <dt>Доп. (персональный) тест</dt><dd>по желанию, не больше одного на урок · AddEditPersonalTestResult<br>${c.personalTests.map(cat => `<b>${esc(cat.name)}</b> (кат. ${cat.id}): ${cat.types.map(x => `${esc(x.name)} — тип ${x.id}: ${x.skills.map(k => `${esc(k.name)} (№${k.id}) 0–${k.max}`).join(', ')}`).join(' | ')}`).join('<br>')}</dd>
          <dt>Тест пишется для групп</dt><dd>${c.testing.edUnitIds.length ? esc(c.testing.edUnitIds.join(', ')) : 'для всех'} <span class="mut">HH_TEST_EDUNIT_IDS</span></dd>
          <dt>Тема урока обязательна (= комментарий в HollyHop)</dt><dd>${yes(c.rules.commentRequired)} <span class="mut">COMMENT_REQUIRED</span></dd>
          <dt>Макс. длина комментария</dt><dd>${c.rules.commentMaxLen} <span class="mut">COMMENT_MAX_LEN</span></dd>
        </dl><p class="note" style="margin-top:12px">Тесты и комментарий — только для тех, кто был на уроке. Ежедневный тест обязателен (навык 8 всегда 45); доп. тест — по выбору преподавателя, баллы вводятся тем ученикам, кто его писал. Менять — в файле .env, затем перезапустить сервер.</p></div>
      <div class="card"><div class="card-title">Система</div>
        <dl class="kv">
          <dt>Часовой пояс отдела</dt><dd>${esc(c.timezone)} <span class="mut">APP_TZ</span></dd>
          <dt>Хранение аудит-лога</dt><dd>${c.auditRetentionDays} дн. <span class="mut">AUDIT_RETENTION_DAYS</span></dd>
          <dt>Порог «убыточной» группы</dt><dd>&lt; ${c.lowFillThreshold} уч. <span class="mut">LOW_FILL_THRESHOLD</span></dd>
          <dt>Директоров из .env</dt><dd>${c.directors} <span class="mut">DIRECTOR_TG_IDS</span></dd>
          <dt>HollyHop</dt><dd>${c.mock ? '<span class="chip warn">демо-режим (HH_MOCK=1)</span>' : '<span class="chip good">боевое подключение</span>'}</dd>
        </dl></div>
      <div class="card"><div class="card-title">Как это работает (кратко)</div>
        <p class="hint">Одно «Сохранить» = тема + посещаемость каждого ученика + оценки. Повторное нажатие не создаёт дублей, сохранённую отметку изменить нельзя. При сбое сети данные ждут в телефоне; при сбое HollyHop сервер досылает недостающее каждую минуту. Если у ключа нет прав на запись — статус «Нужно внимание», кнопка «Повторить» доступна на вкладках «Обзор» и «Отметки».</p></div>`;
  };

  show('overview');
})();
