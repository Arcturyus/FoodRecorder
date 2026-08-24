import { useStore } from '../store/store';
import {
  OBJECTIVE_LABELS,
  objectivePct,
  objectiveAdvice,
  energySettings,
  protConseilParKg,
  protParKgEffectif,
  DEFICIT_BOUNDS,
  SURPLUS_BOUNDS,
  DEFICIT_DEFAULT,
  SURPLUS_DEFAULT,
} from '../nutrition/targets';
import type { Objective, Sex, Profile } from '../nutrition/targets';
import {
  POSTURE_LABELS,
  STEP_PRESETS,
  SPORT_LABELS,
  PROT_BOUNDS,
  protAdvice,
} from '../nutrition/energy';
import type { SportType, WorkPosture } from '../nutrition/energy';
import { NumberField } from './NumberField';
import { useTargets } from './useTargets';
import { fmt } from './format';
import { Section } from './Section';

/**
 * Réglages qui déterminent toutes les cibles quotidiennes. L'activité y est
 * découpée en deux postes indépendants — ce qu'on bouge dans la journée (pas,
 * posture) et ce qu'on fait à l'entraînement — parce que les deux ne vont pas
 * ensemble : on peut enchaîner six heures de musculation par semaine et marcher
 * très peu. Le résultat chiffré est affiché juste en dessous, dans `EnergyPanel`.
 */
export function ProfilePanel() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const weightConfig = useStore((s) => s.weightConfig);
  const setWeightConfig = useStore((s) => s.setWeightConfig);
  const hasWeighIn = useStore((s) => s.weightEntries.length > 0);

  const targets = useTargets();
  const protT = targets.find((t) => t.key === 'proteines')!;
  const settings = energySettings(profile);

  return (
    <Section
      id="profil"
      title="Profil & objectif"
      defaultOpen={false}
      summary={`${fmt(profile.poids, 1)} kg · ${OBJECTIVE_LABELS[profile.objectif ?? 'maintien'].toLowerCase()} · ${fmt(protT.optimal)} g de protéines/j`}
    >
      <p className="small" style={{ marginTop: -6 }}>
        Le corps, la façon de bouger, l'objectif. Tout ce qui suit alimente les cibles quotidiennes de l'app.
      </p>

      <h3 className="section-title">Corps</h3>
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
        <label className="field">
          Taille (cm)
          <NumberField
            value={Math.round(weightConfig.taille * 100)}
            onChange={(v) => {
              const cm = parseFloat(v.replace(',', '.'));
              if (Number.isFinite(cm) && cm > 0) setWeightConfig({ taille: cm / 100 });
            }}
            min={120}
            max={230}
            step={1}
          />
        </label>
        <label className="field">
          Âge
          <NumberField
            value={weightConfig.age}
            onChange={(v) => {
              const a = parseInt(v, 10);
              if (Number.isFinite(a) && a > 0) setWeightConfig({ age: a });
            }}
            min={10}
            max={100}
            step={1}
            inputMode="numeric"
          />
        </label>
        <label className="field">
          Masse grasse (%)
          <NumberField
            value={profile.masseGrassePct ?? ''}
            onChange={(v) => {
              const raw = v.trim();
              if (raw === '') {
                setProfile({ masseGrassePct: undefined });
                return;
              }
              const p = parseFloat(raw.replace(',', '.'));
              if (Number.isFinite(p)) setProfile({ masseGrassePct: Math.min(69, Math.max(1, p)) });
            }}
            min={3}
            max={60}
            step={0.5}
            placeholder="pesée"
          />
        </label>
      </div>
      <div className="hint">
        Taille et âge servent aux formules de métabolisme (ce sont les mêmes constantes que dans les pesées).
        La case masse grasse est facultative : laissée vide, l'app reprend celle de votre{' '}
        {hasWeighIn ? 'dernière pesée' : 'prochaine pesée'} — la remplir permet de tester une valeur.
      </div>

      <h3 className="section-title">Activité quotidienne (hors sport)</h3>
      <div className="row wrap-form">
        <label className="field">
          Pas par jour
          <NumberField
            value={settings.pasParJour}
            onChange={(v) => {
              const p = parseInt(v.replace(/\s/g, ''), 10);
              if (Number.isFinite(p)) setProfile({ pasParJour: Math.min(40000, Math.max(0, p)) });
            }}
            min={0}
            max={40000}
            step={500}
            inputMode="numeric"
          />
        </label>
        <label className="field" style={{ flex: '1 1 240px' }}>
          Posture dans la journée
          <select
            value={settings.posture}
            onChange={(e) => setProfile({ posture: e.target.value as WorkPosture })}
          >
            {(Object.keys(POSTURE_LABELS) as WorkPosture[]).map((p) => (
              <option key={p} value={p}>
                {POSTURE_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        {STEP_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`small ${settings.pasParJour === p.pas ? 'chip-active' : 'ghost'}`}
            onClick={() => setProfile({ pasParJour: p.pas })}
            data-tip={`${p.hint} → ${fmt(p.pas)} pas/jour`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="hint">
        Deux choses différentes : les pas comptent les déplacements, la posture compte le fait de tenir debout
        sans marcher. Les repères ci-dessus ne font que remplir le champ — un podomètre reste plus juste.
      </div>

      <h3 className="section-title">Sport</h3>
      <div className="row wrap-form">
        <label className="field">
          Heures par semaine
          <NumberField
            value={settings.sportHeures}
            onChange={(v) => {
              const h = parseFloat(v.replace(',', '.'));
              if (Number.isFinite(h)) setProfile({ sportHeures: Math.min(30, Math.max(0, h)) });
            }}
            min={0}
            max={30}
            step={0.5}
          />
        </label>
        <label className="field" style={{ flex: '1 1 240px' }}>
          Type dominant
          <select value={settings.sportType} onChange={(e) => setProfile({ sportType: e.target.value as SportType })}>
            {(Object.keys(SPORT_LABELS) as SportType[]).map((t) => (
              <option key={t} value={t}>
                {SPORT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="hint">
        Volume total, lissé sur les sept jours. Le type sert deux fois : une heure de cardio coûte plus de
        calories qu'une heure de musculation (temps de repos compris), mais c'est la musculation qui tire les
        protéines vers le haut.
      </div>

      <h3 className="section-title">Objectif</h3>
      <div className="row wrap-form">
        <label className="field" style={{ flex: '1 1 200px' }}>
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

      <ProteinSetting profile={profile} setProfile={setProfile} protCible={protT.optimal} />

      {hasWeighIn && (
        <div className="hint">
          Le poids est repris automatiquement de votre <strong>dernière pesée</strong> ci-dessous — inutile de le
          saisir ici, sauf pour corriger ponctuellement.
        </div>
      )}
    </Section>
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

/**
 * Protéines : l'app calcule un conseil à partir du volume d'entraînement et de
 * l'objectif, mais le dernier mot revient à l'utilisateur — d'où un curseur libre
 * de 0,8 à 3 g/kg, commenté à chaque position plutôt que bloqué.
 */
function ProteinSetting({
  profile,
  setProfile,
  protCible,
}: {
  profile: Profile;
  setProfile: (patch: Partial<Profile>) => void;
  protCible: number;
}) {
  const conseil = protConseilParKg(profile);
  const parKg = protParKgEffectif(profile);
  const advice = protAdvice(parKg, conseil);
  const libre = profile.protParKg != null;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span className="small" style={{ color: 'var(--text)' }}>
          Protéines : <strong className="mono">{fmt(parKg, 1)} g/kg</strong> ·{' '}
          <strong className="mono">{fmt(protCible)} g/jour</strong>
        </span>
        {libre && parKg !== conseil && (
          <button className="ghost small" onClick={() => setProfile({ protParKg: undefined })}>
            Revenir au conseillé ({fmt(conseil, 1)} g/kg)
          </button>
        )}
      </div>
      <input
        type="range"
        min={PROT_BOUNDS.min}
        max={PROT_BOUNDS.max}
        step={0.1}
        value={parKg}
        onChange={(e) => setProfile({ protParKg: parseFloat(e.target.value) })}
        style={{ width: '100%', marginTop: 6 }}
        aria-label="Protéines par kilo de poids de corps"
      />
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span>{fmt(PROT_BOUNDS.min, 1)} g/kg</span>
        <span>conseillé pour vous · {fmt(conseil, 1)} g/kg</span>
        <span>{fmt(PROT_BOUNDS.max, 1)} g/kg</span>
      </div>
      <div className="hint" style={advice.warn ? { color: 'var(--warn)' } : undefined}>
        {advice.warn ? '⚠️ ' : '💡 '}
        {advice.text}
      </div>
    </div>
  );
}
