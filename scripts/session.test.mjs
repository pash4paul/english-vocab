#!/usr/bin/env node
/**
 * Проверка поведения упражнений: что спрашивают и что принимают в ответ.
 *
 * Колода собирается своя: src/generated/deck.json в git не хранится,
 * и режим `--check` его не создаёт.
 *
 * Запуск: npm run test:session
 */

const {
  spokenForm, expectedAnswer, acceptedAnswers, checkAnswer, clozeSentence,
  drillableForms, buildSession,
} = await import('../src/lib/session.ts');
const { DEFAULT_SETTINGS, FORM_KEYS } = await import('../src/types.ts');

let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  if (String(actual) === String(expected)) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}\n      получено: ${actual}\n      ожидалось: ${expected}`);
}

const verb = {
  id: 'go:verb', en: 'go', ru: 'идти, ехать', pos: 'verb', level: 'A1',
  topic: 'Движение', tags: [], irregular: true,
  example: 'We went to the beach yesterday.',
  exampleRu: 'Мы ходили на пляж вчера.',
  forms: { third: 'goes', ing: 'going', past: 'went', participle: 'gone' },
};
const regular = {
  id: 'work:verb', en: 'work', ru: 'работать', pos: 'verb', level: 'A1',
  topic: 'Работа', tags: [],
  forms: { third: 'works', ing: 'working', past: 'worked', participle: 'worked' },
};
const noun = {
  id: 'child:noun', en: 'child', ru: 'ребёнок', pos: 'noun', level: 'A1',
  topic: 'Люди', tags: [], irregular: true,
  example: 'Every child has a book.',
  exampleRu: 'У каждого ребёнка есть книга.',
  forms: { plural: 'children' },
};
const learn = {
  id: 'learn:verb', en: 'learn', ru: 'учить', pos: 'verb', level: 'A1',
  topic: 'Учёба', tags: [],
  forms: { third: 'learns', ing: 'learning', past: 'learned|learnt', participle: 'learned|learnt' },
};
const water = {
  id: 'water:noun', en: 'water', ru: 'вода', pos: 'noun', level: 'A1',
  topic: 'Еда', tags: [], uncountable: true,
};

console.log('Озвучивается ровно то, что написано');
eq(spokenForm(verb), 'go', 'глагол');
eq(spokenForm(noun), 'child', 'существительное — без артикля');

console.log('Спрашиваются только формы, отличные от самого слова');
eq(drillableForms(regular, FORM_KEYS).join(','), 'third,ing,past',
  'у правильного глагола причастие совпадает с прошедшим и не спрашивается');
eq(drillableForms(verb, FORM_KEYS).join(','), 'third,ing,past,participle',
  'у неправильного спрашиваются все четыре');
eq(drillableForms(verb, ['past', 'participle']).join(','), 'past,participle',
  'выключенные формы в вопросы не попадают');
eq(drillableForms(water, FORM_KEYS).length, 0, 'у неисчисляемого форм нет');
eq(drillableForms({ ...noun, forms: { plural: 'child' } }, FORM_KEYS).length, 0,
  'форма, равная слову, не спрашивается');

console.log('Ответ на карточке форм — сама форма');
eq(expectedAnswer(verb, 'forms', 'past'), 'went', 'прошедшее');
eq(expectedAnswer(verb, 'forms', 'participle'), 'gone', 'причастие');
eq(expectedAnswer(noun, 'forms', 'plural'), 'children', 'множественное');
eq(expectedAnswer(verb, 'produce'), 'go', 'на вводе RU→EN ждём словарную форму');

console.log('Оба законных варианта формы принимаются');
eq(acceptedAnswers(learn, 'forms', 'past').join(','), 'learned,learnt', 'варианты разложены');
eq(expectedAnswer(learn, 'forms', 'past'), 'learned', 'показывается первый');
eq(checkAnswer('learnt', learn, 'forms', 'past'), 'exact', 'второй вариант — тоже точный ответ');
eq(checkAnswer('learned', learn, 'forms', 'past'), 'exact', 'первый вариант');
eq(checkAnswer('learnd', learn, 'forms', 'past'), 'wrong', 'опечатка остаётся ошибкой');

console.log('«to» перед глаголом и британское написание — не ошибка');
eq(checkAnswer('to go', verb, 'produce'), 'close', 'инфинитив с to');
eq(checkAnswer('go', verb, 'produce'), 'exact', 'без to');
eq(checkAnswer('went', verb, 'produce'), 'wrong', 'другая форма — не ответ');

console.log('Пропуск ищет ту форму, которая стоит в предложении');
const c = clozeSentence(verb);
eq(c.hidden, 'went', 'в пропуск попало прошедшее, а не словарная форма');
eq(c.before.trim(), 'We', 'начало предложения осталось на месте');
eq(expectedAnswer(verb, 'cloze'), 'went', 'ответ — форма из предложения');
const cn = clozeSentence(noun);
eq(cn.hidden, 'child', 'существительное найдено как есть');
eq(clozeSentence(regular), 'null', 'без примера пропуск не собирается');

console.log('Карточка форм не показывается, когда спрашивать нечего');
const stale = (wordId) => ({
  wordId, kind: 'forms', due: '2026-01-01T00:00:00.000Z',
  stability: 10, difficulty: 5, elapsed_days: 0, scheduled_days: 10,
  reps: 3, lapses: 0, state: 2,
});
const plan = buildSession(
  { version: 1, builtFrom: [], topics: ['Люди', 'Еда'], levels: ['A1'], words: [noun, water] },
  {
    version: 1,
    cards: { 'child:noun|forms': stale('child:noun'), 'water:noun|forms': stale('water:noun') },
    reviews: [], days: {}, settings: { ...DEFAULT_SETTINGS },
  },
  new Date('2026-07-30T10:00:00.000Z'),
  true,
);
const formCards = plan.items.filter((i) => i.type === 'card' && i.kind === 'forms');
eq(formCards.length, 1, 'осталась одна карточка форм — у слова, у которого форма есть');
eq(formCards[0].word.id, 'child:noun', 'и это не неисчисляемое слово');
eq(formCards[0].cell, 'plural', 'спрашивается именно множественное число');

console.log('Новые слова идут по уровням: A1 раньше B1');
const later = { ...noun, id: 'issue:noun', en: 'issue', ru: 'вопрос', level: 'B1', forms: { plural: 'issues' }, example: undefined };
const fresh = buildSession(
  { version: 1, builtFrom: [], topics: ['Люди'], levels: ['A1', 'B1'], words: [later, noun] },
  {
    version: 1, cards: {}, reviews: [], days: {},
    settings: { ...DEFAULT_SETTINGS, newWordsPerDay: 1 },
  },
  new Date('2026-07-30T10:00:00.000Z'),
  true,
);
eq(fresh.items[0].word.id, 'child:noun', 'первым знакомится слово уровня A1');

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
