#!/usr/bin/env node
/**
 * Тесты правил английского словоизменения на заведомо известных парах.
 *
 * Правила существуют затем, чтобы быть надёжнее человека; непроверенное
 * правило этого свойства не имеет. Любая правка morphology.mjs начинается
 * с новой строчки здесь.
 *
 * Запуск: npm run test:morph
 */

import {
  adjectiveForms, doublesFinal, pluralize, syllables, verbForms,
} from './morphology.mjs';

let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  if (String(actual) === String(expected)) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}\n      получено: ${actual}\n      ожидалось: ${expected}`);
}

function plural(word, expected) {
  const r = pluralize(word);
  eq(r.form ?? `(отказ: ${r.skip})`, expected, `${word} → ${expected}`);
}

function skips(word, what) {
  const r = pluralize(word);
  eq(r.form ? `вывелось «${r.form}»` : 'отказ', 'отказ', `${word}: ${what}`);
}

function verb(word, key, expected) {
  const r = verbForms(word);
  eq(r.forms?.[key] ?? `(отказ: ${r.skip})`, expected, `${word} → ${expected} (${key})`);
}

function adj(word, comparative, superlative) {
  const r = adjectiveForms(word);
  if (comparative === null) {
    eq(r.forms ? `вывелось «${r.forms.comparative}»` : 'отказ', 'отказ',
      `${word}: степени только через more/most`);
    return;
  }
  eq(r.forms?.comparative, comparative, `${word} → ${comparative}`);
  eq(r.forms?.superlative, superlative, `${word} → ${superlative}`);
}

console.log('Слоги и удвоение согласной');
eq(syllables('stop'), 1, 'stop — один слог');
eq(syllables('dance'), 1, 'dance — один слог, конечная e не звучит');
eq(syllables('begin'), 2, 'begin — два слога');
eq(syllables('beautiful'), 3, 'beautiful — три слога');
eq(syllables('travel'), 2, 'travel — два слога');
eq(doublesFinal('stop'), true, 'stop удваивает: односложное, закрытый слог');
eq(doublesFinal('begin'), true, 'begin удваивает: ударение на последнем слоге');
eq(doublesFinal('listen'), false, 'listen не удваивает: ударение на первом слоге');
eq(doublesFinal('travel'), false, 'travel не удваивает в американском написании');
eq(doublesFinal('need'), false, 'need не удваивает: две гласные перед согласной');
eq(doublesFinal('show'), false, 'show не удваивает: конечная w');
eq(doublesFinal('fix'), false, 'fix не удваивает: конечная x');
eq(doublesFinal('play'), false, 'play не удваивает: конечная y');

console.log('Множественное число');
plural('cat', 'cats');
plural('book', 'books');
plural('table', 'tables');
plural('day', 'days');
plural('boy', 'boys');
plural('key', 'keys');
plural('city', 'cities');
plural('country', 'countries');
plural('baby', 'babies');
plural('story', 'stories');
plural('family', 'families');
plural('bus', 'buses');
plural('glass', 'glasses');
plural('box', 'boxes');
plural('watch', 'watches');
plural('sandwich', 'sandwiches');
plural('dish', 'dishes');
plural('class', 'classes');
plural('zoo', 'zoos');
plural('video', 'videos');
plural('radio', 'radios');
plural('ice cream', 'ice creams');
plural('post office', 'post offices');
skips('potato', 'на согласную + -o правила нет');
skips('tomato', 'на согласную + -o правила нет');
skips('photo', 'на согласную + -o правила нет');
skips('leaf', 'на -f правила нет');
skips('knife', 'на -fe правила нет');
skips('shelf', 'на -lf правила нет');
skips('roof', 'на -f правила нет');
skips('analysis', 'греческое множественное');

console.log('Глаголы: 3 л. ед. ч.');
verb('work', 'third', 'works');
verb('go', 'third', 'goes');
verb('do', 'third', 'does');
verb('watch', 'third', 'watches');
verb('wash', 'third', 'washes');
verb('fix', 'third', 'fixes');
verb('miss', 'third', 'misses');
verb('teach', 'third', 'teaches');
verb('study', 'third', 'studies');
verb('try', 'third', 'tries');
verb('carry', 'third', 'carries');
verb('play', 'third', 'plays');
verb('buy', 'third', 'buys');
verb('enjoy', 'third', 'enjoys');
verb('give up', 'third', 'gives up');

console.log('Глаголы: форма на -ing');
verb('work', 'ing', 'working');
verb('go', 'ing', 'going');
verb('make', 'ing', 'making');
verb('come', 'ing', 'coming');
verb('write', 'ing', 'writing');
verb('take', 'ing', 'taking');
verb('dance', 'ing', 'dancing');
verb('stop', 'ing', 'stopping');
verb('run', 'ing', 'running');
verb('get', 'ing', 'getting');
verb('swim', 'ing', 'swimming');
verb('sit', 'ing', 'sitting');
verb('begin', 'ing', 'beginning');
verb('prefer', 'ing', 'preferring');
verb('admit', 'ing', 'admitting');
verb('control', 'ing', 'controlling');
verb('visit', 'ing', 'visiting');
verb('open', 'ing', 'opening');
verb('listen', 'ing', 'listening');
verb('happen', 'ing', 'happening');
verb('travel', 'ing', 'traveling');
verb('offer', 'ing', 'offering');
verb('answer', 'ing', 'answering');
verb('remember', 'ing', 'remembering');
verb('die', 'ing', 'dying');
verb('lie', 'ing', 'lying');
verb('see', 'ing', 'seeing');
verb('agree', 'ing', 'agreeing');
verb('be', 'ing', 'being');
verb('play', 'ing', 'playing');
verb('show', 'ing', 'showing');
verb('fix', 'ing', 'fixing');
verb('give up', 'ing', 'giving up');

console.log('Глаголы: правильное прошедшее');
verb('work', 'past', 'worked');
verb('want', 'past', 'wanted');
verb('need', 'past', 'needed');
verb('watch', 'past', 'watched');
verb('like', 'past', 'liked');
verb('live', 'past', 'lived');
verb('dance', 'past', 'danced');
verb('study', 'past', 'studied');
verb('try', 'past', 'tried');
verb('carry', 'past', 'carried');
verb('play', 'past', 'played');
verb('enjoy', 'past', 'enjoyed');
verb('stop', 'past', 'stopped');
verb('plan', 'past', 'planned');
verb('travel', 'past', 'traveled');
verb('visit', 'past', 'visited');
verb('open', 'past', 'opened');
verb('listen', 'past', 'listened');
verb('prefer', 'past', 'preferred');
verb('admit', 'past', 'admitted');
verb('answer', 'past', 'answered');
console.log('  причастие правильного глагола совпадает с прошедшим');
verb('work', 'participle', 'worked');
verb('study', 'participle', 'studied');
verb('stop', 'participle', 'stopped');

console.log('Степени сравнения');
adj('big', 'bigger', 'biggest');
adj('hot', 'hotter', 'hottest');
adj('thin', 'thinner', 'thinnest');
adj('sad', 'sadder', 'saddest');
adj('wet', 'wetter', 'wettest');
adj('cold', 'colder', 'coldest');
adj('small', 'smaller', 'smallest');
adj('young', 'younger', 'youngest');
adj('tall', 'taller', 'tallest');
adj('cheap', 'cheaper', 'cheapest');
adj('nice', 'nicer', 'nicest');
adj('large', 'larger', 'largest');
adj('late', 'later', 'latest');
adj('happy', 'happier', 'happiest');
adj('easy', 'easier', 'easiest');
adj('busy', 'busier', 'busiest');
adj('dirty', 'dirtier', 'dirtiest');
adj('funny', 'funnier', 'funniest');
adj('pretty', 'prettier', 'prettiest');
adj('dry', 'drier', 'driest');
adj('simple', 'simpler', 'simplest');
adj('narrow', 'narrower', 'narrowest');
adj('clever', 'cleverer', 'cleverest');
adj('beautiful', null);
adj('expensive', null);
adj('important', null);
adj('interesting', null);
adj('difficult', null);
adj('careful', null);
adj('dangerous', null);

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
