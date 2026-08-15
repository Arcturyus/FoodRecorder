import { useEffect } from 'react';
import { useQueueStatus, pendingTotal, type PendingCounts } from '../sync/queueStatus';
import type { SyncKind } from '../sync/supabase';

/**
 * Bandeau « où en est la file » en tête de l'onglet du jour.
 *
 * Deux points de vue selon l'appareil : celui qui a le pont Claude Code (l'ordinateur en
 * `npm run dev`) annonce ce que le CLI est en train d'analyser et son rang dans le lot ;
 * les autres (téléphone) ne peuvent qu'annoncer l'attente — ils n'ont aucun moyen de savoir
 * si l'ordinateur mouline ou s'il est éteint, et le bandeau ne le prétend donc pas.
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

export function QueueStatus() {
  const pending = useQueueStatus((s) => s.pending);
  const current = useQueueStatus((s) => s.current);
  const hasBridge = useQueueStatus((s) => s.hasBridge);
  const done = useQueueStatus((s) => s.done);
  const failures = useQueueStatus((s) => s.failures);
  const reset = useQueueStatus((s) => s.reset);

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

  return (
    <div className={`queue-status${busy ? ' busy' : ''}`} role="status">
      <span className="queue-status-main">
        <span className="queue-status-icon">{busy ? '⏳' : '✅'}</span> {message}
      </span>

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
