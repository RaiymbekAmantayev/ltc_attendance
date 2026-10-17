CREATE TABLE IF NOT EXISTS teachers(
  id INT AUTO_INCREMENT PRIMARY KEY,
  telegram_id BIGINT NULL UNIQUE,
  hollihop_id VARCHAR(64) NULL UNIQUE,            -- у директора/координатора без уроков может быть пустым
  full_name VARCHAR(255), branch VARCHAR(100),
  lang ENUM('ru','en') NOT NULL DEFAULT 'ru',     -- Local->ru, Foreign->en
  role ENUM('teacher','coordinator','director') NOT NULL DEFAULT 'teacher',
  active TINYINT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS substitutions(         -- вариант B: замена на дату
  id INT AUTO_INCREMENT PRIMARY KEY,
  group_id VARCHAR(64) NOT NULL, lesson_date DATE NOT NULL, substitute_id INT NOT NULL,
  UNIQUE(group_id,lesson_date,substitute_id),
  FOREIGN KEY(substitute_id) REFERENCES teachers(id)
);
CREATE TABLE IF NOT EXISTS submissions(
  id INT AUTO_INCREMENT PRIMARY KEY,
  idem_key CHAR(36) NOT NULL UNIQUE,              -- uuid одного нажатия «Сохранить»
  teacher_id INT NOT NULL,                        -- реальный автор
  group_id VARCHAR(64) NOT NULL, lesson_date DATE NOT NULL,
  group_name VARCHAR(255) NULL, branch VARCHAR(100) NULL,
  payload JSON NOT NULL,
  progress JSON NOT NULL,                         -- какие шаги уже записаны в HollyHop
  status ENUM('pending','partial','attention','done') NOT NULL DEFAULT 'pending',
  last_error VARCHAR(500),
  attempts INT NOT NULL DEFAULT 0,                -- неудачных попыток досылки подряд
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id,lesson_date),                   -- одно занятие = один комплект; правка запрещена
  INDEX(lesson_date), INDEX(teacher_id, lesson_date), INDEX(status)
);
CREATE TABLE IF NOT EXISTS ktp_categories(       -- КТП: учебные линейки (Nef, Solutions, Go better…)
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sort INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ktp_topics(           -- КТП: строки плана; уровень — из src/config/levels.js
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL, level VARCHAR(32) NOT NULL,
  num INT NULL, week VARCHAR(32) NULL, day VARCHAR(32) NULL, lesson VARCHAR(32) NULL,
  teacher VARCHAR(100) NULL, section VARCHAR(255) NULL, sb_page VARCHAR(50) NULL,
  title VARCHAR(500) NOT NULL,                     -- «Тема / раздел книги» — уходит темой урока
  role VARCHAR(255) NULL, grammar VARCHAR(500) NULL, vocabulary VARCHAR(500) NULL,
  homework VARCHAR(1000) NULL, test_control VARCHAR(500) NULL,
  INDEX(category_id, level, num),
  FOREIGN KEY(category_id) REFERENCES ktp_categories(id)
);
CREATE TABLE IF NOT EXISTS audit_log(
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT, actor VARCHAR(100) NULL,
  action VARCHAR(50), group_id VARCHAR(64), lesson_date DATE,
  detail JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX(created_at), INDEX(action)
);
