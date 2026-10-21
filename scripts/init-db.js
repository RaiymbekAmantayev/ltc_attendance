// Создаёт базу (если нет), таблицы из schema.sql и донастраивает старую схему. Безопасно запускать повторно.
// Запуск: npm run init-db
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/** Миграции для баз, созданных версиями 0.1–0.2: [таблица, колонка, DDL добавления]. */
const COLUMNS = [
  ['teachers', 'role', "ADD COLUMN role ENUM('teacher','coordinator','director') NOT NULL DEFAULT 'teacher' AFTER lang"],
  ['submissions', 'group_name', 'ADD COLUMN group_name VARCHAR(255) NULL AFTER lesson_date'],
  ['submissions', 'branch', 'ADD COLUMN branch VARCHAR(100) NULL AFTER group_name'],
  ['submissions', 'attempts', 'ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER last_error'],
  ['submissions', 'slot', 'ADD COLUMN slot TINYINT NOT NULL DEFAULT 1 AFTER attempts'],
  ['audit_log', 'actor', 'ADD COLUMN actor VARCHAR(100) NULL AFTER teacher_id'],
];

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/';

  const connection = await mysql.createConnection({ uri: url.toString(), multipleStatements: true });
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${dbName}\``);
  await connection.query(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));

  for (const [table, column, ddl] of COLUMNS) {
    const [rows] = await connection.query(
      'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
      [dbName, table, column]);
    if (!rows.length) { await connection.query(`ALTER TABLE \`${table}\` ${ddl}`); console.log(`миграция: ${table}.${column}`); }
  }
  // v0.4: на урок до двух отметок от разных преподавателей — вместо UNIQUE(group_id, lesson_date) два ключа.
  const [indexes] = await connection.query(
    `SELECT index_name name, GROUP_CONCAT(column_name ORDER BY seq_in_index) cols FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = 'submissions' AND non_unique = 0 GROUP BY index_name`, [dbName]);
  for (const { name, cols } of indexes) {
    if (cols === 'group_id,lesson_date') { await connection.query(`ALTER TABLE submissions DROP INDEX \`${name}\``); console.log('миграция: submissions — снят ключ «одна отметка на урок»'); }
  }
  const names = new Set(indexes.map(i => i.name));
  if (!names.has('uq_lesson_teacher')) await connection.query('ALTER TABLE submissions ADD UNIQUE KEY uq_lesson_teacher(group_id, lesson_date, teacher_id)');
  if (!names.has('uq_lesson_slot')) await connection.query('ALTER TABLE submissions ADD UNIQUE KEY uq_lesson_slot(group_id, lesson_date, slot)');

  // hollihop_id теперь может быть пустым (директор/координатор)
  await connection.query('ALTER TABLE teachers MODIFY hollihop_id VARCHAR(64) NULL');

  // Категории КТП по умолчанию — только в пустую таблицу (переименования и удаления админа не трогаем).
  const [[{ n }]] = await connection.query('SELECT COUNT(*) n FROM ktp_categories');
  if (!Number(n)) {
    await connection.query('INSERT INTO ktp_categories (id, name, sort) VALUES ?',
      [[[1, 'Nef (Взрослые 15+)', 1], [2, 'Solutions (Дети)', 2], [3, 'Go better', 3]]]);
    console.log('КТП: добавлены категории по умолчанию');
  }

  console.log('Готово: база и таблицы созданы —', dbName);
  await connection.end();
})().catch(error => { console.error(error.message); process.exit(1); });
