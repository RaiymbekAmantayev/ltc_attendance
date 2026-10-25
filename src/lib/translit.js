// Кириллица → латиница для иностранных преподавателей (ФИО учеников из HollyHop приходят кириллицей).
// Русские буквы — по практической схеме загранпаспорта, казахские — к ближайшей латинской букве.
const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};

const isUpper = ch => !!ch && ch !== ch.toLowerCase();

/** «Жанна ЖУМАБАЕВА» → «Zhanna ZHUMABAEVA»; латиница и прочие символы не меняются. */
module.exports = text => {
  const chars = [...String(text ?? '')];
  return chars.map((ch, i) => {
    const out = MAP[ch.toLowerCase()];
    if (out === undefined) return ch;
    if (!isUpper(ch)) return out;
    const allCaps = isUpper(chars[i + 1]) || (isUpper(chars[i - 1]) && !/\p{L}/u.test(chars[i + 1] || ''));
    return allCaps ? out.toUpperCase() : out.charAt(0).toUpperCase() + out.slice(1);
  }).join('');
};
