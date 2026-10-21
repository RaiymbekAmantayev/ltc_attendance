// Ежедневный тест в HollyHop: пишется как персональный (AddEditPersonalTestResult) с типом 131/132.
// Набор навыков в запросе обязан совпадать с набором навыков типа теста, баллы — не выше максимума (требование HollyHop).
// fixed — навык не показывается в интерфейсе, в HollyHop и БД всегда уходит default.
const WAS_PRESENT = { id: 8, name: 'Was present for (min)', max: 45, default: 45, fixed: true };

module.exports = {
  /** Тип теста зависит от преподавателя: Foreign → 131, Local → 132 (колонка Local/Foreign в реестре). */
  testTypeIds: { foreign: 131, local: 132 },

  /**
   * Навыки по типам теста. name — название навыка в HollyHop (показывается в интерфейсе), max — максимум баллов,
   * pass — порог успешности (балл ≥ pass), default — значение по умолчанию.
   * Навык с id: null не используется (ни в интерфейсе, ни в HollyHop), пока не указан ID.
   */
  skillsByType: {
    131: [WAS_PRESENT,
      { id: 11, name: 'Homework', max: 5, pass: 4 },
      { id: 9, name: 'Engagement', max: 5, pass: 4 },
      { id: 10, name: 'Discipline', max: 5, pass: 4 }],
    132: [WAS_PRESENT,
      { id: 13, name: 'Домашнее задание', max: 5, pass: 4 },
      { id: 9, name: 'Активность', max: 5, pass: 4 },
      { id: 10, name: 'Дисциплина', max: 5, pass: 4 }],
  },

  /** Для каких учебных единиц писать тест. Пусто = для всех (HH_TEST_EDUNIT_IDS=31,32 — только для перечисленных). */
  edUnitIds: String(process.env.HH_TEST_EDUNIT_IDS || '').split(/[,;\s]+/).filter(Boolean),

  /** Навыки типа теста (неизвестный тип → Local), без навыков с ещё не указанным ID. */
  skillsFor(typeId) { return (this.skillsByType[typeId] || this.skillsByType[132]).filter(k => k.id != null); },
};
