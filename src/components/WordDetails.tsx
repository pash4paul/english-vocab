import type { Word } from '../types.ts';
import { FORM_KEYS, FORM_SHORT } from '../types.ts';
import { speak, ttsAvailable } from '../lib/tts.ts';
import { mainForm, spokenForm } from '../lib/session.ts';

/**
 * Таблица форм. В свёрнутом виде показывает только те формы, которые
 * отличаются от самого слова: у правильного глагола причастие равно
 * прошедшему, у put совпадают все три, и печатать их второй раз — лишний шум.
 */
function FormsTable({ word, compact }: { word: Word; compact: boolean }) {
  const forms = word.forms;
  if (!forms) return null;
  const base = word.en.toLowerCase();

  const rows = FORM_KEYS.filter((k) => {
    const value = forms[k];
    if (!value) return false;
    if (!compact) return true;
    return mainForm(value).toLowerCase() !== base;
  });
  if (!rows.length) return null;

  return (
    <table className="forms-table">
      <tbody>
        {rows.map((k) => (
          <tr key={k}>
            <td className="form-label">{FORM_SHORT[k]}</td>
            <td className="word-sm">{variants(forms[k]!)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** «learned|learnt» → «learned · learnt»: оба варианта верны. */
function variants(value: string): string {
  return value.split('|').map((v) => v.trim()).join(' · ');
}

const POS_LABEL: Record<string, string> = {
  noun: 'сущ.', verb: 'глаг.', adj: 'прил.', adv: 'нареч.',
  phrase: 'фраза', prep: 'предлог', pron: 'мест.', num: 'числ.',
  conj: 'союз', det: 'опред.', exclam: 'воскл.', modal: 'модальный',
  article: 'артикль', other: '',
};

/** Оборот карточки: всё, что стоит увидеть после ответа. */
export function WordDetails({
  word, rate, expanded = false,
}: { word: Word; rate: number; expanded?: boolean }) {
  const gradable = word.pos === 'adj' && word.gradable === false;
  return (
    <div className="details">
      <div className="details-head">
        <span className="pos">{POS_LABEL[word.pos]}</span>
        <span className="level-chip">{word.level}</span>
        {word.irregular && <span className="irregular-chip">неправильное</span>}
        {word.uncountable && <span className="irregular-chip">неисчисляемое</span>}
        <span className="topic-chip">{word.topic}</span>
        {ttsAvailable() && (
          <button className="icon-btn" onClick={() => speak(spokenForm(word), rate)} aria-label="Прослушать">
            🔊
          </button>
        )}
      </div>

      {word.note && <p className="note">{word.note}</p>}

      <FormsTable word={word} compact={!expanded} />

      {gradable && expanded && (
        <p className="muted small">Степени сравнения — через more / most.</p>
      )}

      {word.example && (
        <blockquote className="example">
          <span className="word-sm">{word.example}</span>
          {word.exampleRu && <em>{word.exampleRu}</em>}
        </blockquote>
      )}
    </div>
  );
}
