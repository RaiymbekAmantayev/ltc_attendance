// Тест группы в HollyHop: метод AddEditEdUnitTestResult.
// Набор навыков в запросе обязан совпадать с набором навыков типа теста, баллы — не выше максимума (требование HollyHop).
const WAS_PRESENT = { id: 8, name: 'Was present for (min)', max: 45, default: 45 };

module.exports = {
  /** Тип теста зависит от преподавателя: Foreign → 131, Local → 132 (колонка Local/Foreign в реестре). */
  testTypeIds: { foreign: 131, local: 132 },

  /**
   * Навыки по типам теста. name — название навыка в HollyHop (показывается в интерфейсе), max — максимум баллов,
   * pass — порог успешности (балл ≥ pass), default — значение по умолчанию.
   */
  skillsByType: {
    131: [WAS_PRESENT,
      { id: 11, name: 'Homework', max: 5, pass: 4 },
      { id: 17, name: 'Discipline/Engagement', max: 5, pass: 4 }],
    132: [WAS_PRESENT,
      { id: 13, name: 'Домашнее задание', max: 5, pass: 4 },
      { id: 18, name: 'Дисциплина/Активность', max: 5, pass: 4 }],
  },

  /** Для каких учебных единиц писать тест. Пусто = для всех (HH_TEST_EDUNIT_IDS=31,32 — только для перечисленных). */
  edUnitIds: String(process.env.HH_TEST_EDUNIT_IDS || '').split(/[,;\s]+/).filter(Boolean),

  /** Навыки типа теста (неизвестный тип → Local). */
  skillsFor(typeId) { return this.skillsByType[typeId] || this.skillsByType[132]; },
};
