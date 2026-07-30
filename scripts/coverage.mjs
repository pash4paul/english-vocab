#!/usr/bin/env node
/**
 * Сколько из списка Oxford уже разобрано в словаре.
 *
 * Список 3000/5000 — это план: слова с уровнями, но без переводов и тем.
 * В занятия попадает только то, что лежит в data/*.yaml. Скрипт показывает,
 * где мы находимся, и подсказывает следующую порцию слов для /add-words.
 *
 * Запуск: npm run coverage [-- A1 20]
 *   первый аргумент — уровень, второй — сколько слов показать (по умолчанию 40).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/lib/english.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wantLevel = args.find((a) => LEVELS.includes(a.toUpperCase()))?.toUpperCase();
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);

const deck = JSON.parse(readFileSync(join(ROOT, 'src/generated/deck.json'), 'utf8'));
const known = new Set(deck.words.map((w) => normalize(w.en)));

const plan = new Map();
for (const line of readFileSync(join(ROOT, 'data/oxford-5000.tsv'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [word, pos, level, hint] = line.split('\t');
  const key = normalize(word ?? '');
  if (!key || !LEVELS.includes(level)) continue;
  const prev = plan.get(key);
  if (prev && LEVELS.indexOf(prev.level) <= LEVELS.indexOf(level)) continue;
  plan.set(key, { word, pos, level, hint: hint ?? '' });
}

console.log('уровень  в плане  разобрано  осталось');
for (const level of LEVELS) {
  const rows = [...plan.values()].filter((r) => r.level === level);
  const done = rows.filter((r) => known.has(normalize(r.word))).length;
  console.log(
    level.padEnd(7),
    String(rows.length).padStart(8),
    String(done).padStart(10),
    String(rows.length - done).padStart(9),
  );
}

const total = plan.size;
const done = [...plan.values()].filter((r) => known.has(normalize(r.word))).length;
console.log(`\nвсего: ${done} из ${total} (${Math.round((done / total) * 100)}%)`);

// Слова словаря, которых в плане нет: обычно это слова из урока, но иногда опечатка.
const extra = deck.words.filter((w) => !plan.has(normalize(w.en)));
if (extra.length) {
  console.log(`\nВ словаре есть, в списке Oxford нет: ${extra.length}`);
  console.log('  ' + extra.slice(0, 20).map((w) => w.en).join(', ') + (extra.length > 20 ? '…' : ''));
}

const nextLevel = wantLevel ?? LEVELS.find(
  (l) => [...plan.values()].some((r) => r.level === l && !known.has(normalize(r.word))),
);
if (!nextLevel) {
  console.log('\nПлан разобран целиком.');
} else {
  const rest = [...plan.values()]
    .filter((r) => r.level === nextLevel && !known.has(normalize(r.word)))
    .sort((a, b) => a.word.localeCompare(b.word));
  console.log(`\nСледующие слова уровня ${nextLevel} (${rest.length} осталось):`);
  for (const r of rest.slice(0, limit)) {
    console.log(`  ${r.word}\t${r.pos}${r.hint ? `\t(${r.hint})` : ''}`);
  }
  if (rest.length > limit) console.log(`  … и ещё ${rest.length - limit}`);
}
