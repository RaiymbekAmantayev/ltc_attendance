// Уровни КТП и приведение к ним уровней групп HollyHop.
// В HollyHop один уровень пишут по-разному: «Inter + (plus)» = «Intermediate Plus», «Upper intermediate» = «Upper-Intermediate».
// Уровни без КТП (Family and Friends, Proficiency, IELTS…) → null: преподаватель вводит тему вручную.
const LEVELS = ['Beginner', 'Elementary', 'Pre-Intermediate', 'Intermediate', 'Intermediate Plus', 'Upper Intermediate', 'Advanced'];

const BASES = {
  beginner: 'Beginner',
  elementary: 'Elementary',
  preintermediate: 'Pre-Intermediate', preinter: 'Pre-Intermediate',
  intermediate: 'Intermediate', inter: 'Intermediate',
  upperintermediate: 'Upper Intermediate', upperinter: 'Upper Intermediate', upper: 'Upper Intermediate',
  advanced: 'Advanced',
};

/** Уровень HollyHop (или КТП) → один из LEVELS либо null. */
function normalize(raw) {
  const text = String(raw || '').toLowerCase();
  const plus = /\+|plus/.test(text);
  const base = text.replace(/plus/g, '').replace(/[^a-z]/g, '');
  const level = BASES[base] || null;
  if (level === 'Intermediate' && plus) return 'Intermediate Plus';
  return level;
}

module.exports = { LEVELS, normalize };
