// Демо-данные для знакомства с кабинетом (работает вместе с HH_MOCK=1).
// Запуск: node scripts/seed-demo.js <ваш_telegram_id> [id_координатора]
//   1) вы становитесь преподавателем «Иванова Анна» (HollyHop ID 101) и директором, если id есть в DIRECTOR_TG_IDS;
//   2) за последние 3 недели создаются отметки разных статусов — чтобы увидеть обзор и профиль.
require('dotenv').config();
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const [teacherTg, coordTg] = process.argv.slice(2);
if (!teacherTg) { console.error('Укажите ваш Telegram ID: node scripts/seed-demo.js 123456789'); process.exit(1); }

const GROUPS = [['9001', 'English Elementary A1', 'Абая', 6], ['9002', 'English Pre-Intermediate B1', 'Хайвилл', 8], ['9003', 'IELTS Intensive', 'Абая', 2], ['9005', 'Kids Starter', 'Абая', 7]];
const TOPICS = ['Past Simple', 'Present Perfect', 'Reading practice', 'Writing task 1', 'Vocabulary: travel', 'Conditionals'];
const pick = (list, i) => list[i % list.length];

(async () => {
  const db = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: 'Z' });
  const upsert = async (tg, hh, name, branch, lang, role) => {
    await db.query(`INSERT INTO teachers (telegram_id, hollihop_id, full_name, branch, lang, role, active) VALUES (?,?,?,?,?,?,1)
      ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), role=VALUES(role), active=1`, [tg, hh, name, branch, lang, role]);
    return (await db.query('SELECT id FROM teachers WHERE hollihop_id <=> ? AND telegram_id <=> ?', [hh, tg]))[0][0].id;
  };
  const t1 = await upsert(teacherTg, '101', 'Иванова Анна', 'Абая', 'ru', 'teacher');
  const t2 = await upsert(null, '102', 'Smith John', 'Хайвилл', 'en', 'teacher');
  const t3 = await upsert(null, '103', 'Сатпаева Алия', 'Абая', 'ru', 'teacher');
  if (coordTg) await upsert(coordTg, null, 'Координатор Дина', null, 'ru', 'coordinator');

  const owners = { 9001: t1, 9002: t2, 9003: t1, 9005: t3 };
  let n = 0;
  for (let back = 1; back <= 21; back++) {
    const d = new Date(Date.now() - back * 86400000), iso = d.toISOString().slice(0, 10);
    if ([0, 6].includes(d.getUTCDay())) continue;
    for (const [gi, [id, name, branch, count]] of GROUPS.entries()) {
      if ((back + gi) % 4 === 0) continue;                               // часть занятий не отмечена
      const students = Array.from({ length: count }, (_, i) => {
        const r = (back * 7 + gi * 3 + i * 5) % 11;
        return { id: String(Number(id) * 100 + i + 1), status: r === 0 ? 'absent' : r === 1 ? 'late' : 'present', excused: r === 0 && i % 2 === 0, skills: r > 1 ? { 8: 45 - (r % 4) * 3, 11: 3 + (r % 3), 17: 2 + (r % 4) } : null, comment: '' };
      });
      const status = (back + gi) % 9 === 0 ? 'partial' : (back + gi) % 13 === 0 ? 'attention' : 'done';
      const late = (back + gi) % 5 === 0;                                // часть отметок — на следующий день
      const created = new Date(d.getTime() + (late ? 30 : 12) * 3600000).toISOString().slice(0, 19).replace('T', ' ');
      try {
        await db.query(`INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, payload, progress, status, last_error, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [crypto.randomUUID(), owners[id], id, name, branch, iso,
          JSON.stringify({ topic: pick(TOPICS, back + gi), testTypeId: owners[id] === t2 ? 131 : 132, students }), '[]', status,
          status === 'done' ? null : status === 'partial' ? 'HH SetStudentPasses: ошибка сервера 502' : 'HH SetStudentPasses: Нет прав доступа', created]);
        n++;
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
    }
  }
  console.log(`Готово: преподаватели созданы, отметок добавлено: ${n}`);
  await db.end();
})().catch(e => { console.error(e.message); process.exit(1); });
