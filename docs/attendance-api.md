# Attendance API v1 — доступ к данным кабинета Attendance (только чтение)

Для: команды LTC (кабинет ученика, боты-кураторы, аналитика). Ответ на ТЗ «API-доступ к кабинету Attendance» от 11.11.2026.

## 1. Коротко

| | |
|---|---|
| Базовый URL | `https://attendance.ltsastana.kz/attendance-api/v1` |
| Формат | REST поверх HTTPS, JSON (UTF-8), gzip — если клиент шлёт `Accept-Encoding: gzip` |
| Методы | только `GET` (любой другой → `405 read_only`) |
| Авторизация | `Authorization: Bearer <токен>` или `X-Api-Key: <токен>` |
| Лимит | **60 запросов в минуту с одного IP** и **не больше 3 запросов одновременно** (на весь API) |
| Даты | ISO 8601: дата урока — `YYYY-MM-DD` (Asia/Almaty), метки времени — UTC `YYYY-MM-DDTHH:MM:SSZ` |
| Справка в рантайме | `GET /meta` — шкалы, типы тестов, лимиты |

Токен выдаёт разработчик кабинета лично (не по почте/в чат открытым текстом). Храните его в секретах, в браузер не отдавайте — API рассчитан на серверные агенты. Ротация — по запросу: старый токен перестаёт работать сразу после замены на сервере (перезапуск сервиса, несколько секунд).

## 2. Ключи HollyHop (ответ на п. 3 ТЗ)

Все идентификаторы — **родные HollyHop**, сопоставлять по ФИО не нужно:

| Сущность | Поле | Что это |
|---|---|---|
| Ученик | `hollyhop_client_id` | **ClientId** ученика в HollyHop. `student_id` — то же значение |
| Группа | `hollyhop_edunit_id` | Id учебной единицы (EdUnit). `group_id` — то же значение |
| Преподаватель | `hollyhop_teacher_id` | Id преподавателя в HollyHop (может быть `null` у сотрудников без уроков). `teacher_id` — наш внутренний id |

Все id в ответах — **строки** (кроме `test_category_id`, `test_type_id`, `skill_id`).

## 3. Эндпоинты

| ТЗ | Эндпоинт | Что отдаёт | Пагинация |
|---|---|---|---|
| 4.4 | `GET /lessons` | журнал: одна запись = один ученик на одном уроке | курсор |
| 4.5 | `GET /tests` | результаты доп. тестов (Progress, Final, Entry, Revise&Check, File NEF, Quick NEF) | курсор |
| 4.1 | `GET /students` | справочник учеников: группа, уровень, преподаватель, статус | offset |
| 4.3 | `GET /groups` | справочник групп | offset |
| 4.2 | `GET /teachers` | справочник преподавателей | offset |
| — | `GET /meta` | шкалы оценок, типы тестов и их максимумы, лимиты | — |
| 4.6 | — | **рекомендаций в кабинете нет** — см. раздел 7 | — |

### 3.1 `GET /lessons` — журнал урока

Что преподаватель заполняет после урока. Если урок отметили два преподавателя (местный и иностранный), у ученика будет **две записи** с одинаковым `lesson_id` и разными `teacher_type`.

**Параметры** (все необязательные):

| Параметр | Описание |
|---|---|
| `date_from`, `date_to` | период по дате урока, `YYYY-MM-DD`, не длиннее 366 дней |
| `updated_since` | только записи, появившиеся с этого момента: `2026-11-14T08:00:00Z`, `2026-11-14T13:00:00+05:00` или `2026-11-14` (= 00:00 UTC). Время без часового пояса → 400 |
| `hollyhop_client_id` | один ученик |
| `group_id` | группа (= EdUnit HollyHop) |
| `teacher_id` / `hollyhop_teacher_id` | преподаватель |
| `branch` | филиал, точное название (`Абая`, `Хайвилл`…) |
| `attendance` | `present` / `absent` |
| `limit` | 1–500, по умолчанию 100 |
| `cursor` | значение `page.next_cursor` из предыдущего ответа |

Без `date_from`, `date_to` и `updated_since` — **последние 30 дней**.

**Пример:**
```bash
curl -s -H "Authorization: Bearer $ATT_TOKEN" \
  "https://attendance.ltsastana.kz/attendance-api/v1/lessons?hollyhop_client_id=801&date_from=2026-11-01&date_to=2026-11-14"
```
```json
{
  "data": [{
    "record_id": "1532:801",
    "lesson_id": "81:2026-11-11",
    "submission_id": "1532",
    "date": "2026-11-11",
    "group_id": "81", "hollyhop_edunit_id": "81", "group_name": "G81", "branch": "Абая", "level": "Elementary",
    "teacher_id": "12", "hollyhop_teacher_id": "201", "teacher_fio": "Иванова Анна", "teacher_type": "local",
    "student_id": "801", "hollyhop_client_id": "801", "student_fio": "Аня",
    "attendance": "present",
    "absence_reason": null,
    "homework": 4, "activity": 5, "behaviour": 3,
    "homework_assignment": "Ex 1-3",
    "topic": "Present Simple",
    "ktp_topic_id": 7,
    "comment": null,
    "has_extra_test": false,
    "updated_at": "2026-11-11T09:41:07Z"
  }],
  "page": { "limit": 100, "next_cursor": null, "has_more": false }
}
```

| Поле | Описание |
|---|---|
| `record_id` | уникальный id записи (`<submission_id>:<ClientId>`) — ключ для дедупликации у вас |
| `lesson_id` | урок: `<EdUnit>:<дата>` |
| `teacher_type` | `local` (местный) / `foreign` (иностранный) |
| `attendance` | `present` (был) / `absent` (не был) |
| `homework`, `activity`, `behaviour` | баллы **0–5** (ежедневный тест: ДЗ, активность, дисциплина). У отсутствующих — `null` |
| `homework_assignment` | текст ДЗ, заданного на уроке (одно на группу) |
| `topic` | пройденная тема урока |
| `ktp_topic_id` | id темы из КТП, если выбрана из плана |
| `has_extra_test` | на этом уроке ученик писал доп. тест — он есть в `/tests` с тем же `test_id` = `record_id` |
| `absence_reason`, `comment` | всегда `null` — в кабинете не ведутся (см. раздел 7) |
| `updated_at` | когда отметка попала в кабинет (UTC). Отметки после сохранения не меняются |

### 3.2 `GET /tests` — результаты тестов

Доп. (персональные) тесты, которые преподаватель отметил на уроке. Ежедневный тест (ДЗ/активность/поведение) — в `/lessons`.

Параметры — те же, что у `/lessons` (кроме `attendance`), плюс `test_category_id` (см. `/meta`).

```json
{
  "data": [{
    "test_id": "1533:801", "submission_id": "1533", "date": "2026-11-11",
    "group_id": "81", "hollyhop_edunit_id": "81", "group_name": "G81", "branch": "Абая", "level": "Elementary",
    "teacher_id": "14", "hollyhop_teacher_id": "202", "teacher_fio": "Smith John", "teacher_type": "foreign",
    "student_id": "801", "hollyhop_client_id": "801", "student_fio": "Аня",
    "test_category_id": 2, "test_type": "Quick Test NEF", "test_type_id": 2, "test_name": "Quick Test NEF",
    "score": 42, "max_score": 50, "percent": 84,
    "skills": [
      { "skill_id": 3, "name": "Grammar", "score": 18, "max": 20 },
      { "skill_id": 4, "name": "Vocabulary", "score": 15, "max": 20 },
      { "skill_id": 5, "name": "Pronunciation", "score": 9, "max": 10 }
    ],
    "updated_at": "2026-11-11T09:43:10Z"
  }],
  "page": { "limit": 100, "next_cursor": null, "has_more": false }
}
```

`percent` — 0–100, один знак после запятой. Типы тестов (ответ на п. 8.4 ТЗ):

| `test_category_id` | `test_type` | Типы (`test_name`) |
|---|---|---|
| 1 | Progress Test | Progress Test |
| 4 | Final Test | Final Test |
| 6 | Entry test | Elementary … Advanced |
| 5 | Revise&Check | по главам / Advanced / Upper-Intermediate |
| 45 | File Test NEF | File 1 … File 12 |
| 2 | Quick Test NEF | Quick Test NEF |

Навыки и максимумы каждого типа — в `GET /meta` → `test_categories`.

### 3.3 `GET /students` — справочник учеников

Ученики, у которых был хотя бы один урок в кабинете за окно (по умолчанию 60 дней). Текущая группа — та, где был последний урок; основной преподаватель — у кого больше всего уроков с учеником в этой группе.

| Параметр | Описание |
|---|---|
| `active_since` | начало окна, `YYYY-MM-DD`, не раньше чем 180 дней назад; по умолчанию сегодня − 60 |
| `status` | `active` (последний урок не старше 30 дней) / `inactive` |
| `hollyhop_client_id`, `group_id`, `teacher_id`, `branch` | фильтры (по любой из групп ученика) |
| `limit`, `offset` | `limit` 1–500 (по умолчанию 100), `offset` ≥ 0 |

```json
{
  "data": [{
    "student_id": "801", "hollyhop_client_id": "801", "fio": "Аня",
    "branch": "Хайвилл", "group_id": "82", "group_name": "G82", "level": "Pre-Intermediate",
    "teacher_id": "12", "hollyhop_teacher_id": "201", "teacher_fio": "Иванова Анна",
    "teachers": [{ "teacher_id": "12", "hollyhop_teacher_id": "201", "fio": "Иванова Анна", "type": "local", "last_lesson_date": "2026-11-13", "lessons_count": 1 }],
    "status": "active", "last_lesson_date": "2026-11-13",
    "groups": [
      { "group_id": "82", "hollyhop_edunit_id": "82", "group_name": "G82", "branch": "Хайвилл", "level": "Pre-Intermediate", "last_lesson_date": "2026-11-13", "teachers": ["…"] },
      { "group_id": "81", "hollyhop_edunit_id": "81", "group_name": "G81", "branch": "Абая", "level": "Elementary", "last_lesson_date": "2026-11-11", "teachers": ["…"] }
    ]
  }],
  "page": { "limit": 100, "offset": 0, "total": 1, "has_more": false },
  "window": { "active_since": "2026-09-15", "to": "2026-11-14" }
}
```

Важно: справочник строится **по отметкам кабинета**, а не по составам HollyHop. Ученик, которого ни разу не отмечали в кабинете, сюда не попадёт; полный состав групп — в HollyHop. `fio` может быть `null` у очень старых отметок. Справочник кэшируется на 5 минут.

### 3.4 `GET /groups` — справочник групп

Те же `active_since`, `status`, `group_id`, `teacher_id`, `branch`, `limit`, `offset`.

```json
{
  "data": [{
    "group_id": "81", "hollyhop_edunit_id": "81", "name": "G81", "branch": "Абая", "level": "Elementary",
    "teacher_id": "12", "hollyhop_teacher_id": "201", "teacher_fio": "Иванова Анна",
    "teachers": [ { "teacher_id": "12", "type": "local", "…": "…" }, { "teacher_id": "14", "type": "foreign", "…": "…" } ],
    "students_count": 2, "lessons_count": 9, "last_lesson_date": "2026-11-11", "status": "active",
    "schedule": null
  }],
  "page": { "limit": 100, "offset": 0, "total": 1, "has_more": false },
  "window": { "active_since": "2026-09-15", "to": "2026-11-14" }
}
```

`schedule` — всегда `null`: расписание ведётся в HollyHop (`GetEdUnits` по `hollyhop_edunit_id`). `students_count` — разных учеников в отметках за окно.

### 3.5 `GET /teachers` — справочник преподавателей

Параметры: `branch`, `active` (`true`/`false`), `limit`, `offset`.

```json
{
  "data": [{ "teacher_id": "12", "hollyhop_teacher_id": "201", "fio": "Иванова Анна", "branch": "Абая", "type": "local", "role": "teacher", "active": true }],
  "page": { "limit": 100, "offset": 0, "total": 1, "has_more": false }
}
```

`role`: `teacher` / `coordinator` / `director`. Telegram ID не отдаётся.

### 3.6 `GET /meta`

Шкалы (`daily_scores.scale` = 0–5), значения `attendance`, все категории и типы тестов с навыками и максимумами, список недоступных полей, текущие лимиты. Вызывайте раз при старте агента, а не на каждый запрос.

## 4. Как правильно пользоваться API

### 4.1 Постраничная выгрузка по курсору (`/lessons`, `/tests`)

Идите по `page.next_cursor`, пока он не станет `null`. **Страница может быть короче `limit` и даже пустой при `has_more: true`** — сервер за один вызов просматривает не больше 2000 отметок, чтобы не грузить базу. Это нормально: просто запросите следующую страницу.

Курсор привязан к тем же фильтрам — не меняйте параметры между страницами.

```python
import os, time, requests

BASE = "https://attendance.ltsastana.kz/attendance-api/v1"
S = requests.Session()
S.headers["Authorization"] = f"Bearer {os.environ['ATT_TOKEN']}"

def get(path, **params):
    for attempt in range(5):
        r = S.get(BASE + path, params=params, timeout=60)
        if r.status_code == 429:                                   # лимит — ждём столько, сколько сказал сервер
            time.sleep(int(r.headers.get("Retry-After", "5")))
            continue
        if r.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()                                       # 400/401/403 — ошибка в запросе, не повторять
        return r.json()
    raise RuntimeError(f"{path}: не удалось после повторов")

def iterate(path, **params):
    cursor = None
    while True:
        page = get(path, **params, limit=500, **({"cursor": cursor} if cursor else {}))
        yield from page["data"]
        cursor = page["page"]["next_cursor"]
        if not cursor:
            return

for rec in iterate("/lessons", date_from="2026-11-01", date_to="2026-11-14"):
    ...
```

Node.js (18+):
```js
const BASE = 'https://attendance.ltsastana.kz/attendance-api/v1';
const headers = { Authorization: `Bearer ${process.env.ATT_TOKEN}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, params) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers });
    if (res.status === 429) { await sleep(Number(res.headers.get('retry-after') || 5) * 1000); continue; }
    if (res.status >= 500) { await sleep(2 ** attempt * 1000); continue; }
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }
  throw new Error(`${path}: не удалось после повторов`);
}

async function* iterate(path, params = {}) {
  let cursor;
  do {
    const page = await get(path, { ...params, limit: 500, ...(cursor ? { cursor } : {}) });
    yield* page.data;
    cursor = page.page.next_cursor;
  } while (cursor);
}
```

### 4.2 Инкрементальная синхронизация (раз в час)

1. Первый запуск: полная выгрузка `/lessons` и `/tests` за нужный период (по месяцам — период не длиннее 366 дней).
2. Сохраните у себя `max(updated_at)` из полученных записей.
3. Следующий запуск: `updated_since = сохранённое значение − 5 минут` (запас на отметки, которые сохранялись в момент выгрузки).
4. Записи **upsert-ите по `record_id` / `test_id`** — из-за запаса часть придёт повторно.

Отметки после сохранения не редактируются, поэтому `updated_at` = время появления записи; удалений нет.

### 4.3 Точечный запрос по ученику (бот-куратор, «Мой профиль»)

```
GET /students?hollyhop_client_id=801                          → группа, уровень, преподаватель
GET /lessons?hollyhop_client_id=801&date_from=2026-10-15      → посещаемость, баллы, темы, ДЗ
GET /tests?hollyhop_client_id=801&date_from=2026-05-14        → тесты за полгода
```
Кэшируйте ответ у себя хотя бы на несколько минут: данные меняются только когда преподаватель отмечает урок.

### 4.4 Что не надо делать

- Не опрашивайте чаще раза в 5–10 минут для синхронизации — новые данные появляются только после уроков.
- Не запускайте параллельно больше 2–3 запросов: сверх 3 одновременных — `429 too_many_concurrent`.
- Не перебирайте всех учеников запросами `/lessons?hollyhop_client_id=…` по одному — заберите период целиком по курсору.
- Не делайте запросы из браузера/мини-аппа — токен утечёт.
- Не повторяйте 400/401/403 — это ошибка запроса или доступа, повтор не поможет.

## 5. Лимиты и ошибки

| Ограничение | Значение | Что приходит |
|---|---|---|
| Запросов в минуту с одного IP (вкл. запросы без токена) | 60 | `429 {"error":"rate_limited"}` + `Retry-After: <сек>` |
| Одновременных запросов на весь API | 3 | `429 {"error":"too_many_concurrent"}` + `Retry-After: 2` |
| Неверных токенов за 15 минут с одного IP | 10 | `429 {"error":"too_many_attempts"}` на 15 минут |
| Записей на страницу | 1–500 (по умолчанию 100) | `400 bad_param` |
| Период `/lessons`, `/tests` | ≤ 366 дней | `400 {"error":"period_too_long","maxDays":366}` |
| Окно справочников | ≤ 180 дней | `400 bad_param` (`active_since`) |
| Отметок, просматриваемых за вызов | 2000 | неполная страница + `next_cursor` |

В каждом ответе: `X-RateLimit-Limit` и `X-RateLimit-Remaining` — сколько запросов осталось в текущей минуте.

| Код | `error` | Что делать |
|---|---|---|
| 400 | `bad_param` (+ `param` — какой параметр) / `period_too_long` | исправить запрос |
| 401 | `unauthorized` | проверить токен |
| 403 | `ip_not_allowed` | IP не в allowlist — сообщить разработчику кабинета |
| 404 | `not_found` | неверный путь |
| 405 | `read_only` | API только на чтение |
| 429 | `rate_limited` / `too_many_concurrent` / `too_many_attempts` | подождать `Retry-After` секунд |
| 500 | `server` | повторить с паузой; если повторяется — сообщить |

## 6. Безопасность (п. 6 ТЗ)

- Доступ только по токену и только по HTTPS; токен проверяется за постоянное время, в логи не пишется.
- Ответы с `Cache-Control: no-store`: прокси и клиенты не кэшируют персональные данные.
- IP-allowlist: пришлите исходящие IP ваших агентов — включим (`403 ip_not_allowed` для остальных).
- Scope — только чтение и только поля из этого документа (без Telegram ID, телефонов и т.п.).
- Токен API менторов и этот токен — разные; один не открывает другой API.

## 7. Чего в кабинете нет (ответ на п. 4.4, 4.6 ТЗ)

| Поле из ТЗ | Статус |
|---|---|
| Рекомендации преподавателя (п. 4.6) | **В кабинете не собираются** — эндпоинта нет. Если нужно — добавим поле в форму урока и эндпоинт `/recommendations`; это отдельная задача |
| `absence_reason` | Преподаватель причину пропуска не вводит → всегда `null` |
| `comment` | Отдельного комментария нет: в HollyHop комментарием уходит тема урока (`topic`) → всегда `null` |
| `schedule` групп | Ведётся в HollyHop → `null` |
| ДЗ/активность/поведение | Есть, шкала **0–5** (у вас 1–5: 0 = «не выполнено / ноль»). Только у присутствовавших |

## 8. Настройка на сервере (для разработчика кабинета)

В `/opt/ltc-cabinet-node/shared/.env`:

| Переменная | По умолчанию | |
|---|---|---|
| `ATTENDANCE_API_KEY` | пусто = API закрыт | токен (сгенерировать: `openssl rand -hex 32`) |
| `ATTENDANCE_API_RATE_PER_MIN` | 60 | запросов в минуту с IP |
| `ATTENDANCE_API_MAX_CONCURRENT` | 3 | одновременных запросов на весь API |
| `ATTENDANCE_API_IPS` | пусто = любой IP | allowlist через запятую |
| `ATTENDANCE_API_CACHE_MS` | 300000 | кэш справочников `/students`, `/groups` |

После изменения `.env` — перезапуск сервиса. Перед первым запуском — `npm run init-db` (добавит индекс `submissions.created_at` для `updated_since`).

Проверка:
```bash
curl -s -H "Authorization: Bearer $ATTENDANCE_API_KEY" https://attendance.ltsastana.kz/attendance-api/v1/meta | head -c 300
```
