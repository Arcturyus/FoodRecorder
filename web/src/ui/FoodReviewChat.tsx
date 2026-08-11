/**
 * Discussion avec l'IA sur la fiche d'un aliment de la banque.
 *
 * Vit dans le formulaire d'édition : ce qu'on applique ne va PAS directement en
 * base, ça remplit les champs du formulaire. L'utilisateur voit le diff, puis
 * enregistre lui-même — une correction d'aliment se répercute rétroactivement
 * sur tout l'historique, elle ne doit pas se produire sur un simple clic dans un
 * fil de discussion.
 */

import { useState } from 'react';
import { useStore } from '../store/store';
import type { Food } from '../nutrition/types';
import { reviewFood, ficheDiff } from '../extraction/foodReview';
import type { ReviewFiche, ReviewTurn, ReviewUsage } from '../extraction/foodReview';
import { fmt } from './format';
import { useBankUsage } from './useBankUsage';

/** Décimales utiles selon l'ordre de grandeur (0,0004 µg de B12 ne doit pas s'afficher « 0 »). */
function val(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 10) return fmt(v);
  if (Math.abs(v) >= 0.1) return fmt(v, 2);
  return fmt(v, 4);
}

export function FoodReviewChat({ food, onApply }: { food: Food; onApply: (fiche: ReviewFiche) => void }) {
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const entries = useStore((s) => s.entries);
  const usage = useBankUsage().get(food.id);

  const [turns, setTurns] = useState<ReviewTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const strongAi = extractionMode === 'cloud' || extractionMode === 'claudecode';

  /** Portion moyenne réellement mangée : l'IA juge mieux avec cet indice. */
  const reviewUsage: ReviewUsage | undefined = usage
    ? (() => {
        const grams = entries.flatMap((e) => e.items).filter((it) => it.foodId === food.id).map((it) => it.grams);
        const moyenne = grams.length ? grams.reduce((a, g) => a + g, 0) / grams.length : 0;
        return { jours: usage.jours, occurrences: usage.occurrences, grammesMoyens: moyenne };
      })()
    : undefined;

  async function send(message?: string) {
    setBusy(true);
    setError('');
    const history = message ? [...turns, { role: 'user' as const, text: message }] : turns;
    if (message) setTurns(history);
    try {
      const reply = await reviewFood(food, reviewUsage, history, extractionMode, cloudApiKey, cloudModel);
      setTurns([...history, reply]);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de la relecture.');
      // On retire la question restée sans réponse, sinon elle repartirait au tour suivant.
      if (message) setTurns(turns);
    } finally {
      setBusy(false);
    }
  }

  if (!strongAi) {
    return (
      <div className="hint" style={{ marginTop: 10 }}>
        La relecture par IA demande le mode « API Claude » ou « Claude Code » — voir Réglages.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      {turns.length === 0 ? (
        <button className="ghost small" disabled={busy} onClick={() => send()}>
          {busy ? '…' : '🤖 Demander à l’IA de revoir ces valeurs'}
        </button>
      ) : (
        <div className="small" style={{ color: 'var(--muted)', marginBottom: 6 }}>
          Relecture de « {food.nom} »
        </div>
      )}

      {turns.map((t, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div className="small" style={{ color: 'var(--muted)' }}>{t.role === 'user' ? 'Vous' : 'IA'}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
          {t.fiche && <DiffTable food={food} fiche={t.fiche} onApply={() => onApply(t.fiche!)} />}
          {t.role === 'assistant' && !t.fiche && (
            <div className="small" style={{ color: 'var(--muted)' }}>Aucun changement proposé.</div>
          )}
        </div>
      ))}

      {turns.length > 0 && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <label className="field" style={{ flex: 1 }}>
            Votre remarque
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ex. « les miennes sont à l’huile », « je pensais qu’il y avait plus de protéines »"
              onKeyDown={(e) => e.key === 'Enter' && draft.trim() && !busy && send(draft.trim())}
            />
          </label>
          <button className="ghost small" disabled={busy || !draft.trim()} onClick={() => send(draft.trim())}>
            {busy ? '…' : 'Envoyer'}
          </button>
        </div>
      )}

      {error && <div className="status" style={{ marginTop: 8, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}

/** Tableau avant/après : seuls les nutriments qui bougent réellement. */
function DiffTable({ food, fiche, onApply }: { food: Food; fiche: ReviewFiche; onApply: () => void }) {
  const diff = ficheDiff(food, fiche);
  const changeCat = fiche.categorie && fiche.categorie !== food.categorie ? fiche.categorie : null;
  const changePiece =
    fiche.grammesParPiece && fiche.grammesParPiece !== food.pieceGrams ? fiche.grammesParPiece : null;

  if (diff.length === 0 && !changeCat && !changePiece) {
    return <div className="small" style={{ color: 'var(--muted)' }}>Fiche identique aux valeurs actuelles.</div>;
  }

  return (
    <div style={{ marginTop: 8 }}>
      {changeCat && (
        <div className="small">
          Catégorie : <span className="mono">{food.categorie}</span> → <span className="mono">{changeCat}</span>
        </div>
      )}
      {changePiece && (
        <div className="small">
          Poids d'une pièce : <span className="mono">{food.pieceGrams ?? '—'} g</span> →{' '}
          <span className="mono">{changePiece} g</span>
        </div>
      )}
      {diff.map((d) => (
        <div className="small" key={d.key}>
          {d.label} : <span className="mono">{val(d.avant)}</span> →{' '}
          <span className="mono" style={{ color: d.apres > d.avant ? 'var(--good)' : 'var(--warn)' }}>
            {val(d.apres)}
          </span>
        </div>
      ))}
      <button className="ghost small" style={{ marginTop: 6 }} onClick={onApply}>
        ↧ Reporter dans le formulaire
      </button>
    </div>
  );
}
