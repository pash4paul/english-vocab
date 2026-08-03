#!/usr/bin/env node
/**
 * Список Oxford 3000/5000 из PDF → data/oxford-5000.tsv.
 *
 * Это не словарь приложения, а *план*: какие слова вообще стоит выучить и на
 * каком уровне CEFR они считаются нужными. Словарь живёт в data/*.yaml, и слово
 * попадает в занятия только когда у него есть перевод и тема. Скрипт
 * coverage.mjs показывает, сколько из плана уже разобрано.
 *
 * Разбор PDF свой, без зависимостей: потоки внутри файла сжаты deflate,
 * а текст в них лежит обычными операторами Tj/TJ — этого достаточно.
 * Формат страницы: «слово часть-речи.» подряд, без разделителей, поэтому
 * ищем метки частей речи, а головкой считаем всё, что стоит между ними.
 *
 * Запуск: npm run import:oxford [-- путь/к/папке/с/pdf]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = join(ROOT, 'data/oxford-5000.tsv');
const DEFAULT_DIR = join(ROOT, '../dictionaries');

/** Части речи, которые в PDF всегда с точкой: «n.», «adj.», «modal v.» */
const DOTTED = ['modal v', 'auxiliary v', 'exclam', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'n', 'v'];
/** …и без точки. */
const BARE = ['indefinite article', 'definite article', 'infinitive marker', 'number', 'noun'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Точка иногда отбита от метки пробелом («reproduce v . reproduction») — это кернинг,
// а не новое слово. «number» — часть речи только если за ним не идёт своя метка:
// «number n.» — это слово.
const ABBR = DOTTED.map(esc).join('|');
const ONE =
  `(?:(?:${ABBR})\\s?\\.` +
  // «wish v, n.» — точка потерялась, но метка узнаётся по соседке через запятую.
  `|(?:${ABBR})(?=\\s*,\\s*(?:${ABBR})\\s?\\.)` +
  `|(?:in|)definite article|infinitive marker` +
  // «number» и «noun» — части речи, только если следом не идёт своя метка:
  // «number n.» и «noun n.» это слова.
  `|(?:number|noun)(?!\\s*(?:n|v|adj|adv)\\s?\\.))`;
const POS_RE = new RegExp(`(?<=[\\s)])${ONE}(?:\\s*[,/]\\s*${ONE})*`, 'g');
const LEVEL_RE = /(?<![A-Za-z0-9])(A1|A2|B1|B2|C1)(?=[a-z\s]|$)/g;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** Единственные головки списка, которые действительно состоят из двух слов. */
const MULTIWORD = new Set([
  'a, an', 'according to', 'all right', 'have to', 'ice cream', 'next to',
  'no one', 'used to',
]);

/** Колонтитулы и вступительный текст — не слова. */
const JUNK = /^(\(c\) Oxford|©|\d+ \/ \d+$|The Oxford \d+|by CEFR level|\(American English\)|, from A1|, it includes|3000$|words to learn)/;

/** Лигатуры и типографика: в PDF они одиночными байтами. */
const GLYPH = {
  '': 'Th', '': 'fi', '': 'fl', '': '', '­': '-',
  '': "'", '': "'", '': '"', '': '"',
  '': '-', '': '-', '': '', '©': '(c)',
};

/** Раскрывает escape-последовательности строки PDF: \n, \( , \251. */
function unescapePdf(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const next = s[++i];
    if (next === undefined) break;
    if ('nrtbf'.includes(next)) { out += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[next]; continue; }
    if (next >= '0' && next <= '7') {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i))[0];
      out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      i += oct.length - 1;
      continue;
    }
    out += next;
  }
  return [...out].map((ch) => GLYPH[ch] ?? ch).join('');
}

/**
 * Текст страниц PDF в порядке чтения.
 *
 * Строку начинаем заново при каждой смене позиции (Tm/Td/T*): без этого
 * заголовок уровня «A1» склеивается с первым словом, и уровень теряется.
 */
function pdfLines(file) {
  const buf = readFileSync(file);
  const lines = [];
  // Потоки ищем по сырым байтам: содержимое бинарное, но маркеры — ASCII.
  const text = buf.toString('latin1');
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    let raw;
    try {
      raw = inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      continue; // не deflate или не поток контента — пропускаем
    }
    if (!raw.includes('Tj') && !raw.includes('TJ')) continue;

    let cur = '';
    let curY = null;
    const ops = /\[((?:[^[\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+Tm|[-\d.]+\s+([-\d.]+)\s+T[dD]|(T\*)/g;
    let op;
    while ((op = ops.exec(raw))) {
      const [, arr, str, tmY, tdY, star] = op;
      if (arr !== undefined) {
        for (const piece of arr.match(/\((?:[^()\\]|\\.)*\)/g) ?? []) {
          cur += unescapePdf(piece.slice(1, -1));
        }
      } else if (str !== undefined) {
        cur += unescapePdf(str);
      } else if (star) {
        if (cur.trim()) lines.push(cur.trim());
        cur = '';
      } else {
        // Tm задаёт координату целиком, Td сдвигает от текущей. Считаем y сами:
        // «sa» и «y» стоят на одной строке, просто заданы разными операторами.
        const y = tmY !== undefined ? Number(tmY) : (curY ?? 0) + Number(tdY);
        if (curY === null || Math.abs(y - curY) > 0.5) {
          if (cur.trim()) lines.push(cur.trim());
          cur = '';
        }
        curY = y;
      }
    }
    if (cur.trim()) lines.push(cur.trim());
  }
  return lines;
}

/** Слова одного PDF: [{ word, pos, level, hint, idx }] */
function parse(file) {
  const blob = ' ' + pdfLines(file).filter((l) => !JUNK.test(l)).join(' ');
  const marks = [...blob.matchAll(LEVEL_RE)];
  const out = [];
  const problems = [];

  marks.forEach((mark, i) => {
    const from = mark.index + mark[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : blob.length;
    const seg = ' ' + blob.slice(from, to);
    let prev = 0;
    for (const m of seg.matchAll(POS_RE)) {
      let head = seg.slice(prev, m.index).trim();
      prev = m.index + m[0].length;

      // «bank (money) n.» — уточнение смысла; «last 1 (final) det.» — номер омонима.
      let hint = '';
      const paren = /\(([^)]*)\)/.exec(head);
      if (paren) {
        hint = paren[1].trim();
        head = (head.slice(0, paren.index) + head.slice(paren.index + paren[0].length)).trim();
      }
      let idx = '';
      const num = /^(.*?)\s*(\d)$/.exec(head);
      if (num) { head = num[1].trim(); idx = num[2]; }
      head = head.replace(/^[.,\s]+|[.,\s]+$/g, '');

      if (!head || !/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ',\- ]*$/.test(head)) {
        // Пустая головка — метка части речи, повторённая при переносе страницы.
        if (head) problems.push(`${basename(file)}: не разобрано «${head}»`);
        continue;
      }

      // Кернинг оставляет пробел перед точкой метки — «v .» это та же «v.».
      // Метка «noun» иногда выписана словом, а «wish v, n.» теряет точку.
      const pos = m[0].trim()
        .replace(/\s+\./g, '.')
        .replace(/\bnoun\b/g, 'n.')
        .replace(/\b(adj|adv|prep|pron|conj|det|n|v)\b(?!\.)/g, '$1.')
        .replace(/\s*,\s*/g, ', ');

      // Пробел внутри головки — почти всегда дефект PDF, а не составное слово.
      if (head.includes(' ') && !MULTIWORD.has(head.toLowerCase())) {
        const parts = head.split(/\s+/);
        const at = parts.findIndex((x) => /^(adj|adv|prep|pron|conj|det|n|v)$/.test(x));
        if (at >= 0) {
          // Метка части речи осталась без точки: слово слева забирает её себе,
          // слово справа продолжает с текущей меткой.
          const left = parts.slice(0, at).join(' ');
          if (left) out.push({ word: left, pos: `${parts[at]}.`, level: mark[1], hint: '', idx: '' });
          head = parts.slice(at + 1).join(' ');
          if (!head) continue;
        } else {
          // Кернинг разорвал слово на середине: «s cope» — это scope.
          const glued = parts.join('');
          problems.push(`${basename(file)}: склеено «${head}» → «${glued}»`);
          head = glued;
        }
      }
      // Единственная составная головка списка — «a, an indefinite article».
      for (const one of head.split(/,\s*/)) {
        out.push({ word: one, pos, level: mark[1], hint, idx });
      }
    }
    const tail = seg.slice(prev).trim();
    if (tail) problems.push(`${basename(file)}: хвост без части речи «${tail.slice(0, 60)}»`);
  });

  return { entries: out, problems };
}

function main() {
  const argDir = process.argv[2];
  const dir = argDir ?? DEFAULT_DIR;
  if (!existsSync(dir)) {
    console.error(`✗ Нет папки со словарями: ${dir}`);
    console.error('  Положи туда PDF Oxford 3000/5000 или укажи путь: npm run import:oxford -- ~/путь');
    process.exit(1);
  }
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  if (!pdfs.length) {
    console.error(`✗ В ${dir} нет ни одного PDF`);
    process.exit(1);
  }

  const all = [];
  const problems = [];
  for (const f of pdfs) {
    const r = parse(join(dir, f));
    console.log(`  ${f}: ${r.entries.length} записей`);
    all.push(...r.entries);
    problems.push(...r.problems);
  }

  // Слово может стоять в обоих файлах — оставляем самый низкий уровень:
  // учить его надо тогда, когда оно впервые понадобилось.
  const best = new Map();
  for (const e of all) {
    const key = [e.word.toLowerCase(), e.pos, e.hint, e.idx].join('|');
    const prev = best.get(key);
    if (!prev || LEVELS.indexOf(e.level) < LEVELS.indexOf(prev.level)) best.set(key, e);
  }
  const rows = [...best.values()].sort(
    (a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      a.word.toLowerCase().localeCompare(b.word.toLowerCase()),
  );

  const tsv = ['# word\tpos\tlevel\thint\tidx\t— список Oxford 3000/5000, собирается npm run import:oxford']
    .concat(rows.map((e) => [e.word, e.pos, e.level, e.hint, e.idx].join('\t')))
    .join('\n') + '\n';
  writeFileSync(OUT_FILE, tsv);

  const byLevel = LEVELS.map((l) => `${l} — ${rows.filter((r) => r.level === l).length}`);
  console.log(`✓ ${rows.length} записей · ${new Set(rows.map((r) => r.word.toLowerCase())).size} слов`);
  console.log(`  ${byLevel.join(', ')}`);
  console.log(`  записано в ${OUT_FILE.replace(ROOT + '/', '')}`);
  if (problems.length) {
    console.log(`  не разобрано: ${problems.length}`);
    for (const p of problems.slice(0, 10)) console.log(`    ! ${p}`);
  }
}

main();
