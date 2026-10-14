/* LTC · разделы руководства (директор, координатор): Обзор · Группы · Преподаватели. */
(function () {
  const { $, $$, on, esc } = LTC;
  const root = document.getElementById('app');
  const A = window.APP, state = A.state;
  const T = () => A.T();

  /* ---------- Период ---------- */
  const preset = name => {
    const today = LTC.localToday();
    if (name === 'today') return { preset: name, from: today, to: today };
    if (name === 'week') return { preset: name, from: LTC.addDays(today, -6), to: today };
    return { preset: 'month', from: LTC.monthStart(today), to: today };
  };
  state.period = preset('month');
  state.groupsDate = LTC.localToday();
  state.filter = 'all';
  state.query = '';

  const periodBar = () => {
    const t = T(), p = state.period;
    const pill = (id, label) => `<button class="pill ${p.preset === id ? 'active' : ''}" data-preset="${id}">${esc(label)}</button>`;
    return `
      <div class="card"><div class="pills">
        ${pill('today', t.today)}${pill('week', t.week)}${pill('month', t.month)}
        <span class="row" style="margin-left:auto"><input type="date" id="p-from" value="${p.from}" style="width:136px"><span class="mut">—</span><input type="date" id="p-to" value="${p.to}" style="width:136px">
        <button class="btn sm" data-act="period-go">${esc(t.show)}</button></span>
      </div></div>`;
  };
  const rerender = () => A.go(state.tab);
  on(root, 'click', '[data-preset]', el => { state.period = preset(el.dataset.preset); rerender(); });
  on(root, 'click', '[data-act="period-go"]', () => {
    const from = $('#p-from').value, to = $('#p-to').value;
    if (from && to) { state.period = { preset: 'custom', from: from <= to ? from : to, to: from <= to ? to : from }; rerender(); }
  });
  const qs = () => `from=${state.period.from}&to=${state.period.to}`;

  const statusTag = s => ({ done: 'good', partial: 'warn', pending: 'warn', attention: 'bad', none: '' }[s] || '');

  /* ---------- Обзор ---------- */
  A.views.overview = async view => {
    const t = T();
    const [ov, today] = await Promise.all([A.api('/dash/overview?' + qs()), A.api('/dash/today')]);
    const k = ov.kpi, s = ov.statuses;
    const unmarked = today.pending || [];

    const todayCard = today.error
      ? `<div class="insight"><div><div class="insight-title">${esc(t.hhDown)}</div></div></div>`
      : `<div class="card"><div class="card-title">${esc(t.todayBoard)} <span class="chip ${unmarked.length ? 'warn' : 'good'}">${today.marked} / ${today.expected}</span></div>
          ${LTC.hbars([{ label: t.marked, value: today.marked, text: `${today.marked} / ${today.expected}`, sev: unmarked.length ? 'sev-warn' : 'sev-ok' }], { max: Math.max(1, today.expected) })}
          ${unmarked.length ? `<div class="msec-title">${esc(t.notMarked)}</div>` + unmarked.map(g => `
            <div class="mrow"><span>${esc(g.name)}<br><span class="mut">${esc([g.branch, g.time].filter(Boolean).join(' · '))}</span></span>
            <span class="v">${esc(g.teacher || '')}${g.substitution ? ` <span class="chip brand">${esc(t.substitution)}</span>` : ''}</span></div>`).join('')
            : `<p class="hint">${esc(t.allMarked)}</p>`}
        </div>`;

    view.innerHTML = `
      <h2 class="title">${esc(t.overviewTitle)}</h2>
      ${periodBar()}
      ${todayCard}
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">${esc(t.lessonsMarked)}</div><div class="kpi-value">${k.lessons}</div><div class="kpi-sub">${k.teachersWorking} / ${k.activeTeachers} ${esc(t.activeTeachers.toLowerCase())}</div></div>
        <div class="kpi"><div class="kpi-label">${esc(t.studentsMarked)}</div><div class="kpi-value">${k.students}</div></div>
        <div class="kpi ${LTC.sev(k.attendanceRate)}"><div class="kpi-label">${esc(t.attendance)}</div><div class="kpi-value">${LTC.pct(k.attendanceRate)}</div></div>
        <div class="kpi ${LTC.sev(k.onTimeRate, 70, 90)}"><div class="kpi-label">${esc(t.onTime)}</div><div class="kpi-value">${LTC.pct(k.onTimeRate)}</div></div>
        <div class="kpi ${LTC.sev(k.syncedRate, 80, 95)}"><div class="kpi-label">${esc(t.syncedRate)}</div><div class="kpi-value">${LTC.pct(k.syncedRate)}</div></div>
        <div class="kpi ${LTC.sev(k.testPassRate, 60, 80)}"><div class="kpi-label">${esc(t.testPass)}</div><div class="kpi-value">${LTC.pct(k.testPassRate)}</div><div class="kpi-sub">${esc(t.avgTest)}: ${LTC.pct(k.avgTest)}</div></div>
      </div>
      <div class="card"><div class="card-title">${esc(t.byDay)}</div>
        ${LTC.vbars(ov.byDay.slice(-31).map(d => ({ label: LTC.short(d.date), value: d.count })))}
      </div>
      <div class="card"><div class="card-title">${esc(t.attendance)}</div>
        ${LTC.hbars([
          { label: t.present, value: ov.attendance.present, sev: 'sev-ok' },
          { label: t.late, value: ov.attendance.late, sev: 'sev-warn' },
          { label: t.absent, value: ov.attendance.absent, sev: 'sev-crit' },
        ])}
      </div>
      <div class="card"><div class="card-title">${esc(t.byBranch)}</div>
        ${ov.byBranch.length ? LTC.hbars(ov.byBranch.map(b => ({ label: b.branch, value: b.lessons, text: `${b.lessons} · ${LTC.pct(b.attendance)}` }))) : `<div class="empty">—</div>`}
      </div>
      <div class="card"><div class="card-title">${esc(t.byStatus)}</div>
        ${LTC.hbars([
          { label: t.status.done, value: s.done, sev: 'sev-ok' }, { label: t.status.pending, value: s.pending, sev: 'sev-warn' },
          { label: t.status.partial, value: s.partial, sev: 'sev-warn' }, { label: t.status.attention, value: s.attention, sev: 'sev-crit' },
        ])}
      </div>
      <div class="card"><div class="card-title">${esc(t.problems)}</div>
        ${ov.problems.length ? `<div class="tscroll"><table><tr><th>${esc(t.subDate)}</th><th class="left">${esc(t.groupsTitle)}</th><th></th></tr>
          ${ov.problems.map(p => `<tr><td>${esc(LTC.short(p.date))}</td><td class="left">${esc(p.group)}<br><span class="mut">${esc(p.teacher)}${p.error ? ' · ' + esc(p.error) : ''}</span></td>
            <td><span class="chip ${statusTag(p.status)}">${esc(t.status[p.status])}</span></td></tr>`).join('')}</table></div>`
          : `<div class="empty">✅ ${esc(t.noProblems)}</div>`}
      </div>`;
  };

  /* ---------- Группы ---------- */
  let groupsCache = [];

  const groupCard = g => {
    const t = T();
    const meta = [g.branch, g.time, g.days, g.teacher].filter(Boolean).join(' · ');
    return `
      <button class="tcard" data-gid="${esc(g.id)}">
        <div class="tcard-top">
          <div class="avatar">${esc(LTC.initial(g.name))}</div>
          <div class="tcard-meta"><div class="tcard-name">${esc(g.name)}</div><div class="tcard-sub">${esc(meta)}</div></div>
          <div class="tcard-val">${LTC.num(g.students)}<small>${esc(t.students)}</small></div>
        </div>
        <div class="tags">
          <span class="chip ${statusTag(g.status)}">${esc(t.status[g.status])}</span>
          ${g.lowFill ? `<span class="chip bad">${esc(fmtLow())}</span>` : ''}
          ${g.overfull ? `<span class="chip warn">${esc(t.overfull)}</span>` : ''}
          ${g.substitute ? `<span class="chip brand">${esc(t.substitution)}: ${esc(g.substitute)}</span>` : ''}
        </div>
      </button>`;
  };
  const fmtLow = () => A.fmt(T().lowFill, { n: state.me.lowFillThreshold || 3 });

  const filteredGroups = () => {
    const q = state.query.trim().toLowerCase();
    return groupsCache.filter(g =>
      (!q || [g.name, g.branch, g.teacher].join(' ').toLowerCase().includes(q)) &&
      (state.filter === 'all' || (state.filter === 'unmarked' && g.status === 'none') || (state.filter === 'low' && g.lowFill)));
  };
  const paintGroups = () => {
    const list = filteredGroups();
    $('#glist').innerHTML = list.length ? list.map(groupCard).join('') : `<div class="empty">${esc(T().noLessons)}</div>`;
  };

  A.views.groups = async view => {
    const t = T(), today = LTC.localToday();
    view.innerHTML = `
      <h2 class="title">${esc(t.groupsTitle)}</h2>
      <div class="datebar">
        <button class="iconbtn" data-act="gday" data-n="-1" aria-label="−1">‹</button>
        <input type="date" id="gdate" value="${state.groupsDate}">
        <button class="iconbtn" data-act="gday" data-n="1" aria-label="+1">›</button>
        ${state.groupsDate !== today ? `<button class="pill" data-act="gtoday">${esc(t.today)}</button>` : ''}
      </div>
      <input type="search" id="gq" class="field" placeholder="${esc(t.search)}" value="${esc(state.query)}" style="margin-bottom:10px">
      <div class="pills" style="margin-bottom:12px">
        ${[['all', t.all], ['unmarked', t.notMarkedF], ['low', t.lowFillF]].map(([id, label]) => `<button class="pill ${state.filter === id ? 'active' : ''}" data-filter="${id}">${esc(label)}</button>`).join('')}
        <button class="btn ghost sm" data-act="csv-groups" style="margin-left:auto">📥 CSV</button>
      </div>
      <div id="glist">${LTC.loader}</div>`;
    groupsCache = await A.api('/dash/groups?date=' + state.groupsDate);
    paintGroups();
  };

  on(root, 'click', '[data-act="gday"]', el => { state.groupsDate = LTC.addDays(state.groupsDate, Number(el.dataset.n)); rerender(); });
  on(root, 'click', '[data-act="gtoday"]', () => { state.groupsDate = LTC.localToday(); rerender(); });
  on(root, 'change', '#gdate', el => { if (el.value) { state.groupsDate = el.value; rerender(); } });
  on(root, 'input', '#gq', el => { state.query = el.value; paintGroups(); });
  on(root, 'click', '[data-filter]', el => {
    state.filter = el.dataset.filter;
    $$('[data-filter]').forEach(b => b.classList.toggle('active', b === el));
    paintGroups();
  });
  on(root, 'click', '[data-act="csv-groups"]', () => {
    LTC.csv(`LTC_groups_${state.groupsDate}.csv`,
      ['Группа', 'Филиал', 'Уровень', 'Дисциплина', 'Время', 'Дни', 'Преподаватель', 'Учеников', 'Вакансий', 'Статус отметки', 'Убыточная', 'Замена'],
      filteredGroups().map(g => [g.name, g.branch, g.level, g.discipline, g.time, g.days, g.teacher, g.students, g.vacancies, g.status, g.lowFill ? 'да' : '', g.substitute || '']));
  });

  /* Карточка группы: состав, посещаемость, замена */
  on(root, 'click', '.tcard[data-gid]', async el => {
    const t = T(), gid = el.dataset.gid, g = groupsCache.find(x => x.id === gid);
    const body = LTC.modal.open(g ? g.name : gid, LTC.loader);
    try {
      const month = { from: LTC.monthStart(LTC.localToday()), to: LTC.localToday() };
      const [d, staff] = await Promise.all([A.api(`/dash/groups/${gid}?from=${month.from}&to=${month.to}`), A.api('/dash/staff')]);
      const row = (k, v) => `<div class="mrow"><span class="k">${esc(k)}</span><span class="v">${esc(v ?? '—')}</span></div>`;
      body.innerHTML = `
        ${row(t.teacher, g?.teacher)}${row(t.schedule, [g?.time, g?.days].filter(Boolean).join(' · '))}
        ${row(t.studentsCount, g?.students)}${row(t.vacancies, g?.vacancies)}
        ${row(t.lessons, d.lessons)}${row(t.attendance, LTC.pct(d.attendance))}
        <div class="msec-title">${esc(t.roster)}</div>
        <div class="tscroll"><table><tr><th class="left">&nbsp;</th><th>${esc(t.lessons)}</th><th>${esc(t.absent)}</th><th>${esc(t.rate)}</th><th>${esc(t.avg)}</th></tr>
          ${d.students.map(s => `<tr><td class="left">${esc(s.name)}</td><td>${s.lessons}</td><td>${s.absent}</td><td class="${LTC.sev(s.rate, 50, 75)}">${LTC.pct(s.rate)}</td><td>${LTC.pct(s.avgTest)}</td></tr>`).join('')}</table></div>
        ${d.topics.length ? `<div class="msec-title">${esc(t.topics)}</div>` + d.topics.map(x => row(LTC.short(x.date), x.topic)).join('') : ''}
        <div class="msec-title">${esc(t.assignSub)}</div>
        <div class="row">
          <input type="date" id="s-date" class="grow" value="${state.groupsDate}">
          <select id="s-teacher" class="grow">${staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        </div>
        <button class="btn block" style="margin-top:10px" data-act="assign" data-gid="${esc(gid)}">${esc(t.assign)}</button>`;
    } catch (e) { body.innerHTML = A.errorBox(e); }
  });
  document.addEventListener('click', async event => {
    const el = event.target.closest('[data-act="assign"]');
    if (!el) return;
    try {
      await A.api('/dash/substitutions', { method: 'POST', body: { group_id: el.dataset.gid, lesson_date: $('#s-date').value, substitute_id: Number($('#s-teacher').value) } });
      LTC.toast(T().subAdded, 'good'); LTC.modal.close();
      if (state.tab === 'groups') rerender();
    } catch (e) { LTC.toast(A.errText(e), 'bad'); }
  });

  /* ---------- Преподаватели ---------- */
  let teachersCache = [];
  const teacherCard = x => {
    const t = T();
    return `
      <div class="tcard" style="cursor:default">
        <div class="tcard-top">
          <div class="avatar">${esc(LTC.initial(x.name))}</div>
          <div class="tcard-meta"><div class="tcard-name">${esc(x.name)}</div><div class="tcard-sub">${esc([x.branch, x.lang === 'en' ? 'EN' : 'RU'].filter(Boolean).join(' · '))}</div></div>
          <div class="tcard-val">${x.lessons}<small>${esc(t.lessons)}</small></div>
        </div>
        <div class="tags">
          <span class="chip ${x.attendance == null ? '' : x.attendance < 60 ? 'bad' : x.attendance < 80 ? 'warn' : 'good'}">${esc(t.rate)} ${LTC.pct(x.attendance)}</span>
          <span class="chip ${x.onTime == null ? '' : x.onTime < 70 ? 'bad' : x.onTime < 90 ? 'warn' : 'good'}">${esc(t.onTime)} ${LTC.pct(x.onTime)}</span>
          ${x.problems ? `<span class="chip bad">${esc(t.problemsShort)}: ${x.problems}</span>` : ''}
          ${!x.hasTelegram ? `<span class="chip warn">${esc(t.noTelegram)}</span>` : ''}
          ${!x.active ? `<span class="chip">${esc(t.inactive)}</span>` : ''}
        </div>
      </div>`;
  };
  const paintTeachers = () => {
    const q = state.tq ? state.tq.toLowerCase() : '';
    const list = teachersCache.filter(x => !q || String(x.name).toLowerCase().includes(q));
    $('#tlist').innerHTML = list.length ? list.map(teacherCard).join('') : `<div class="empty">—</div>`;
  };
  A.views.teachers = async view => {
    const t = T();
    view.innerHTML = `
      <h2 class="title">${esc(t.teachersTitle)}</h2>
      ${periodBar()}
      <div class="row" style="margin-bottom:12px"><input type="search" id="tq" class="field grow" placeholder="${esc(t.search)}" value="${esc(state.tq || '')}"><button class="btn ghost sm" data-act="csv-teachers">📥 CSV</button></div>
      <div id="tlist">${LTC.loader}</div>`;
    teachersCache = await A.api('/dash/teachers?' + qs());
    paintTeachers();
  };
  on(root, 'input', '#tq', el => { state.tq = el.value; paintTeachers(); });
  on(root, 'click', '[data-act="csv-teachers"]', () => {
    LTC.csv(`LTC_teachers_${state.period.from}_${state.period.to}.csv`,
      ['Преподаватель', 'Филиал', 'Язык', 'Занятий', 'Учеников', 'Посещаемость %', 'Отмечено в день урока %', 'Записано в HollyHop', 'Проблем', 'Последнее занятие'],
      teachersCache.map(x => [x.name, x.branch, x.lang, x.lessons, x.students, x.attendance, x.onTime, x.done, x.problems, x.last]));
  });
})();
