#!/usr/bin/env node
// Читает data/*.yaml, валидирует, выводит формы по правилам и собирает
// src/generated/deck.json. Запускается перед dev и build; `npm run check` —
// только валидация, без записи файла.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { slugify, normalize, normalizeLoose } from '../src/lib/english.mjs';
import { adjectiveForms, pluralize, verbForms } from './morphology.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const OUT_FILE = join(ROOT, 'src/generated/deck.json');

const CHECK_ONLY = process.argv.includes('--check');

const POS = [
  'noun', 'verb', 'adj', 'adv', 'phrase', 'prep', 'pron', 'num',
  'conj', 'det', 'exclam', 'modal', 'article', 'other',
];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const FORM_KEYS = ['plural', 'third', 'ing', 'past', 'participle', 'comparative', 'superlative'];

/** Какие формы вообще бывают у части речи. */
const FORMS_BY_POS = {
  noun: ['plural'],
  verb: ['third', 'ing', 'past', 'participle'],
  adj: ['comparative', 'superlative'],
};

const errors = [];
const warnings = [];
const derived = { noun: 0, verb: 0, adj: 0 };
const mismatches = [];
const gaps = new Map();
let fromIrregular = 0;
let levelFromList = 0;

function err(file, word, msg) {
  errors.push(`${file}${word ? ` [${word}]` : ''}: ${msg}`);
}
function warn(file, word, msg) {
  warnings.push(`${file}${word ? ` [${word}]` : ''}: ${msg}`);
}

/**
 * Неправильные глаголы из data/irregular-verbs.tsv.
 * Используются там, где правило даёт другую форму, и уступают ключу `forms:`
 * в yaml. Приоритет: руками > таблица > правила.
 */
function loadIrregular() {
  const out = new Map();
  let raw;
  try {
    raw = readFileSync(join(DATA_DIR, 'irregular-verbs.tsv'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('base\tpast\t')) continue;
    const [base, past, participle, third, ing] = line.split('\t').map((s) => s?.trim() ?? '');
    if (!base || !past) continue;
    const forms = { past, participle: participle || past };
    if (third) forms.third = third;
    if (ing) forms.ing = ing;
    out.set(base.toLowerCase(), forms);
  }
  return out;
}
const IRREGULAR = loadIrregular();

/**
 * Список Oxford 3000/5000: план изучения и заодно проверка написания.
 * Уровень слова берётся отсюда, если в yaml его не указали.
 */
function loadOxford() {
  const out = new Map();
  let raw;
  try {
    raw = readFileSync(join(DATA_DIR, 'oxford-5000.tsv'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [word, , level] = line.split('\t');
    const key = normalize(word ?? '');
    if (!key || !LEVELS.includes(level)) continue;
    const prev = out.get(key);
    if (!prev || LEVELS.indexOf(level) < LEVELS.indexOf(prev)) out.set(key, level);
  }
  return out;
}
const OXFORD = loadOxford();

function buildWord(file, topic, docLevel, lesson, raw, index) {
  const where = raw?.en ?? `#${index + 1}`;

  if (!raw || typeof raw !== 'object') {
    err(file, where, 'запись должна быть объектом с полями en/ru');
    return null;
  }
  if (typeof raw.en === 'boolean') {
    err(file, String(raw.en),
      'YAML прочитал слово как логическое значение — оберни в кавычки: en: \'true\'. ' +
      'Так же ведут себя yes, no, on, off, null');
    return null;
  }
  if (!raw.en || typeof raw.en !== 'string') {
    err(file, where, 'нет обязательного поля en (английское слово)');
    return null;
  }
  if (!raw.ru || typeof raw.ru !== 'string') {
    err(file, where, 'нет обязательного поля ru (перевод)');
    return null;
  }

  const pos = raw.pos ?? 'other';
  if (!POS.includes(pos)) {
    err(file, where, `неизвестное pos: "${pos}". Допустимо: ${POS.join(', ')}`);
    return null;
  }

  // Служебное «to» в словаре не хранится: оно не часть слова, а признак
  // инфинитива, и в ответе принимается с ним и без него.
  const en = raw.en.trim().replace(/^to\s+/i, '');
  if (/[^A-Za-z'\- ]/.test(en)) {
    warn(file, en, 'в слове есть посторонние символы — проверь написание');
  }

  // Уровень: из yaml, иначе из списка Oxford. Слова не из списка обязаны
  // объявить уровень сами — иначе непонятно, когда их показывать.
  const fromList = OXFORD.get(normalize(en));
  const level = raw.level ?? docLevel ?? fromList;
  if (!level) {
    err(file, en, 'нет уровня: слова нет в списке Oxford, укажи level: A1…C1 явно');
    return null;
  }
  if (!LEVELS.includes(level)) {
    err(file, en, `уровень "${level}" не из списка ${LEVELS.join('/')}`);
    return null;
  }
  if (!raw.level && !docLevel && fromList) levelFromList++;
  if (!fromList) {
    warn(file, en, 'слова нет в списке Oxford 3000/5000 — опечатка или слово из урока?');
  }

  const forms = {};
  // Пустое значение (`plural: ~`) — не пропуск, а заявление: такой формы у слова
  // не бывает. «Januaries» грамматически возможно, но спрашивать его незачем.
  const suppressed = new Set();
  const f = raw.forms ?? {};
  for (const key of Object.keys(f)) {
    if (!FORM_KEYS.includes(key)) {
      err(file, en, `неизвестная форма "${key}". Допустимо: ${FORM_KEYS.join(', ')}`);
      return null;
    }
    if (f[key] == null) suppressed.add(key);
    else forms[key] = String(f[key]).trim();
  }

  const uncountable = raw.uncountable === true;
  const gradable = raw.gradable !== false;
  const irregular = raw.irregular === true;

  if (uncountable && pos !== 'noun') {
    warn(file, en, `uncountable задан для pos: ${pos} — игнорирую`);
  }
  if (uncountable && forms.plural) {
    warn(file, en, 'слово помечено uncountable, но у него задано множественное число');
  }

  applyMorphology(file, en, pos, forms, { irregular, uncountable, gradable, suppressed });

  if (raw.example && !raw.example.includes(' ')) {
    warn(file, en, 'example выглядит как одно слово — для пропуска нужно предложение');
  }
  if (raw.example && !containsWord(raw.example, en, forms)) {
    warn(file, en, 'example не содержит само слово — упражнение «пропуск» будет пропущено');
  }
  if (raw.example && !raw.exampleRu) {
    warn(file, en, 'у примера нет перевода exampleRu — в подсказке будет пусто');
  }

  return {
    id: `${slugify(en)}:${pos}`,
    en,
    ru: raw.ru.trim(),
    pos,
    level,
    forms: Object.keys(forms).length ? forms : undefined,
    irregular: irregular || undefined,
    uncountable: uncountable || undefined,
    gradable: gradable ? undefined : false,
    example: raw.example?.trim(),
    exampleRu: raw.exampleRu?.trim(),
    note: raw.note?.trim(),
    topic,
    lesson,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
}

/**
 * Сверяет формы, записанные вручную, с регулярными правилами.
 *
 * Правила не заменяют человека: неправильные слова им не по зубам, и для них
 * есть таблица и флаг `irregular: true`. Смысл в другом — ни одно расхождение
 * между человеком и правилом не должно пройти незамеченным. Либо это опечатка,
 * либо слово действительно исключение, и это признаётся явно.
 *
 * Где формы нет вовсе, а правило применимо — форма подставляется,
 * чтобы не писать руками предсказуемое.
 */
function applyMorphology(file, en, pos, forms, flags) {
  const keys = FORMS_BY_POS[pos];
  if (!keys) return;
  if (pos === 'noun' && flags.uncountable) return;
  if (pos === 'adj' && !flags.gradable) return;

  const table = pos === 'verb' ? IRREGULAR.get(normalize(en)) : undefined;
  const rules = ruleForms(pos, en);

  for (const key of keys) {
    if (flags.suppressed?.has(key)) continue;
    const manual = forms[key];
    const expected = rules.forms?.[key];
    const known = table?.[key];

    if (manual) {
      // Таблица неправильных — тоже факт, а не догадка: с ней сверяемся так же.
      const reference = known ?? expected;
      const from = known ? 'таблице неправильных' : 'правилу';
      if (reference && normalize(manual) !== normalize(reference) && !flags.irregular) {
        mismatches.push(
          `${file} [${en}]: ${key} — по ${from} «${reference}», в файле «${manual}». ` +
          'Опечатка? Если слово исключение, добавь irregular: true',
        );
      }
      continue;
    }

    if (known) {
      forms[key] = known;
      fromIrregular++;
      continue;
    }
    if (expected) {
      forms[key] = expected;
      derived[pos]++;
      continue;
    }
    // Правило отказалось, таблицы нет — клетка остаётся пустой и попадает
    // в отчёт: заполняется руками ключом forms: в yaml. Кроме случая, когда
    // формы не существует вовсе: «more beautiful» — это не форма слова.
    if (!flags.irregular && !rules.analytic) {
      gaps.set(key, (gaps.get(key) ?? 0) + 1);
      warn(file, en, `нет формы ${key}: ${rules.skip ?? 'правило не применимо'}`);
    }
  }
}

function ruleForms(pos, en) {
  if (pos === 'noun') {
    const r = pluralize(en);
    return r.form ? { forms: { plural: r.form } } : { skip: r.skip };
  }
  if (pos === 'verb') return verbForms(en);
  if (pos === 'adj') return adjectiveForms(en);
  return {};
}

/**
 * Есть ли слово в примере. Сначала ищем известные формы целиком: в английском
 * прошедшее может не иметь ничего общего со словарной формой (go → went).
 * Потом — по основе, чтобы поймать формы, которых у нас нет.
 */
function containsWord(sentence, en, forms) {
  const flat = normalizeLoose(sentence);
  const tokens = new Set(normalize(sentence).split(/[^a-z']+/).filter(Boolean));
  const candidates = [en, ...Object.values(forms ?? {})]
    .flatMap((v) => String(v).split('|'))
    .map((v) => normalize(v).trim())
    .filter(Boolean);
  if (candidates.some((c) => tokens.has(c) || flat.includes(normalizeLoose(c)))) return true;
  const bare = normalizeLoose(en);
  return flat.includes(bare.slice(0, Math.max(3, bare.length - 2)));
}

function loadFiles() {
  let files;
  try {
    files = readdirSync(DATA_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(DATA_DIR, f), 'utf8');
    let doc;
    try {
      doc = parse(raw);
    } catch (e) {
      err(f, null, `не парсится YAML — ${e.message}`);
      return null;
    }
    return { file: f, doc };
  }).filter(Boolean);
}

function main() {
  const docs = loadFiles();
  if (!docs.length) {
    console.error('✗ В data/ нет ни одного .yaml файла');
    process.exit(1);
  }

  const words = [];
  const seen = new Map();

  for (const { file, doc } of docs) {
    if (!doc || !Array.isArray(doc.words)) {
      err(file, null, 'ожидается ключ words со списком слов');
      continue;
    }
    const topic = doc.topic?.trim() || basename(file, '.yaml');
    const docLevel = doc.level?.trim();
    const lesson = doc.lesson != null ? String(doc.lesson) : undefined;

    doc.words.forEach((raw, i) => {
      const w = buildWord(file, topic, docLevel, lesson, raw, i);
      if (!w) return;
      const prev = seen.get(w.id);
      if (prev) {
        warn(file, w.en, `дубль слова из ${prev.file} (тема «${prev.topic}») — оставляю первое`);
        return;
      }
      seen.set(w.id, { file, topic });
      words.push(w);
    });
  }

  checkTranslations(words);

  for (const w of warnings) console.warn(`  ! ${w}`);
  if (mismatches.length) {
    console.warn('\n  Расхождения с правилами словоизменения:');
    for (const m of mismatches) console.warn(`  ⚠ ${m}`);
    console.warn('');
  }
  if (errors.length) {
    console.error(`\n✗ Ошибок: ${errors.length}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  const topics = [...new Set(words.map((w) => w.topic))];
  const levels = LEVELS.filter((l) => words.some((w) => w.level === l));
  const deck = { version: 1, builtFrom: docs.map((d) => d.file), topics, levels, words };

  if (!CHECK_ONLY) {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(deck, null, 2) + '\n');
  }

  report(words, topics, levels);
}

/**
 * Одинаковый перевод у двух разных слов — не мелочь: на карточке RU→EN видно
 * «маленький», а какое из двух слов вводить — непонятно. Заодно ловим слова,
 * которые проверка ответа не сможет различить: британское написание и дефисы
 * она игнорирует, и «grey» с «gray» стали бы одним словом.
 */
function checkTranslations(words) {
  const byRu = new Map();
  const byLoose = new Map();
  for (const w of words) {
    const ru = w.ru.toLowerCase();
    const prev = byRu.get(ru);
    if (prev) {
      warn('перевод', w.ru, `тот же перевод у «${prev.en}» и «${w.en}» — разведи уточнением в скобках`);
    } else {
      byRu.set(ru, w);
    }
    // Одно и то же слово в разных частях речи — не столкновение: в вопросе
    // стоит разный перевод, а ответ и должен быть одинаковым (second — и
    // «второй», и «секунда»). Ловим только разные написания, ставшие одним.
    const loose = normalizeLoose(w.en);
    const clash = byLoose.get(loose);
    if (clash && normalize(clash.en) !== normalize(w.en)) {
      warn('написание', w.en, `неотличимо от «${clash.en}» при проверке ответа`);
    } else {
      byLoose.set(loose, w);
    }
  }
}

function report(words, topics, levels) {
  const withExample = words.filter((w) => w.example).length;
  const withForms = words.filter((w) => w.forms).length;
  const autoTotal = derived.noun + derived.verb + derived.adj;
  const byLevel = levels.map((l) => `${l} — ${words.filter((w) => w.level === l).length}`);

  console.log(
    `✓ ${words.length} слов · ${topics.length} тем · ${withExample} с примером · ${withForms} с формами` +
    (warnings.length ? ` · предупреждений: ${warnings.length}` : ''),
  );
  console.log(`  по уровням: ${byLevel.join(', ')}`);
  if (autoTotal) {
    console.log(
      `  формы выведены по правилам: ${autoTotal} ` +
      `(существительных ${derived.noun}, глаголов ${derived.verb}, прилагательных ${derived.adj})`,
    );
  }
  if (fromIrregular) console.log(`  форм из таблицы неправильных глаголов: ${fromIrregular}`);
  if (levelFromList) console.log(`  уровень взят из списка Oxford: ${levelFromList}`);
  if (mismatches.length) console.log(`  расхождений с правилами: ${mismatches.length} — см. выше`);
  if (gaps.size) {
    const parts = [...gaps.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} — ${n}`);
    console.log(
      `  пустых форм: ${parts.join(', ')}\n` +
      '    Это места, где правила нет; заполняются вручную ключом forms: в yaml.',
    );
  }
}

main();
