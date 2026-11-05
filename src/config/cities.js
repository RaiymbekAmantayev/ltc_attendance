// Города для фильтров: по Id офиса (филиала) HollyHop. Офисы Алматы — HH_ALMATY_OFFICE_IDS (по умолчанию 7 и 9), остальные — Астана.
const ALMATY = 'Алматы', ASTANA = 'Астана', NONE = '—';
const almatyIds = String(process.env.HH_ALMATY_OFFICE_IDS ?? '7,9').split(',').map(s => s.trim()).filter(Boolean);

/** Город по Id офиса HollyHop; officeId не известен — Астана. */
const of = officeId => (officeId != null && almatyIds.includes(String(officeId)) ? ALMATY : ASTANA);

module.exports = { ALMATY, ASTANA, NONE, almatyIds, of };
