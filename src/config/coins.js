// Коины ученика: пользовательское поле «Коины» в карточке ученика HollyHop. Начисляются после записи результатов урока.
// Ежедневный тест: (ДЗ + активность) × 2. Доп. тесты Progress Test, Final Test, Revise&Check, File Test NEF:
// 60–80 % от максимума → 10 коинов, 80 % и выше → 20 (Entry test коинов не даёт).
const testing = require('./testing');
const personalTests = require('./personalTests');

const HOMEWORK = [11, 13];                                   // Homework (131) / Домашнее задание (132)
const ENGAGEMENT = 9;                                        // Engagement / Активность
const SCORED_CATEGORIES = [1, 4, 5, 45];                    // Progress Test, Final Test, Revise&Check, File Test NEF

module.exports = {
  /** Название пользовательского поля ученика в HollyHop. */
  field: process.env.HH_COINS_FIELD || 'Коины',

  /** Сколько коинов начислить ученику за урок (0 — ничего). s — строка ученика из payload отметки. */
  forStudent(s, payload) {
    let coins = 0;
    if (s.skills) {
      const ids = testing.skillsFor(payload.testTypeId).map(k => k.id);
      const score = id => Number(s.skills[id]) || 0;
      coins += HOMEWORK.filter(id => ids.includes(id)).reduce((sum, id) => sum + score(id) * 2, 0) + score(ENGAGEMENT) * 2;
    }
    const found = s.personalSkills && payload.personal && SCORED_CATEGORIES.includes(Number(payload.personal.categoryId))
      && personalTests.find(payload.personal.categoryId, payload.personal.testTypeId);
    if (found) {
      const max = found.type.skills.reduce((sum, k) => sum + k.max, 0);
      const got = found.type.skills.reduce((sum, k) => sum + (Number(s.personalSkills[k.id]) || 0), 0);
      const share = max ? got / max : 0;
      if (share >= 0.8) coins += 20;
      else if (share >= 0.6) coins += 10;
    }
    return Math.round(coins * 100) / 100;                    // ДЗ может быть дробным (3,5)
  },
};
