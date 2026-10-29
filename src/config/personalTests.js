// Персональные тесты HollyHop: метод AddEditPersonalTestResult. Пишутся вместе с обязательным ежедневным тестом (testing.js).
// Преподаватель выбирает не больше одной категории на урок; у категории с несколькими типами — ещё и тип теста.
// Набор навыков в запросе обязан совпадать с набором навыков типа теста, баллы — не выше максимума (требование HollyHop).
const k = (id, name, max) => ({ id, name, max });

const FULL = [k(1, 'Listening', 10), k(2, 'Reading', 15), k(3, 'Grammar', 40), k(4, 'Vocabulary', 40),
  k(5, 'Pronunciation', 20), k(6, 'Speaking', 15), k(7, 'Writing', 10)];
const ENTRY = [k(3, 'Grammar', 25), k(4, 'Vocabulary', 25)];
const NEF = [k(1, 'Listening', 10), k(2, 'Reading', 15), k(3, 'Grammar', 20), k(4, 'Vocabulary', 20),
  k(5, 'Pronunciation', 10), k(6, 'Speaking', 15), k(7, 'Writing', 10), k(16, 'Practical English', 5)];

module.exports = {
  /** Поле discipline в AddEditPersonalTestResult. */
  discipline: 'Английский',

  /** id — категория теста, types — типы теста HollyHop (testTypeId) со своими навыками. */
  categories: [
    { id: 1, name: 'Progress Test', types: [
      { id: 1, name: 'Progress Test', skills: [...FULL, k(21, 'Attendance', 2)] }] },
    { id: 4, name: 'Final Test', types: [
      // Тест «Общий» — testTypeId 4. Раньше по ошибке слали 1 (это Progress Test, требует Attendance) — старые отметки читаются по legacyIds.
      { id: 4, legacyIds: [1], name: 'Final Test', skills: FULL }] },
    { id: 6, name: 'Entry test', types: [
      { id: 111, name: 'Elementary', skills: ENTRY },
      { id: 13, name: 'Pre-Intermediate', skills: ENTRY },
      { id: 112, name: 'Intermediate', skills: ENTRY },
      { id: 113, name: 'Intermediate+', skills: ENTRY },
      { id: 114, name: 'Upper-Intermediate', skills: ENTRY },
      { id: 115, name: 'Advanced', skills: ENTRY }] },
    { id: 5, name: 'Revise&Check', types: [
      { id: 5, name: 'Повторение по пройденным двум главам', skills: [k(1, 'Listening', 5), k(2, 'Reading', 6), k(3, 'Grammar', 15),
        k(4, 'Vocabulary', 25), k(5, 'Pronunciation', 5), k(6, 'Speaking', 6)] },
      { id: 6, name: 'Advanced', skills: [k(1, 'Listening', 4), k(2, 'Reading', 9), k(3, 'Grammar', 20), k(4, 'Vocabulary', 30)] },
      { id: 7, name: 'Upper-Intermediate', skills: [k(1, 'Listening', 4), k(2, 'Reading', 4), k(3, 'Grammar', 15),
        k(4, 'Vocabulary', 25), k(5, 'Pronunciation', 10)] }] },
    { id: 45, name: 'File Test NEF', types: Array.from({ length: 12 }, (_, i) =>   // File 1–12 → testTypeId 137–148
      ({ id: 137 + i, name: `File ${i + 1}`, skills: NEF })) },
  ],

  /** Тип теста категории (в т.ч. по прежнему id из legacyIds) или null, если такой пары нет. */
  find(categoryId, testTypeId) {
    const id = Number(testTypeId);
    const category = this.categories.find(c => c.id === Number(categoryId));
    const type = category && category.types.find(t => t.id === id || (t.legacyIds || []).includes(id));
    return type ? { category, type } : null;
  },
};
