import { useStore } from '../store/store';
import {
  ACTIVITY_LABELS,
  OBJECTIVE_LABELS,
  computeTargets,
  objectivePct,
  objectiveAdvice,
  DEFICIT_BOUNDS,
  SURPLUS_BOUNDS,
  DEFICIT_DEFAULT,
  SURPLUS_DEFAULT,
} from '../nutrition/targets';
import type { Activity, Objective, Sex, Profile } from '../nutrition/targets';
import { fmt } from './format';

/**
 * Profil (sexe, poids, activité) et objectif (perte / maintien / muscle) : les
 * entrées qui déterminent toutes les cibles quotidiennes de l'app. Vit en tête
 * de l'onglet « Profil & objectif », juste au-dessus des pesées qui alimentent
 * automatiquement le poids.
 */
export function ProfilePanel() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const hasWeighIn = useStore((s) => s.weightEntries.length > 0);

  const targets = computeTargets(profile);
  const kcalT = targets.find((t) => t.key === 'kcal')!;
  const protT = targets.find((t) => t.key === 'proteines')!;

  return (
    <div className="panel">
      <h2>Profil &amp; objectif</h2>
      <p className="small" style={{ marginTop: -6 }}>
        Sert à calculer vos cibles quotidiennes (AJR et « optimales »). Par défaut : homme sportif de 70 kg.
      </p>
      <div className="row wrap-form">
        <label className="field">
          Sexe
          <select value={profile.sexe} onChange={(e) => setProfile({ sexe: e.target.value as Sex })}>
            <option value="homme">Homme</option>
            <option value="femme">Femme</option>
          </select>
        </label>
        <label className="field">
          Poids (kg)
          <input
            value={profile.poids}
            onChange={(e) => setProfile({ poids: Math.max(1, parseFloat(e.target.value.replace(',', '.')) || 0) })}
            inputMode="decimal"
          />
        </label>
        <label className="field" style={{ flex: '1 1 200px' }}>
          Niveau d'activité
          <select value={profile.activite} onChange={(e) => setProfile({ activite: e.target.value as Activity })}>
            {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((a) => (
              <option key={a} value={a}>
                {ACTIVITY_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Objectif
          <select
            value={profile.objectif ?? 'maintien'}
            onChange={(e) => setProfile({ objectif: e.target.value as Objective })}
          >
            {(Object.keys(OBJECTIVE_LABELS) as Objective[]).map((o) => (
              <option key={o} value={o}>
                {OBJECTIVE_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ObjectiveIntensity profile={profile} setProfile={setProfile} />

      {hasWeighIn && (
        <div className="hint">
          Le poids est repris automatiquement de votre <strong>dernière pesée</strong> ci-dessous — inutile de le
          saisir ici, sauf pour corriger ponctuellement.
        </div>
      )}

      <div className="hint">
        Cibles optimales calculées : <strong>{fmt(kcalT.optimal)} kcal</strong> ·{' '}
        <strong>{fmt(protT.optimal)} g de protéines</strong> par jour (soit{' '}
        {fmt(protT.optimal / profile.poids, 1)} g/kg). Visibles en détail sur l'onglet « Aujourd'hui ».
      </div>
    </div>
  );
}

/**
 * Réglage de l'intensité du déficit (perte) ou du surplus (muscle), avec garde-fous.
 * Masqué en objectif « maintien ». Chacun peut s'ajuster s'il se connaît, sans
 * pouvoir sortir d'une fourchette raisonnable (bornes) et prévenu si l'intensité
 * devient agressive.
 */
function ObjectiveIntensity({
  profile,
  setProfile,
}: {
  profile: Profile;
  setProfile: (patch: Partial<Profile>) => void;
}) {
  const obj = profile.objectif ?? 'maintien';
  if (obj === 'maintien') return null;

  const isDeficit = obj === 'perte';
  const bounds = isDeficit ? DEFICIT_BOUNDS : SURPLUS_BOUNDS;
  const dflt = isDeficit ? DEFICIT_DEFAULT : SURPLUS_DEFAULT;
  const sign = isDeficit ? '−' : '+';
  const pct = objectivePct(profile);
  const advice = objectiveAdvice(profile);
  const setPct = (v: number) => setProfile(isDeficit ? { deficitPct: v } : { surplusPct: v });

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span className="small" style={{ color: 'var(--text)' }}>
          {isDeficit ? 'Intensité du déficit' : 'Intensité du surplus'} :{' '}
          <strong className="mono">{sign}{pct} %</strong> du maintien
        </span>
        {pct !== dflt && (
          <button className="ghost small" onClick={() => setPct(dflt)}>
            Revenir au conseillé ({sign}{dflt} %)
          </button>
        )}
      </div>
      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={pct}
        onChange={(e) => setPct(parseInt(e.target.value, 10))}
        style={{ width: '100%', marginTop: 6 }}
        aria-label={isDeficit ? 'Intensité du déficit calorique' : 'Intensité du surplus calorique'}
      />
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span>doux · {bounds.min} %</span>
        <span>marqué · {bounds.max} %</span>
      </div>
      {advice && (
        <div className="hint" style={advice.warn ? { color: 'var(--warn)' } : undefined}>
          {advice.warn ? '⚠️ ' : '💡 '}
          {advice.text}
        </div>
      )}
    </div>
  );
}
