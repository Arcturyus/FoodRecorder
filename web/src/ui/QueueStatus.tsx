import { useEffect, useState } from 'react';
import { todayStr } from '../store/store';
import { useQueueStatus, pendingTotal, type PendingCounts } from '../sync/queueStatus';
import type { PendingItem, SyncKind } from '../sync/supabase';

/**
 * Bandeau « où en est la file » en tête de l'onglet du jour.
 *
 * Deux points de vue selon l'appareil : celui qui a le pont Claude Code (l'ordinateur en
 * `npm run dev`) annonce ce que le CLI est en train d'analyser et son rang dans le lot ;
 * les autres (téléphone) ne peuvent qu'annoncer l'attente — ils n'ont aucun moyen de savoir
 * si l'ordinateur mouline ou s'il est éteint, et le bandeau ne le prétend donc pas.
 *
 * Un clic déplie le détail de ce qui attend (texte dicté, heure d'envoi) : « 1 dictée en
 * attente » ne dit pas LAQUELLE, et c'est justement la question qu'on se pose quand ça
 * traîne. Clic plutôt que survol seul, car l'appareil qui attend le plus est le téléphone.
 *
 * Le bilan (traitées / échecs) est celui de la visite en cours : `reset` au montage, donc
 * quitter l'onglet et y revenir repart de zéro.
 */

/** Singulier / pluriel affichés par kind de la file. */
const KIND_LABEL: Record<SyncKind, [string, string]> = {
  transcript: ['dictée', 'dictées'],
  image: ['photo', 'photos'],
  sun: ['dictée soleil', 'dictées soleil'],
  weight: ['pesée', 'pesées'],
};

const KIND_ORDER: SyncKind[] = ['image', 'transcript', 'sun', 'weight'];

function plural(n: number, [one, many]: [string, string]): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** « 2 photos et 1 dictée », dans l'ordre où l'utilisateur les remarque. */
function describePending(counts: PendingCounts): string {
  const parts = KIND_ORDER.filter((k) => counts[k] > 0).map((k) => plural(counts[k], KIND_LABEL[k]));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}`;
}

/** « aujourd'hui 12:34 », ou « ven. 15/08 12:34 » pour un envoi plus ancien. */
function formatSentAt(ms: number): string {
  const d = new Date(ms);
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const jour =
    todayStr(d) === todayStr()
      ? "aujourd'hui"
      : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${jour} ${heure}`;
}

/**
 * Ligne de détail : ce qui attend, dit avec les mots de l'émetteur. Le jour visé n'est
 * rappelé que s'il diffère du jour d'envoi (dictée d'hier saisie ce matin), sans quoi il
 * répéterait l'heure d'envoi.
 */
function PendingLine({ item }: { item: PendingItem }) {
  const decale = item.date && item.date !== todayStr(new Date(item.sentAt));
  return (
    <li>
      <span className="queue-status-detail-head">
        {KIND_LABEL[item.kind][0]} · {formatSentAt(item.sentAt)}
        {decale && ` · pour le ${item.date}`}
      </span>
      {item.transcript && <span className="queue-status-detail-text">« {item.transcript} »</span>}
    </li>
  );
}

export function QueueStatus() {
  const pending = useQueueStatus((s) => s.pending);
  const pendingItems = useQueueStatus((s) => s.pendingItems);
  const current = useQueueStatus((s) => s.current);
  const hasBridge = useQueueStatus((s) => s.hasBridge);
  const done = useQueueStatus((s) => s.done);
  const failures = useQueueStatus((s) => s.failures);
  const reset = useQueueStatus((s) => s.reset);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    reset();
  }, [reset]);

  const waiting = pendingTotal(pending);
  // Rien à dire : ni attente, ni bilan à montrer. Le bandeau disparaît complètement
  // plutôt que d'occuper une ligne pour annoncer qu'il ne se passe rien.
  if (waiting === 0 && done === 0 && failures.length === 0) return null;

  let message: string;
  if (current) {
    const [nom] = KIND_LABEL[current.kind];
    message = `Claude Code analyse la ${nom} (${current.index}/${current.total})…`;
  } else if (waiting > 0) {
    message = hasBridge
      ? `${describePending(pending)} à analyser.`
      : `${describePending(pending)} en attente de traitement par l'ordinateur.`;
  } else {
    message = 'Tout est traité.';
  }

  const busy = current !== null || waiting > 0;
  // Rien à déplier tant qu'aucune ligne n'attend : le bandeau reste alors un simple texte,
  // sans affordance de clic qui n'ouvrirait rien.
  const depliable = pendingItems.length > 0;

  const contenu = (
    <>
      <span className="queue-status-icon">{busy ? '⏳' : '✅'}</span>
      <span className="queue-status-text">{message}</span>
      {depliable && <span className="queue-status-chevron">{open ? '▾' : '▸'}</span>}
    </>
  );

  return (
    <div className={`queue-status${busy ? ' busy' : ''}`} role="status">
      {depliable ? (
        <button type="button" className="queue-status-main" aria-expanded={open} onClick={() => setOpen(!open)}>
          {contenu}
        </button>
      ) : (
        <span className="queue-status-main">{contenu}</span>
      )}

      {open && depliable && (
        <ul className="queue-status-detail">
          {pendingItems.map((it) => (
            <PendingLine key={it.id} item={it} />
          ))}
        </ul>
      )}

      {(done > 0 || failures.length > 0) && (
        <span className="queue-status-tally">
          {done > 0 && plural(done, ['traitée', 'traitées'])}
          {done > 0 && failures.length > 0 && ' · '}
          {failures.length > 0 && (
            <span className="queue-status-failed">{plural(failures.length, ['échec', 'échecs'])}</span>
          )}
        </span>
      )}

      {failures.length > 0 && (
        <ul className="queue-status-fails">
          {failures.map((f, i) => (
            <li key={i}>
              {KIND_LABEL[f.kind][0]} : {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
