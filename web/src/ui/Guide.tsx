import { useMemo } from 'react';
import { useStore, dayTotals, todayStr } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import type { Target } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import { fmt } from './format';

const STATUS_COLOR: Record<string, string> = {
  good: 'var(--accent-2)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  na: 'var(--muted)',
};

/**
 * Onglet Guide : explique la différence AJR / optimal, détaille les rapports
 * optimaux (avec la valeur du jour), puis liste chaque nutriment avec son rôle
 * dans le corps et la justification de sa cible.
 */
export function Guide() {
  const profile = useStore((s) => s.profile);
  const entries = useStore((s) => s.entries);
  const today = todayStr();
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const totals = useMemo(() => dayTotals(entries, today), [entries, today]);
  const ratios = useMemo(() => computeRatios(totals), [totals]);

  return (
    <>
      <div className="panel">
        <h2>Comprendre AJR &amp; optimal</h2>
        <p>
          Deux repères accompagnent chaque nutriment. L'<strong>AJR</strong> (apport journalier de référence,
          d'après les valeurs européennes et l'ANSES) est le seuil à couvrir pour éviter une carence.
          L'<strong>optimal</strong> est une cible « santé / sport » : souvent plus <em>haute</em> que l'AJR
          (récupération, immunité, performance), mais parfois c'est l'inverse.
        </p>
        <ul className="guide-list">
          <li>
            <strong>Viser haut</strong> — la plupart des vitamines et minéraux : on veut atteindre voire dépasser
            l'AJR jusqu'à la cible optimale (ex. vitamine D, C, magnésium, protéines).
          </li>
          <li>
            <strong>Viser bas</strong> — quelques nutriments où l'excès nuit : l'optimal est <em>le plus bas
            possible</em>, l'AJR devient un plafond à ne pas dépasser (sodium, AG saturés).
          </li>
          <li>
            <strong>Viser juste (rapports)</strong> — pour certains couples de nutriments, c'est l'équilibre qui
            compte, pas la quantité absolue (oméga-6/3, potassium/sodium, calcium/magnésium).
          </li>
        </ul>
      </div>

      <div className="panel">
        <h2>Rapports optimaux</h2>
        <p className="small" style={{ marginTop: -6 }}>
          La valeur affichée est celle d'aujourd'hui. Ce sont souvent ces équilibres, plus que les quantités,
          qui pilotent l'inflammation, la tension et la santé osseuse.
        </p>
        {ratios.map((r) => (
          <RatioCard key={r.def.key} r={r} />
        ))}
      </div>

      <div className="panel">
        <h2>Rôle de chaque nutriment</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Cibles calculées pour votre profil ({profile.sexe}, {fmt(profile.poids)} kg).
        </p>
        {targets.map((t) => (
          <NutrientCard key={t.key} t={t} />
        ))}
      </div>
    </>
  );
}

function RatioCard({ r }: { r: RatioResult }) {
  const dir =
    r.def.better === 'higher'
      ? `idéal ≥ ${fmt(r.def.optimal)}${r.def.suffix}`
      : r.def.better === 'lower'
        ? `idéal ≤ ${fmt(r.def.optimal)}${r.def.suffix}`
        : `idéal ≈ ${fmt(r.def.optimal)}${r.def.suffix}`;
  return (
    <div className="guide-item">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>{r.def.label}</strong>
        <span className="mono" style={{ color: STATUS_COLOR[r.status] }}>
          {r.text} <span className="small" style={{ color: 'var(--muted)' }}>· {dir}</span>
        </span>
      </div>
      <div className="small" style={{ marginTop: 4 }}>{r.def.role}</div>
      <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{r.def.note}</div>
    </div>
  );
}

function NutrientCard({ t }: { t: Target }) {
  const cible =
    t.goal === 'limit'
      ? `Idéal ≤ ${fmt(t.optimal)} ${t.unit} · plafond ${fmt(t.ajr)} ${t.unit}`
      : t.optimal !== t.ajr
        ? `AJR ${fmt(t.ajr)} ${t.unit} → optimal ${fmt(t.optimal)} ${t.unit}`
        : `AJR ${fmt(t.ajr)} ${t.unit}`;
  return (
    <div className="guide-item">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <strong>{t.label}</strong>
        <span className="small mono" style={{ color: t.goal === 'limit' ? 'var(--warn)' : 'var(--text)' }}>
          {cible}
        </span>
      </div>
      <div className="small" style={{ marginTop: 4 }}>{t.role}</div>
      {t.optimalNote && (
        <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>{t.optimalNote}</div>
      )}
    </div>
  );
}
