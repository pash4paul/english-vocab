export type Pos =
  | 'noun' | 'verb' | 'adj' | 'adv' | 'phrase' | 'prep' | 'pron' | 'num'
  | 'conj' | 'det' | 'exclam' | 'modal' | 'article' | 'other';

/** Уровень CEFR из списка Oxford: с него берётся порядок изучения. */
export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/**
 * Формы слова, которые имеет смысл спрашивать.
 *
 * `third` и `ing` выводятся правилом почти всегда и почти всегда очевидны,
 * поэтому по умолчанию не спрашиваются — но остаются доступны в настройках.
 */
export type FormKey =
  | 'plural' | 'third' | 'ing' | 'past' | 'participle' | 'comparative' | 'superlative';

export const FORM_KEYS: FormKey[] =
  ['plural', 'third', 'ing', 'past', 'participle', 'comparative', 'superlative'];

export const FORM_LABEL: Record<FormKey, string> = {
  plural: 'множественное число',
  third: 'he/she/it',
  ing: 'форма на -ing',
  past: 'прошедшее время',
  participle: 'причастие, третья форма',
  comparative: 'сравнительная степень',
  superlative: 'превосходная степень',
};

export const FORM_SHORT: Record<FormKey, string> = {
  plural: 'мн. ч.', third: '-s', ing: '-ing', past: 'past',
  participle: 'p. p.', comparative: '-er', superlative: '-est',
};

/**
 * Формы слова. Значение может содержать несколько допустимых вариантов через
 * «|»: «learned|learnt» показывает learned, а learnt в ответе тоже принимает.
 */
export type WordForms = Partial<Record<FormKey, string>>;

export interface Word {
  id: string;
  en: string;
  ru: string;
  pos: Pos;
  level: Level;
  forms?: WordForms;
  /** Формы не подчиняются правилам — заданы вручную или взяты из таблицы */
  irregular?: boolean;
  /** Неисчисляемое: множественного числа нет (water, money, advice) */
  uncountable?: boolean;
  /** false — степеней сравнения не бывает (main, only, married) */
  gradable?: boolean;
  example?: string;
  exampleRu?: string;
  note?: string;
  topic: string;
  lesson?: string;
  tags: string[];
}

export interface Deck {
  version: number;
  builtFrom: string[];
  topics: string[];
  levels: Level[];
  words: Word[];
}

/** Направления, в которых слово может проверяться. Каждое живёт своим графиком. */
export type CardKind = 'recognize' | 'listen' | 'spell' | 'produce' | 'cloze' | 'forms';

export const CARD_KINDS: CardKind[] =
  ['recognize', 'listen', 'spell', 'produce', 'cloze', 'forms'];

export const KIND_LABEL: Record<CardKind, string> = {
  recognize: 'Узнавание EN→RU',
  listen: 'Аудирование',
  spell: 'Диктант: услышал — записал',
  produce: 'Ввод RU→EN',
  cloze: 'Пропуск в предложении',
  forms: 'Формы слова',
};

export const KIND_SHORT: Record<CardKind, string> = {
  recognize: 'EN→RU',
  listen: '🔊',
  spell: '🔊✎',
  produce: 'RU→EN',
  cloze: '␣',
  forms: 'форм.',
};

/** Состояние FSRS-карточки в сериализуемом виде (даты — ISO-строки). */
export interface StoredCard {
  wordId: string;
  kind: CardKind;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  /** 0 New · 1 Learning · 2 Review · 3 Relearning */
  state: number;
  last_review?: string;
}

export interface ReviewEntry {
  /** ISO-время ответа */
  at: string;
  wordId: string;
  kind: CardKind;
  rating: number;
  /** миллисекунды на ответ */
  ms: number;
  /** Первое в жизни предъявление карточки — не участвует в подсчёте удержания */
  first?: boolean;
}

export interface DayStats {
  newWords: number;
  unlocked: number;
  reviewed: number;
  correct: number;
}

export interface Settings {
  newWordsPerDay: number;
  /** 0 — без ограничения */
  maxReviewsPerDay: number;
  enabledKinds: CardKind[];
  /** Какие формы спрашивает упражнение на формы слова */
  enabledForms: FormKey[];
  /** true — британское написание и лишнее «to» считаются ошибкой */
  strictSpelling: boolean;
  ttsRate: number;
  autoPlayAudio: boolean;
  /** пустой массив — все темы */
  enabledTopics: string[];
  /** пустой массив — все уровни */
  enabledLevels: Level[];
  requestRetention: number;
}

export interface Progress {
  version: number;
  cards: Record<string, StoredCard>;
  reviews: ReviewEntry[];
  days: Record<string, DayStats>;
  settings: Settings;
  /** ISO-дата последней сессии — для стрика */
  lastStudied?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  newWordsPerDay: 8,
  maxReviewsPerDay: 0,
  enabledKinds: ['recognize', 'listen', 'spell', 'produce', 'cloze', 'forms'],
  // -s и -ing выводятся правилом и почти никогда не вызывают сомнений;
  // время стоит тратить на прошедшее, причастие и множественное.
  enabledForms: ['plural', 'past', 'participle', 'comparative', 'superlative'],
  strictSpelling: false,
  ttsRate: 0.9,
  autoPlayAudio: true,
  enabledTopics: [],
  enabledLevels: [],
  requestRetention: 0.9,
};

export const cardKey = (wordId: string, kind: CardKind) => `${wordId}|${kind}`;
