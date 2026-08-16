import { useStore } from '../store/store';
import { useEnergy, useBody } from './useTargets';
import { objectivePct } from '../nutrition/targets';
import {
  TDEE_UNCERTAINTY_PCT,
  TEF_RATIO,
  KCAL_PER_KG_FAT,
  KCAL_PER_STEP_PER_KG,
  SPORT_MET,
  POSTURE_KCAL_70,
  DAYS_PER_MONTH,
  SPORT_LABELS,
} from '../nutrition/energy';
import type { BmrFormula } from '../nutrition/energy';
import { fmt } from './format';

/**
 * Restitution du calcul de dépense : d'où viennent les calories dépensées, ce
 * qu'il reste après application de l'objectif, et ce que cet écart représente en
 * kilos par mois. Tout ce qui est affiché ici est une estimation — les fourchettes
 * et les explications repliées en bas de panneau disent lesquelles, et pourquoi.
 */
/** Variation de poids avec son signe explicite (− = perte, + = prise). */
function signe(kg: number): string {
  return `${kg < 0 ? '−' : '+'}${fmt(Math.abs(kg), 1)}`;
}

export function EnergyPanel() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const body = useBody();
  const e = useEnergy();

  const parts = [
    { label: 'Métabolisme de base', value: e.bmr, color: 'var(--accent)' },
    { label: 'Marche (pas)', value: e.neatPas, color: 'var(--accent-2)' },
    { label: 'Posture / travail', value: e.neatPosture, color: '#6fb3c9' },
    { label: 'Sport', value: e.sport, color: 'var(--accent-deep)' },
    { label: 'Digestion', value: e.tef, color: 'var(--ia)' },
  ].filter((p) => p.value > 0);

  const marge = Math.round((e.tdee * TDEE_UNCERTAINTY_PCT) / 100);
  const objectif = profile.objectif ?? 'maintien';
  const perte = -e.kgParMois; // positif = kilos perdus
  // Bornes de la prévision, dans l'ordre croissant et signées : à faible déficit
  // l'incertitude peut couvrir les deux sens, et l'afficher en valeur absolue
  // laisserait croire à une perte garantie.
  const bornes = [e.kgParMoisMin, e.kgParMoisMax].sort((a, b) => a - b);
  const mgSource = profile.masseGrassePct != null ? 'saisie' : body.masseGrassePct != null ? 'pesée' : null;

  return (
    <div className="panel">
      <h2>Dépense énergétique estimée</h2>

      <div className="energy-headline">
        <div>
          <span className="energy-big mono">{fmt(e.tdee)}</span> <span className="small">kcal/jour dépensés</span>
          <div className="small">
            fourchette réaliste : {fmt(e.tdee - marge)} – {fmt(e.tdee + marge)} kcal
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="energy-big mono" style={{ color: 'var(--accent-2)' }}>
            {fmt(e.cible)}
          </span>{' '}
          <span className="small">kcal/jour visés</span>
          <div className="small">
            {objectif === 'maintien'
              ? 'maintien : on vise la dépense'
              : `${objectif === 'perte' ? '−' : '+'}${objectivePct(profile)} % du maintien`}
          </div>
        </div>
      </div>

      <div className="energy-stack" role="img" aria-label="Répartition de la dépense énergétique">
        {parts.map((p) => (
          <span
            key={p.label}
            style={{ width: `${(p.value / e.tdee) * 100}%`, background: p.color }}
            data-tip={`${p.label} : ${fmt(p.value)} kcal (${fmt((p.value / e.tdee) * 100)} %)`}
          />
        ))}
      </div>
      <div className="energy-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} <strong className="mono">{fmt(p.value)}</strong> kcal
          </span>
        ))}
      </div>

      {objectif !== 'maintien' && (
        <div className="energy-forecast">
          <div>
            <strong className="mono" style={{ fontSize: 18, color: perte > 0 ? 'var(--accent-2)' : 'var(--accent)' }}>
              {perte > 0 ? '−' : '+'}
              {fmt(Math.abs(e.kgParMois), 1)} kg
            </strong>{' '}
            par mois, si l'écart est tenu
          </div>
          <div className="small">
            soit {fmt(Math.abs((e.kgParMois * 12) / 52.18), 2)} kg par semaine · écart énergétique réel{' '}
            <strong className="mono">{fmt(Math.abs(e.ecartReel))}</strong> kcal/jour
          </div>
          <div className="small">
            En tenant compte de l'incertitude sur la dépense : entre {signe(bornes[0])} et {signe(bornes[1])} kg par
            mois{bornes[0] < 0 && bornes[1] > 0 ? ' — à ce niveau, l’incertitude couvre les deux sens.' : '.'}
          </div>
        </div>
      )}

      <details className="reco-settings" style={{ marginTop: 14 }}>
        <summary>Métabolisme de base : {fmt(e.bmr)} kcal — comparer les formules</summary>
        <div className="hint" style={{ marginTop: 8 }}>
          Le métabolisme de base, c'est ce que vous brûleriez couché toute la journée à ne rien faire. Aucune
          formule ne le mesure : elles l'estiment à partir de votre corps, avec des écarts de l'ordre de ±10 %.
          Seule une calorimétrie indirecte le mesure vraiment.
        </div>
        <table className="energy-table">
          <tbody>
            {e.estimates.map((est) => (
              <tr key={est.key} className={est.key === e.bmrKey ? 'sel' : undefined}>
                <td className="mono">{fmt(est.value)}</td>
                <td>
                  {est.label}
                  {est.key === e.bmrKey && <span className="badge adj" style={{ marginLeft: 6 }}>retenue</span>}
                  <div className="sub-detail small">{est.note}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {e.masseMaigre != null ? (
          <div className="hint">
            Masse maigre estimée : <strong className="mono">{fmt(e.masseMaigre, 1)} kg</strong> (masse grasse{' '}
            {mgSource === 'saisie' ? 'saisie' : 'de la dernière pesée'}). Attention : une balance à impédance se
            trompe couramment de 3 à 5 points de masse grasse, ce qui déplace ces formules de ±80 kcal — leur
            avantage théorique ne tient que si la mesure est bonne.
          </div>
        ) : (
          <div className="hint">
            Aucune masse grasse connue : les formules à masse maigre (Cunningham, Katch-McArdle) sont
            indisponibles. Renseignez-la dans le profil ou enregistrez une pesée qui la contient.
          </div>
        )}
        <label className="field" style={{ marginTop: 10, maxWidth: 320 }}>
          Formule utilisée pour les cibles
          <select
            value={profile.bmrFormule ?? 'auto'}
            onChange={(ev) => setProfile({ bmrFormule: ev.target.value as BmrFormula })}
          >
            <option value="auto">Automatique (masse maigre si connue)</option>
            <option value="ffm">Cunningham (masse maigre)</option>
            <option value="mifflin">Mifflin-St Jeor</option>
          </select>
        </label>
      </details>

      <details className="reco-settings" style={{ marginTop: 8 }}>
        <summary>Comment ce chiffre est construit</summary>
        <ul className="energy-notes">
          <li>
            <strong>Métabolisme de base</strong> — {fmt(e.bmr)} kcal. Le poste le plus lourd, et le moins
            manipulable : il dépend surtout de la masse maigre, de la taille et de l'âge.
          </li>
          <li>
            <strong>Marche</strong> — {fmt(e.neatPas)} kcal. Compté à {KCAL_PER_STEP_PER_KG} kcal par pas et par
            kilo, soit environ {fmt(10000 * profile.poids * KCAL_PER_STEP_PER_KG)} kcal pour 10 000 pas à votre
            poids. C'est le coût <em>net</em> : la dépense de repos, déjà comptée plus haut, en est déduite.
          </li>
          <li>
            <strong>Posture</strong> — {fmt(e.neatPosture)} kcal. Tenir debout sans marcher coûte environ
            0,2 kcal par minute de plus qu'assis : quelques dizaines de kcal sur une journée de bureau
            (référence : {POSTURE_KCAL_70.debout} kcal/j pour 70 kg en station debout dominante), bien davantage
            pour un métier physique.
          </li>
          <li>
            <strong>Sport</strong> — {fmt(e.sport)} kcal/jour, volume hebdomadaire lissé sur sept jours. Une
            heure de {SPORT_LABELS[profile.sportType ?? 'muscu'].toLowerCase()} est comptée à{' '}
            {SPORT_MET[profile.sportType ?? 'muscu']} MET, temps de repos inclus. C'est le poste que tout le monde
            surestime : une séance de musculation d'une heure brûle rarement plus de 300 kcal.
          </li>
          <li>
            <strong>Digestion</strong> — {fmt(e.tef)} kcal. Environ {Math.round(TEF_RATIO * 100)} % de ce qui est
            ingéré part dans la transformation des aliments (davantage avec beaucoup de protéines, moins avec
            beaucoup de lipides).
          </li>
        </ul>
      </details>

      <details className="reco-settings" style={{ marginTop: 8 }}>
        <summary>Pourquoi « environ » — les limites de ce calcul</summary>
        <ul className="energy-notes">
          <li>
            <strong>±{TDEE_UNCERTAINTY_PCT} % sur la dépense.</strong> Les équations de métabolisme de base sont
            calées sur des moyennes de population ; à corpulence identique, deux personnes peuvent différer de
            200 kcal. S'y ajoutent l'imprécision des pas et le coût réel des séances.
          </li>
          <li>
            <strong>La règle des {fmt(KCAL_PER_KG_FAT)} kcal par kilo</strong> (Wishnofsky, 1958) suppose que ce
            qui est perdu est du gras pur. Sur quelques semaines l'ordre de grandeur tient ; au-delà, le corps
            s'adapte — le métabolisme baisse, on bouge spontanément moins — et la perte réelle décroche de la
            prévision linéaire. Un mois affiché à −{fmt(Math.abs(e.kgParMois), 1)} kg ne se prolonge pas
            mécaniquement en −{fmt(Math.abs(e.kgParMois) * 12, 1)} kg sur un an.
          </li>
          <li>
            <strong>Manger moins fait aussi moins digérer.</strong> L'écart affiché entre dépense et cible
            ({fmt(Math.abs(e.tdee - e.cible))} kcal) n'est pas l'écart réel : la digestion baisse en proportion,
            ce qui ramène l'écart effectif à {fmt(Math.abs(e.ecartReel))} kcal/jour. La plupart des applications
            oublient cette correction et sur-promettent d'environ 10 %.
          </li>
          <li>
            <strong>Le poids sur la balance n'est pas de la graisse.</strong> Eau, glycogène, contenu digestif
            font varier le poids de 1 à 2 kg d'un jour à l'autre — d'où l'intérêt de juger sur une tendance de
            plusieurs semaines (courbe des pesées), jamais sur une mesure.
          </li>
          <li>
            <strong>Et l'apport est mesuré, lui aussi, avec une erreur.</strong> Les études de sous-déclaration
            situent l'écart entre ce qu'on croit manger et ce qu'on mange autour de 20 %. Si la perte réelle
            décroche de la prévision, c'est plus souvent de ce côté que du côté du métabolisme.
          </li>
        </ul>
        <div className="hint">
          Sur un mois de {fmt(DAYS_PER_MONTH, 0)} jours, 100 kcal d'erreur quotidienne représentent{' '}
          {fmt((100 * DAYS_PER_MONTH) / KCAL_PER_KG_FAT, 2)} kg : la bonne façon d'utiliser ces chiffres est de
          les prendre comme point de départ, puis de les corriger d'après ce que fait votre poids.
        </div>
      </details>
    </div>
  );
}
