// Регулярные правила английского словоизменения.
//
// Здесь только то, что выводится надёжно. Где по написанию форму не угадать
// (leaf → leaves, но roof → roofs), правило отказывается работать и возвращает
// { skip: причина }: пустая клетка честнее выдуманной формы — упражнение
// просто не спросит её, а слово получит форму руками в data/*.yaml.
//
// Неправильные глаголы живут отдельно, в data/irregular-verbs.tsv: это закрытый
// список фактов языка, а не правило. Приоритет: руками в yaml > таблица > правила.

const VOWELS = 'aeiou';

const isVowel = (ch) => VOWELS.includes(ch);

/**
 * Слоги по гласным группам — грубо, но для «односложное или нет» хватает.
 * Конечная «e» обычно не звучит: dance — один слог, а не два.
 */
export function syllables(word) {
  const groups = word.toLowerCase().match(/[aeiouy]+/g) ?? [];
  let n = groups.length;
  if (n > 1 && /[^aeiouy]e$/.test(word)) n -= 1;
  return Math.max(1, n);
}

/**
 * Глаголы и прилагательные, у которых ударение падает на последний слог,
 * поэтому согласная перед окончанием удваивается: begin → beginning.
 *
 * Список нужен потому, что по буквам это не видно: «begin» и «listen»
 * выглядят одинаково, а формы у них разные — beginning против listening.
 * В американском написании неударный слог согласную не удваивает
 * (travel → traveling), так что список короткий и закрытый.
 */
export const FINAL_STRESS = new Set([
  'admit', 'allot', 'commit', 'compel', 'confer', 'control', 'deter', 'equip',
  'expel', 'infer', 'occur', 'omit', 'patrol', 'permit', 'prefer', 'propel',
  'rebel', 'recur', 'refer', 'regret', 'repel', 'submit', 'transfer', 'upset',
  'begin', 'forget', 'forbid',
]);

/**
 * Удваивается ли конечная согласная перед гласным окончанием.
 * Условие: закрытый слог «согласная-гласная-согласная», конечная не w/x/y,
 * и слог под ударением — то есть слово односложное или из списка выше.
 */
export function doublesFinal(word) {
  const w = word.toLowerCase();
  if (!/[^aeiou][aeiou][^aeiouwxy]$/.test(w)) return false;
  return syllables(w) === 1 || FINAL_STRESS.has(w);
}

/** Основа + окончание с удвоением, если оно нужно. */
function attach(word, suffix) {
  return doublesFinal(word) ? word + word.slice(-1) + suffix : word + suffix;
}

// ─── Существительные ──────────────────────────────────────────────────────

/**
 * Множественное число.
 *
 * Отказываемся на -f/-fe/-o и на греко-латинских -sis: leaf → leaves,
 * но roof → roofs; potato → potatoes, но photo → photos. Различие не в
 * написании, а в истории слова, поэтому такие формы вписываются руками.
 */
export function pluralize(noun) {
  const parts = noun.trim().split(/\s+/);
  const head = parts.pop();
  const rest = parts.length ? parts.join(' ') + ' ' : '';
  const done = (form) => ({ form: rest + form });
  // Решения принимаем по строчным буквам, а форму строим из исходного слова:
  // иначе Monday превращается в mondays, а T-shirt — в t-shirts.
  const lower = head.toLowerCase();

  if (/sis$/.test(lower)) {
    return { skip: 'слова на -sis берут греческое множественное: analysis → analyses' };
  }
  if (/(?:[^f]f|fe|lf)$/.test(lower)) {
    return { skip: 'на -f/-fe непредсказуемо: leaf → leaves, но roof → roofs' };
  }
  if (/[^aeiou]o$/.test(lower)) {
    return { skip: 'на согласную + -o непредсказуемо: potato → potatoes, но photo → photos' };
  }
  if (/(?:s|x|z|ch|sh)$/.test(lower)) return done(head + 'es');
  if (/[^aeiou]y$/.test(lower)) return done(head.slice(0, -1) + 'ies');
  return done(head + 's');
}

// ─── Глаголы ──────────────────────────────────────────────────────────────

/** 3 л. ед. ч.: he/she/it. */
function thirdPerson(v) {
  if (/(?:s|x|z|ch|sh|o)$/.test(v)) return v + 'es';
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ies';
  return v + 's';
}

/** Форма на -ing. */
function ingForm(v) {
  if (/ie$/.test(v)) return v.slice(0, -2) + 'ying';           // die → dying
  if (/[^aeiouy]e$/.test(v) && v.length > 2) return v.slice(0, -1) + 'ing'; // make → making
  return attach(v, 'ing');
}

/** Правильное прошедшее время. */
function regularPast(v) {
  if (/e$/.test(v)) return v + 'd';                             // like → liked
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + 'ied';      // study → studied
  return attach(v, 'ed');
}

/**
 * Формы глагола по правилам.
 *
 * Прошедшее и причастие годятся только для правильных глаголов; неправильные
 * приходят из таблицы и перекрывают выведенное. Составные глаголы изменяются
 * по первому слову: give up → gives up, gave up.
 */
export function verbForms(verb) {
  const parts = verb.trim().toLowerCase().split(/\s+/);
  const head = parts.shift();
  const tail = parts.length ? ' ' + parts.join(' ') : '';

  if (!/^[a-z]+$/.test(head)) {
    return { skip: 'в основе не только буквы — формы задаются руками' };
  }

  const past = regularPast(head);
  return {
    forms: {
      third: thirdPerson(head) + tail,
      ing: ingForm(head) + tail,
      past: past + tail,
      participle: past + tail,
    },
  };
}

// ─── Прилагательные ───────────────────────────────────────────────────────

/**
 * Степени сравнения — только синтетические, на -er/-est.
 *
 * Длинные прилагательные образуют их через more/most, и спрашивать
 * «more beautiful» бессмысленно: это не форма слова, а конструкция.
 * Поэтому для них правило отказывается, и упражнение их не трогает.
 */
export function adjectiveForms(adj) {
  const w = adj.trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) return { skip: 'составное прилагательное' };

  const syl = syllables(w);
  const short = syl === 1 || (syl === 2 && /(?:y|le|er|ow)$/.test(w));
  if (!short) {
    // Не пробел в данных, а свойство слова: форм на -er/-est у него не бывает.
    return { analytic: true, skip: 'степени через more/most — это конструкция, а не форма' };
  }

  if (/[^aeiou]y$/.test(w)) {
    const stem = w.slice(0, -1) + 'i';
    return { forms: { comparative: stem + 'er', superlative: stem + 'est' } };
  }
  if (/e$/.test(w)) {
    return { forms: { comparative: w + 'r', superlative: w + 'st' } };
  }
  return { forms: { comparative: attach(w, 'er'), superlative: attach(w, 'est') } };
}
