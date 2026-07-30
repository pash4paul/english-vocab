import type {
  CardKind, Deck, DayStats, FormKey, Progress, Settings, StoredCard, Word,
} from '../types.ts';
import { FORM_KEYS, FORM_LABEL, LEVELS, cardKey } from '../types.ts';
import { isGraduated } from './scheduler.ts';
import { compareAnswer, normalize, normalizeLoose } from './english.mjs';

/**
 * Учебный день начинается в 4 утра: занятие в час ночи логичнее засчитать
 * во вчерашний день, иначе «вчера позанимался» ломает стрик.
 */
const DAY_CUTOFF_HOUR = 4;

export function dayKey(d: Date): string {
  const shifted = new Date(d.getTime() - DAY_CUTOFF_HOUR * 3600_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function emptyDay(): DayStats {
  return { newWords: 0, unlocked: 0, reviewed: 0, correct: 0 };
}

/**
 * Ступени. Слово не вываливает все свои карточки разом: следующая открывается,
 * только когда предыдущая выпустилась из фазы обучения.
 *
 * Порядок — по возрастанию сложности: узнал → услышал → записал на слух →
 * воспроизвёл по-русски → воспроизвёл в предложении → знает формы.
 * Диктант стоит третьим намеренно: в английском написание и звучание живут
 * порознь, и «слышу, но не напишу» — самая частая дырка.
 */
const LADDER: CardKind[] = ['recognize', 'listen', 'spell', 'produce', 'cloze', 'forms'];

function ladderFor(word: Word, settings: Settings, ttsAvailable: boolean): CardKind[] {
  const enabled = new Set(settings.enabledKinds);
  return LADDER.filter((k) => {
    if (!enabled.has(k)) return false;
    if (k === 'cloze') return !!word.example && !!clozeSentence(word);
    if (k === 'listen' || k === 'spell') return ttsAvailable;
    if (k === 'forms') return drillableForms(word, enabledForms(settings)).length > 0;
    return true;
  });
}

/** Формы, включённые в настройках. Старый прогресс поля не знает — там все. */
function enabledForms(settings: Settings): FormKey[] {
  return settings.enabledForms ?? FORM_KEYS;
}

/** Уровни, включённые в настройках. Пусто — учатся все. */
function levelAllowed(word: Word, settings: Settings): boolean {
  const levels = settings.enabledLevels ?? [];
  return levels.length === 0 || levels.includes(word.level);
}

/**
 * Формы слова, которые имеет смысл спрашивать.
 *
 * Отсеиваем совпадающие с самим словом: у правильного глагола причастие равно
 * прошедшему (worked/worked), у put — все три формы одинаковы, и спрашивать
 * их значит просить переписать вопрос.
 */
export function drillableForms(word: Word, forms: FormKey[] = FORM_KEYS): FormKey[] {
  const f = word.forms;
  if (!f) return [];
  const base = normalize(word.en);
  const seen = new Set<string>([base]);
  const out: FormKey[] = [];
  for (const key of FORM_KEYS) {
    if (!forms.includes(key)) continue;
    const value = f[key];
    if (!value) continue;
    const shown = normalize(mainForm(value));
    if (seen.has(shown)) continue;
    seen.add(shown);
    out.push(key);
  }
  return out;
}

/** Основной вариант формы: «learned|learnt» → learned. */
export function mainForm(value: string): string {
  return value.split('|')[0].trim();
}

/** Все допустимые варианты формы. */
export function formVariants(value: string): string[] {
  return value.split('|').map((v) => v.trim()).filter(Boolean);
}

export function formLabel(key: FormKey): string {
  return FORM_LABEL[key];
}

/** Какие карточки слова уже разблокированы (существующие + готовые к созданию). */
export function unlockedKinds(
  word: Word,
  cards: Record<string, StoredCard>,
  settings: Settings,
  ttsAvailable: boolean,
): CardKind[] {
  const ladder = ladderFor(word, settings, ttsAvailable);
  const out: CardKind[] = [];
  for (let i = 0; i < ladder.length; i++) {
    if (i === 0) {
      out.push(ladder[i]);
      continue;
    }
    if (isGraduated(cards[cardKey(word.id, ladder[i - 1])])) out.push(ladder[i]);
    else break;
  }
  return out;
}

export type QueueItem =
  | { type: 'intro'; word: Word }
  | { type: 'card'; word: Word; kind: CardKind; isNew: boolean; cell?: FormKey };

/**
 * Карточка форм каждый раз спрашивает случайную форму слова.
 *
 * null — спрашивать нечего: формы либо не заданы, либо отключены в настройках.
 * Карточка могла возникнуть, когда форма была включена, поэтому её надо
 * не показывать, а не надеяться, что её не существует.
 */
function withCell(
  item: Extract<QueueItem, { type: 'card' }>,
  settings: Settings,
): QueueItem | null {
  if (item.kind !== 'forms') return item;
  const cells = drillableForms(item.word, enabledForms(settings));
  if (!cells.length) return null;
  return { ...item, cell: cells[Math.floor(Math.random() * cells.length)] };
}

export interface SessionPlan {
  items: QueueItem[];
  dueCount: number;
  newWordCount: number;
  unlockedCount: number;
  /** Сколько повторений ещё ждёт своей очереди из-за дневного лимита */
  deferred: number;
}

export interface PlanCounts {
  due: number;
  newWords: number;
  unlocked: number;
  total: number;
}

function topicAllowed(word: Word, settings: Settings) {
  return settings.enabledTopics.length === 0 || settings.enabledTopics.includes(word.topic);
}

function allowed(word: Word, settings: Settings) {
  return topicAllowed(word, settings) && levelAllowed(word, settings);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildSession(
  deck: Deck,
  progress: Progress,
  now: Date,
  ttsAvailable: boolean,
): SessionPlan {
  const { settings, cards } = progress;
  const today = progress.days[dayKey(now)] ?? emptyDay();
  const byId = new Map(deck.words.map((w) => [w.id, w]));
  const words = deck.words.filter((w) => allowed(w, settings));

  // 1. Просроченные повторения.
  const nowMs = now.getTime();
  let due: QueueItem[] = [];
  for (const card of Object.values(cards)) {
    const word = byId.get(card.wordId);
    if (!word || !allowed(word, settings)) continue;
    if (!settings.enabledKinds.includes(card.kind)) continue;
    if ((card.kind === 'listen' || card.kind === 'spell') && !ttsAvailable) continue;
    if (new Date(card.due).getTime() <= nowMs) {
      const item = withCell({ type: 'card', word, kind: card.kind, isNew: false }, settings);
      if (item) due.push(item);
    }
  }
  due = shuffle(due);

  let deferred = 0;
  if (settings.maxReviewsPerDay > 0) {
    const left = Math.max(0, settings.maxReviewsPerDay - today.reviewed);
    if (due.length > left) {
      deferred = due.length - left;
      due = due.slice(0, left);
    }
  }

  // 2. Ступени, открывшиеся у уже начатых слов. Это дёшево — слово знакомое,
  //    поэтому лимит мягче, чем на новые слова, но он всё же нужен:
  //    иначе после «выпуска» большой пачки прилетит лавина.
  const unlockedBudget = Math.max(0, settings.newWordsPerDay * 2 - today.unlocked);
  const unlockedUnits: QueueItem[][] = [];
  for (const word of words) {
    if (unlockedUnits.length >= unlockedBudget) break;
    const started = LADDER.some((k) => cards[cardKey(word.id, k)]);
    if (!started) continue;
    for (const kind of unlockedKinds(word, cards, settings, ttsAvailable)) {
      if (cards[cardKey(word.id, kind)]) continue;
      const item = withCell({ type: 'card', word, kind, isNew: true }, settings);
      if (!item) continue;
      unlockedUnits.push([item]);
      break; // за раз открываем одному слову только одну новую ступень
    }
  }

  // 3. Совсем новые слова: знакомство + первая карточка.
  //    Порядок — по уровню CEFR: A1 целиком, потом A2. Внутри уровня — порядок
  //    словаря, то есть по темам: так слова приходят связанными пачками.
  const newBudget = Math.max(0, settings.newWordsPerDay - today.newWords);
  const newUnits: QueueItem[][] = [];
  const byLevel = [...words].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  for (const word of byLevel) {
    if (newUnits.length >= newBudget) break;
    const started = LADDER.some((k) => cards[cardKey(word.id, k)]);
    if (started) continue;
    const first = unlockedKinds(word, cards, settings, ttsAvailable)[0];
    if (!first) continue;
    const item = withCell({ type: 'card', word, kind: first, isNew: true }, settings);
    if (!item) continue;
    newUnits.push([{ type: 'intro', word }, item]);
  }

  const units = shuffle([...newUnits, ...unlockedUnits]);
  const items = interleave(due, units);

  return {
    items,
    dueCount: due.length,
    newWordCount: newUnits.length,
    unlockedCount: unlockedUnits.length,
    deferred,
  };
}

/**
 * Перемешивание блоками: новые слова распределяются по всей сессии, а не
 * стоят стеной в начале. Порядок внутри блока сохраняется — знакомство
 * всегда идёт перед своей карточкой.
 */
function interleave(reviews: QueueItem[], units: QueueItem[][]): QueueItem[] {
  if (!units.length) return reviews;
  if (!reviews.length) return units.flat();

  const gap = Math.max(1, Math.floor(reviews.length / (units.length + 1)));
  const out: QueueItem[] = [];
  let ri = 0;
  for (const unit of units) {
    for (let i = 0; i < gap && ri < reviews.length; i++) out.push(reviews[ri++]);
    out.push(...unit);
  }
  while (ri < reviews.length) out.push(reviews[ri++]);
  return out;
}

/** Дешёвый подсчёт для главного экрана — без сборки самой очереди. */
export function countPending(
  deck: Deck,
  progress: Progress,
  now: Date,
  ttsAvailable: boolean,
): PlanCounts {
  const plan = buildSession(deck, progress, now, ttsAvailable);
  return {
    due: plan.dueCount,
    newWords: plan.newWordCount,
    unlocked: plan.unlockedCount,
    total: plan.items.filter((i) => i.type === 'card').length,
  };
}

// ─── Упражнения ───────────────────────────────────────────────────────────

/**
 * Отвлекающие варианты для выбора из четырёх. Берём в первую очередь слова
 * той же части речи и темы: различать «стол» и «стул» полезнее,
 * чем «стол» и «понимать».
 */
export function distractors(word: Word, deck: Deck, count: number): Word[] {
  const pool = deck.words.filter((w) => w.id !== word.id && w.ru !== word.ru);
  const tiers = [
    pool.filter((w) => w.pos === word.pos && w.topic === word.topic),
    pool.filter((w) => w.pos === word.pos && w.topic !== word.topic),
    pool,
  ];
  const picked: Word[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    for (const w of shuffle(tier)) {
      if (picked.length >= count) break;
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      picked.push(w);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

export interface Cloze {
  before: string;
  /** Форма слова ровно как в предложении — её и ждём в ответе */
  hidden: string;
  after: string;
}

const LETTER = /[A-Za-z]/;

/**
 * Заменяет слово в примере на пропуск.
 *
 * В предложении слово стоит в какой-то форме, и по написанию она может не
 * иметь ничего общего со словарной: go → went. Поэтому сначала ищем точное
 * совпадение с любой известной формой слова, и только потом — по основе.
 * Знаки препинания остаются в видимой части: в пропуск должно попасть
 * одно слово, иначе непонятно, что от тебя хотят.
 */
export function clozeSentence(word: Word): Cloze | null {
  if (!word.example) return null;

  const known = new Set<string>();
  for (const value of [word.en, ...Object.values(word.forms ?? {})]) {
    for (const variant of formVariants(String(value))) known.add(normalizeLoose(variant));
  }
  const bare = normalizeLoose(word.en);
  const stem = bare.slice(0, Math.max(3, bare.length - 2));
  const tokens = word.example.split(/(\s+)/);

  const find = (match: (token: string) => boolean) => {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!LETTER.test(token)) continue;
      let start = 0;
      let end = token.length;
      while (start < end && !LETTER.test(token[start])) start++;
      while (end > start && !LETTER.test(token[end - 1])) end--;
      const core = token.slice(start, end);
      if (!match(normalizeLoose(core))) continue;
      return {
        before: tokens.slice(0, i).join('') + token.slice(0, start),
        hidden: core,
        after: token.slice(end) + tokens.slice(i + 1).join(''),
      };
    }
    return null;
  };

  return find((t) => known.has(t)) ?? find((t) => !!t && t.startsWith(stem));
}

/**
 * Что произносить. Слово как есть: артиклей и служебного «to» в данных нет,
 * и звучать должно ровно то, что написано, — иначе на карточке диктанта
 * ответ не сойдётся со звуком.
 */
export function spokenForm(word: Word): string {
  return word.en;
}

/**
 * Что ждём в поле ввода: основной вариант ответа.
 * Пропуск в предложении — ту форму, которая реально стоит в тексте:
 * подставлять словарную форму в готовую фразу бессмысленно.
 */
export function expectedAnswer(word: Word, kind: CardKind, cell?: FormKey): string {
  return mainForm(acceptedAnswers(word, kind, cell)[0]);
}

/**
 * Все ответы, которые считаются верными.
 *
 * У формы бывает два законных варианта (learned и learnt), и требовать
 * именно первый — придирка, а не проверка знания.
 */
export function acceptedAnswers(word: Word, kind: CardKind, cell?: FormKey): string[] {
  if (kind === 'cloze') {
    const c = clozeSentence(word);
    if (c) return [c.hidden];
  }
  if (kind === 'forms' && cell) {
    const value = word.forms?.[cell];
    if (value) return formVariants(value);
  }
  return [word.en];
}

/** Лучший из вердиктов по всем допустимым вариантам ответа. */
export function checkAnswer(
  input: string,
  word: Word,
  kind: CardKind,
  cell?: FormKey,
): 'exact' | 'close' | 'wrong' {
  let best: 'exact' | 'close' | 'wrong' = 'wrong';
  for (const variant of acceptedAnswers(word, kind, cell)) {
    const verdict = compareAnswer(input, variant);
    if (verdict === 'exact') return 'exact';
    if (verdict === 'close') best = 'close';
  }
  return best;
}
