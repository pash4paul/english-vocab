#!/usr/bin/env node
/**
 * Тесты сравнения ответа с эталоном.
 *
 * Повод для отдельного файла: в английском написание — половина знания слова,
 * и решение «что считать ошибкой» тут важнее, чем кажется. Обязательное —
 * буквы; необязательное — «to» перед глаголом, артикль, дефис против пробела
 * и британское написание. Опечатка ошибкой остаётся: на карточке диктанта
 * именно она и тренируется.
 *
 * Запуск: npm run test:answer
 */

import { compareAnswer, normalize, normalizeLoose, slugify } from '../src/lib/english.mjs';

let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  if (String(actual) === String(expected)) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}\n      получено: ${actual}\n      ожидалось: ${expected}`);
}

const cmp = (input, expected, verdict, what) =>
  eq(compareAnswer(input, expected), verdict, what ?? `«${input}» против «${expected}» — ${verdict}`);

console.log('Точное совпадение не зависит от регистра и точки');
cmp('cat', 'cat', 'exact');
cmp('Cat', 'cat', 'exact');
cmp('  cat  ', 'cat', 'exact');
cmp('cat.', 'cat', 'exact');
cmp('ice  cream', 'ice cream', 'exact');
cmp('don’t', "don't", 'exact', 'типографский апостроф считается обычным');

console.log('Необязательное — не ошибка, но и не точный ответ');
cmp('to go', 'go', 'close');
cmp('the sun', 'sun', 'close');
cmp('a cat', 'cat', 'close');
cmp('ice-cream', 'ice cream', 'close');
cmp('dont', "don't", 'close');
cmp('colour', 'color', 'close');
cmp('favourite', 'favorite', 'close');
cmp('centre', 'center', 'close');
cmp('travelling', 'traveling', 'close');
cmp('grey', 'gray', 'close');
cmp('organise', 'organize', 'close');

console.log('Опечатка и другая форма — ошибка');
cmp('cta', 'cat', 'wrong');
cmp('cats', 'cat', 'wrong', 'множественное вместо единственного — не тот ответ');
cmp('goed', 'went', 'wrong');
cmp('hous', 'house', 'wrong');
cmp('', 'cat', 'wrong');
cmp('bank', 'bench', 'wrong');

console.log('Замена британского написания не трогает похожие слова');
eq(normalizeLoose('promise'), 'promise', 'promise остаётся promise, а не promize');
eq(normalizeLoose('hour'), 'hour', 'hour остаётся hour, а не hor');
eq(normalizeLoose('four'), 'four', 'four остаётся four');
eq(normalizeLoose('exercise'), 'exercise', 'exercise остаётся exercise');
eq(normalizeLoose('flour'), 'flour', 'flour остаётся flour');
cmp('promise', 'promise', 'exact');
cmp('hour', 'hour', 'exact');

console.log('Нормализация и идентификаторы');
eq(normalize('  The   Sun. '), 'the sun', 'схлопывает пробелы и снимает точку');
eq(normalizeLoose('to  give up'), 'giveup', 'служебное to и пробелы уходят');
eq(slugify('ice cream'), 'ice-cream', 'пробел становится дефисом');
eq(slugify("don't"), 'dont', 'апостроф выпадает');
eq(slugify('T-shirt'), 't-shirt', 'дефис остаётся');
eq(slugify('Mr.'), 'mr', 'точка не попадает в идентификатор');

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
