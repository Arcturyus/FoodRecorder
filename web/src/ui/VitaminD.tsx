import { vitaminDFlux, VITD_LOW, VITD_OK } from '../sun/vitaminDStatus';
import { HoverCard } from './HoverCard';
import { Section } from './Section';
import { fmt } from './format';

/**
 * Carence vitamine D : flux moyen d'entrée (alimentation + soleil), lissé sur
 * ~4 semaines et pondéré par la récence — cohérent avec la demi-vie de la
 * 25(OH)D (~2–3 semaines). Déplacé de l'onglet Stats vers Nutriments, où il
 * alimente la décision « supplément D ou pas ».
 */
export function VitaminDPanel({ status }: { status: ReturnType<typeof vitaminDFlux> }) {
  // Replié, le panneau doit répondre à la question de son titre : « carence ? ».
  // Un titre seul obligerait à déplier pour l'apprendre.
  const summary = status
    ? `${fmt(status.weightedAvg, 1)} µg/j · ${status.zone === 'ok' ? 'suffisant' : status.zone === 'low' ? 'carence' : 'limite'}`
    : 'pas encore de données';
  return (
    <Section id="nutriments-vitd" title="☀️ Vitamine D : carence ?" summary={summary}>
      <p className="small" style={{ marginTop: -6 }}>
        Flux moyen d'entrée (alimentation + soleil), lissé sur ~4 semaines et pondéré par la récence — cohérent avec
        la demi-vie de la 25(OH)D (~2–3 semaines).
      </p>
      <VitaminDCard status={status} />
    </Section>
  );
}

function VitaminDCard({ status }: { status: ReturnType<typeof vitaminDFlux> }) {
  if (!status) {
    return <div className="empty">Enregistrez des repas ou des expositions au soleil pour estimer votre flux de vitamine D.</div>;
  }

  const zoneClass = status.zone === 'ok' ? 'ok' : status.zone === 'low' ? 'low' : 'mid';
  const arrow = status.trend === 'up' ? '↑' : status.trend === 'down' ? '↓' : '→';
  const trendWord = status.trend === 'up' ? 'en hausse' : status.trend === 'down' ? 'en baisse' : 'stable';
  const weeks = Math.round(status.windowDays / 7);
  // Repère sur l'échelle 0 → ~25 µg (au-delà = confortable).
  const markPct = Math.min(100, (status.weightedAvg / 25) * 100);

  return (
    <>
      <div className="vitd-card">
        <div>
          <span className="vitd-big" style={{ color: `var(--${status.zone === 'ok' ? 'accent-2' : status.zone === 'low' ? 'danger' : 'warn'})` }}>
            {fmt(status.weightedAvg, 1)}
          </span>
          <span className="small"> µg/j</span>
          <div className="small" style={{ marginTop: 2 }}>
            {arrow} {trendWord} sur {weeks} semaines · {status.nDays} jour(s) de données
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="vitd-scale">
            <i style={{ left: `${markPct}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">carence &lt; {VITD_LOW}</span>
            <span className="small">suffisant ≥ {VITD_OK} µg</span>
          </div>
        </div>
        <HoverCard
          align="right"
          card={
            <div style={{ maxWidth: 250 }}>
              <strong>Comment lire ce statut</strong>
              <div className="hc-zones">
                <div className={status.zone === 'low' ? 'on' : ''}><i className="z low" /> &lt; {VITD_LOW} µg/j — risque de carence</div>
                <div className={status.zone === 'mid' ? 'on' : ''}><i className="z mid" /> {VITD_LOW}–{VITD_OK} µg/j — zone intermédiaire</div>
                <div className={status.zone === 'ok' ? 'on' : ''}><i className="z ok" /> ≥ {VITD_OK} µg/j — apport suffisant</div>
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                Moyenne pondérée sur {Math.round(status.windowDays / 7)} semaines ({status.nDays} jour(s) de données).
                Le lissage long (demi-vie ~3 semaines) évite les sauts de statut d'un jour à l'autre.
              </div>
            </div>
          }
        >
          <span className={`vitd-status ${zoneClass}`}>{status.statusLabel}</span>
        </HoverCard>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        <strong>
          {fmt(status.weightedAvg, 1)} µg/j ({arrow} {trendWord}) → {status.statusLabel}
        </strong>
        <br />
        {status.advice}
      </div>
    </>
  );
}
