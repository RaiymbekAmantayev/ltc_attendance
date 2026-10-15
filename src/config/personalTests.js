// Персональные тесты HollyHop: метод AddEditPersonalTestResult. Пишутся вместе с обязательным ежедневным тестом (testing.js).
// Преподаватель выбирает не больше одной категории на урок; у категории с несколькими типами — ещё и тип теста.
// Набор навыков в запросе обязан совпадать с набором навыков типа теста, баллы — не выше максимума (требование HollyHop).
const k = (id, name, max) => ({ id, name, max });

const FULL = [k(1, 'Listening', 10), k(2, 'Reading', 15), k(3, 'Grammar', 40), k(4, 'Vocabulary', 40),
  k(5, 'Pronunciation', 20), k(6, 'Speaking', 15), k(7, 'Writing', 10)];
const ENTRY = [k(3, 'Grammar', 25), k(4, 'Vocabulary', 25)];

module.exports = {
  /** Поле discipline в AddEditPersonalTestResult. */
  discipline: 'Английский',

  /** id — категория теста, types — типы теста HollyHop (testTypeId) со своими навыками. */
  categories: [
    { id: 1, name: 'Progress Test', types: [
      { id: 1, name: 'Progress Test', skills: [...FULL, k(21, 'Attendance', 2)] }] },
    { id: 4, name: 'Final Test', types: [
      { id: 1, name: 'Final Test', skills: FULL }] },               // testTypeId 1 — как у Progress Test (по данным Учебного отдела)
    { id: 6, name: 'Entry test', types: [
      { id: 124, name: 'Elementary', skills: ENTRY },
      { id: 125, name: 'Pre-Intermediate', skills: ENTRY },
      { id: 126, name: 'Intermediate', skills: ENTRY },
      { id: 127, name: 'Intermediate+', skills: ENTRY },
      { id: 128, name: 'Upper-Intermediate', skills: ENTRY },
      { id: 129, name: 'Advanced', skills: ENTRY }] },
    { id: 5, name: 'Revise&Check', types: [
      { id: 5, name: 'Повторение по пройденным двум главам', skills: [k(1, 'Listening', 5), k(2, 'Reading', 6), k(3, 'Grammar', 15),
        k(4, 'Vocabulary', 25), k(5, 'Pronunciation', 5), k(6, 'Speaking', 6)] },
      { id: 6, name: 'Advanced', skills: [k(1, 'Listening', 4), k(2, 'Reading', 9), k(3, 'Grammar', 20), k(4, 'Vocabulary', 30)] },
      { id: 7, name: 'Upper-Intermediate', skills: [k(1, 'Listening', 4), k(2, 'Reading', 4), k(3, 'Grammar', 15),
        k(4, 'Vocabulary', 25), k(5, 'Pronunciation', 10)] }] },
  ],

  /** Тип теста категории или null, если такой пары нет. */
  find(categoryId, testTypeId) {
    const category = this.categories.find(c => c.id === Number(categoryId));
    const type = category && category.types.find(t => t.id === Number(testTypeId));
    return type ? { category, type } : null;
  },
};
