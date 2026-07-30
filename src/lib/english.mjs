// Общие для сборки колоды и рантайма примитивы работы с английским текстом.
// Файл намеренно .mjs: его импортирует и Node (scripts/build-deck.mjs), и Vite.

/**
 * Приведение к каноничному виду без потери написания.
 * Схлопывает пробелы, опускает регистр, выпрямляет типографские кавычки и тире,
 * снимает конечную точку — «Cats.» и «cats» это один ответ.
 */
export function normalize(s) {
  return s
    .trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.!?,;:]+$/, '')
    .trim();
}

/**
 * Британское написание → американское. Список закрытый и проверяемый.
 *
 * Правила на суффиксы (-ise → -ize, -our → -or) заманчивы, но ломаются на
 * «promise», «hour», «four»: там те же буквы значат другое. Поэтому пары
 * перечислены поштучно, а сборка колоды следит, чтобы после этой замены
 * два разных слова не стали одинаковыми.
 */
export const BRITISH = {
  colour: 'color', colours: 'colors', coloured: 'colored', colourful: 'colorful',
  favourite: 'favorite', favour: 'favor', flavour: 'flavor', humour: 'humor',
  honour: 'honor', labour: 'labor', neighbour: 'neighbor', behaviour: 'behavior',
  odour: 'odor', rumour: 'rumor', harbour: 'harbor', vapour: 'vapor',
  centre: 'center', centres: 'centers', theatre: 'theater', litre: 'liter',
  metre: 'meter', fibre: 'fiber', kilometre: 'kilometer',
  organise: 'organize', organised: 'organized', organisation: 'organization',
  realise: 'realize', realised: 'realized', recognise: 'recognize',
  apologise: 'apologize', criticise: 'criticize', emphasise: 'emphasize',
  memorise: 'memorize', minimise: 'minimize', maximise: 'maximize',
  specialise: 'specialize', summarise: 'summarize', analyse: 'analyze',
  defence: 'defense', offence: 'offense', licence: 'license', practise: 'practice',
  travelled: 'traveled', travelling: 'traveling', traveller: 'traveler',
  cancelled: 'canceled', cancelling: 'canceling', modelling: 'modeling',
  labelled: 'labeled', jewellery: 'jewelry', programme: 'program',
  grey: 'gray', tyre: 'tire', pyjamas: 'pajamas', moustache: 'mustache',
  aeroplane: 'airplane', aluminium: 'aluminum', enquire: 'inquire',
  storey: 'story', whilst: 'while', maths: 'math', plough: 'plow',
  cheque: 'check', kerb: 'curb', draught: 'draft', gaol: 'jail',
};

/** Служебные слова, которые в ответе не обязательны. */
const LEADING = /^(?:to|a|an|the)\s+/;

/**
 * Каноничный вид, дополнительно игнорирующий необязательное:
 * начальное «to» у глаголов, артикль, дефис против пробела, апостроф
 * и британское написание. Всё это ошибками не считается.
 */
export function normalizeLoose(s) {
  let out = normalize(s).replace(LEADING, '');
  out = out
    .split(' ')
    .map((w) => BRITISH[w] ?? w)
    .join(' ');
  return out.replace(/['\-\s]/g, '');
}

/**
 * Стабильный идентификатор слова. Строится из написания в нижнем регистре,
 * поэтому переживает правку перевода, темы и примера. Менять поле `en`
 * у существующего слова нельзя — это новое слово и потерянный прогресс.
 */
export function slugify(en) {
  return normalize(en)
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Сравнение ответа с эталоном.
 *
 * 'exact' — написано ровно то, что ждали.
 * 'close' — отличие в необязательном: «to go» вместо «go», «colour» вместо
 *   «color», «ice-cream» вместо «ice cream». Ошибкой не считаем, но и молча
 *   пропускать нельзя: в английском написание — половина знания слова,
 *   поэтому правильный вариант показывается, а карточка идёт как «трудно».
 * 'wrong' — всё остальное, включая опечатку в одну букву: на карточке
 *   диктанта опечатка и есть тот самый навык, который тренируется.
 */
export function compareAnswer(input, expected) {
  const a = normalize(input);
  const b = normalize(expected);
  if (a === b) return 'exact';
  if (normalizeLoose(a) === normalizeLoose(b)) return 'close';
  return 'wrong';
}

/** Расстояние Левенштейна — для подсказки «ты был близко». */
export function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}
