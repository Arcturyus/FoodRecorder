import { useMemo, useState } from 'react';
import { useStore, dayTotals, todayStr } from '../store/store';
import type { Target } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import type { NutrientKey } from '../nutrition/types';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { effectiveImportance, IMPORTANCE_BOUNDS } from '../nutrition/recommend';
import { PeriodSelector } from './PeriodSelector';
import { usePeriodNutrition } from './usePeriodNutrition';
import { Recommendations } from './Recommend';
import { VitaminDPanel } from './VitaminD';
import { fmt } from './format';

const STATUS_COLOR: Record<string, string> = {
  good: 'var(--accent-2)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  na: 'var(--muted)',
};

/**
 * Onglet « Nutriments » : la page « comprendre + régler + agir ». De haut en bas :
 *  - un sélecteur de période propre (qui pilote recommandations et vitamine D) ;
 *  - les rapports optimaux (valeur d'aujourd'hui) ;
 *  - le cœur : l'importance de chaque nutriment (curseur ×0→3) fusionnée avec son
 *    rôle et sa cible, dépliables au clic ;
 *  - les recommandations d'aliments/suppléments sur la période ;
 *  - le statut de carence en vitamine D.
 */
export function Nutrients() {
  const entries = useStore((s) => s.entries);
  const today = todayStr();
  const {
    period,
    setPeriod,
    includeToday,
    setIncludeToday,
    excludeSupplements,
    setExcludeSupplements,
    targets,
    days,
    recorded,
    averages,
    vitDStatus,
  } = usePeriodNutrition();

  // Rapports : équilibre du jour (snapshot de la balance actuelle), comme dans l'ancien Guide.
  const totals = useMemo(() => dayTotals(entries, today), [entries, today]);
  const ratios = useMemo(() => computeRatios(totals), [totals]);

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Nutriments — {days} jours</h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        <div className="row" style={{ alignItems: 'center', marginTop: 4, gap: 16, flexWrap: 'wrap' }}>
          <label
            className="row small"
            style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
            data-tip="Par défaut, la journée en cours (pas encore terminée) est exclue des moyennes qui pilotent recommandations et vitamine D."
          >
            <input type="checkbox" checked={includeToday} onChange={(e) => setIncludeToday(e.target.checked)} />
            Inclure la journée en cours
          </label>
          <label
            className="row small"
            style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
            data-tip="Retire créatine, whey, magnésium, vitamines, oméga 3… mais aussi le sel et le poivre (même catégorie) des moyennes. Le gain de vitamine D du soleil, lui, est conservé."
          >
            <input
              type="checkbox"
              checked={excludeSupplements}
              onChange={(e) => setExcludeSupplements(e.target.checked)}
            />
            Sans les suppléments
          </label>
        </div>
        <div className="hint">
          Réglez l'importance de chaque nutriment ci-dessous : elle pilote les recommandations et les conseils du jour.
          Recommandations et vitamine D sont calculées sur {recorded.length} jour(s) enregistré(s)
          {!includeToday && ", aujourd'hui exclu"}.
        </div>
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

      <SaturatedFatGuide />

      <NutrientImportancePanel targets={targets} />

      <Recommendations averages={averages} targets={targets} hasData={recorded.length > 0} />

      <VitaminDPanel status={vitDStatus} />
    </>
  );
}

/**
 * Zoom sur les AG saturés : sous un seul chiffre du bilan se cachent trois
 * familles au comportement très différent. Tant que la base ne détaille pas la
 * répartition par acide gras (C16/C14/C18), c'est ici que se lit la nuance —
 * d'où un texte d'explication plutôt qu'un simple `optimalNote` sur la ligne.
 */
function SaturatedFatGuide() {
  return (
    <div className="panel">
      <h2>AG saturés : tous ne se valent pas</h2>
      <p className="small" style={{ marginTop: -6 }}>
        « AG saturés » est un fourre-tout. Sous ce seul chiffre cohabitent trois familles qui se comportent
        différemment selon la longueur de leur chaîne carbonée — c'est pourquoi un carré de chocolat noir et une
        noix de beurre, à AG saturés égaux, n'ont pas le même effet sur les artères.
      </p>

      <div className="guide-item">
        <strong>Palmitique (C16:0) &amp; myristique (C14:0) — ceux qui comptent vraiment</strong>
        <div className="small" style={{ marginTop: 4 }}>
          Beurre, crème, fromage, viande grasse, huile de palme — donc aussi les viennoiseries, pâtisseries et
          plats industriels. Ils freinent les récepteurs qui font le ménage du LDL dans le foie : en excès, le
          LDL monte et les plaques artérielles se construisent sur des années. À quantité égale le myristique
          est le plus puissant des deux, mais le palmitique est de très loin le plus abondant.
        </div>
        <div className="small" style={{ marginTop: 4, color: 'var(--warn)' }}>
          C'est sur eux que porte le plafond qui compte : <strong>16 g/j</strong> pour 2000 kcal, idéal ≤ 11 g.
        </div>
      </div>

      <div className="guide-item">
        <strong>Stéarique (C18:0) — le neutre</strong>
        <div className="small" style={{ marginTop: 4 }}>
          Chocolat noir (le beurre de cacao en est ~1/3), bœuf et agneau, un peu le porc. Le foie le désature
          très vite en acide <em>oléique</em> — exactement l'acide gras de l'huile d'olive. Résultat : il ne fait
          pas monter le LDL, et les études en milieu contrôlé qui en ont fait manger jusqu'à ~11 % de l'énergie
          (≈ 24 g/j) n'ont pas vu le LDL bouger. Il n'a donc rien à faire dans un plafond.
        </div>
        <div className="small" style={{ marginTop: 4, color: 'var(--muted)' }}>
          Repère souple malgré tout : <strong>18 g/j</strong>, avec un poids d'importance faible — plus du double
          d'un apport courant (5-8 g), donc il ne se déclenche que sur un vrai excès. Pourquoi pas totalement
          libre : il fait un peu baisser le HDL, il est soupçonné de favoriser l'agrégation plaquettaire, et
          surtout il n'arrive presque jamais seul — l'aliment qui l'apporte apporte du palmitique avec.
        </div>
      </div>

      <div className="guide-item">
        <strong>Laurique (C12:0) &amp; chaînes courtes à moyennes (C4 à C10) — le cas à part</strong>
        <div className="small" style={{ marginTop: 4 }}>
          Coco et huile de palmiste pour le laurique ; beurre et fromages pour les chaînes courtes. Le laurique
          fait monter le LDL, mais aussi beaucoup le HDL ; les chaînes courtes sont brûlées directement par le
          foie plutôt que stockées. Peu abondants dans une alimentation française : ils restent comptés dans le
          total, sans qu'on les traque à part.
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        <strong>À retenir</strong> — ce n'est pas tant la quantité d'AG saturés qui compte que leur origine.
        Une même dose de chocolat noir à 85 % et de beurre donne le même chiffre dans le bilan, pas le même
        effet. À l'inverse, un plat industriel « pas si gras » à l'huile de palme apporte du palmitique presque
        pur. C'est pour ça que la tuile « AG saturés » du bilan porte une ligne « dont … » : son total n'est
        plus qu'un <em>filet de sécurité</em> (plafond 30 g, poids réduit), le vrai plafond étant sur les 16 g
        de C16+C14. Survolez la tuile pour voir, aliment par aliment, ce que chacun apporte de l'un et de l'autre.
      </div>
    </div>
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

/** Cible lisible d'un nutriment (AJR / optimal, ou plafond pour une limite). */
function targetLine(t: Target): string {
  if (t.goal === 'limit') return `Idéal ≤ ${fmt(t.optimal)} ${t.unit} · plafond ${fmt(t.ajr)} ${t.unit}`;
  if (t.optimal !== t.ajr) return `AJR ${fmt(t.ajr)} ${t.unit} → optimal ${fmt(t.optimal)} ${t.unit}`;
  return `AJR ${fmt(t.ajr)} ${t.unit}`;
}

/**
 * Cœur de la page : l'importance de chaque nutriment (curseur ×0→3, groupé par
 * famille avec réglage rapide du groupe) FUSIONNÉE avec son rôle et sa cible.
 * Un clic sur le nom déplie le détail (cible + rôle complet + note) ; un survol
 * du nom montre un rappel court (le rôle). À ×0, un nutriment disparaît des
 * recommandations et des conseils ; plus haut, ses manques pèsent davantage.
 */
function NutrientImportancePanel({ targets }: { targets: Target[] }) {
  const overrides = useStore((s) => s.nutrientImportance);
  const setNutrientImportance = useStore((s) => s.setNutrientImportance);
  const resetNutrientImportance = useStore((s) => s.resetNutrientImportance);
  const resetAllNutrientImportance = useStore((s) => s.resetAllNutrientImportance);
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const [expanded, setExpanded] = useState<NutrientKey | null>(null);

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Importance &amp; rôle des nutriments</h2>
        {hasOverrides && (
          <button className="ghost small" onClick={resetAllNutrientImportance}>
            Tout réinitialiser
          </button>
        )}
      </div>
      <details className="reco-settings" style={{ marginTop: 8 }}>
        <summary className="small">Comprendre AJR &amp; optimal</summary>
        <div className="hint" style={{ marginTop: 6 }}>
          Deux repères accompagnent chaque nutriment. L'<strong>AJR</strong> (apport journalier de référence,
          d'après les valeurs européennes et l'ANSES) est le seuil à couvrir pour éviter une carence.
          L'<strong>optimal</strong> est une cible « santé / sport » : souvent plus <em>haute</em> que l'AJR,
          mais parfois c'est l'inverse.
          <ul className="guide-list">
            <li>
              <strong>Viser haut</strong> — la plupart des vitamines et minéraux : atteindre voire dépasser l'AJR
              jusqu'à la cible optimale (vitamine D, C, magnésium, protéines).
            </li>
            <li>
              <strong>Viser bas</strong> — quelques nutriments où l'excès nuit : l'optimal est <em>le plus bas
              possible</em>, l'AJR devient un plafond (sodium, AG saturés).
            </li>
            <li>
              <strong>Viser juste (rapports)</strong> — pour certains couples, c'est l'équilibre qui compte, pas la
              quantité absolue (oméga-6/3, potassium/sodium, calcium/magnésium).
            </li>
          </ul>
        </div>
      </details>
      <div className="hint" style={{ marginTop: 8 }}>
        Pondère chaque nutriment. <strong>×0</strong> = ignoré (aucun conseil), <strong>×1</strong> = normal,
        <strong> ×3</strong> = prioritaire. Réglez tout un groupe d'un coup avec le curseur du groupe, ou cliquez un
        nom pour lire son rôle et sa cible.
      </div>

      {NUTRIENT_GROUPS.map((g) => {
        const keys = g.keys.filter((k) => k !== 'kcal' && targetByKey.has(k));
        if (keys.length === 0) return null;
        const avg = keys.reduce((a, k) => a + effectiveImportance(k, overrides), 0) / keys.length;
        return (
          <div className="importance-group" key={g.title}>
            <div className="importance-group-head">
              <span className="gh">{g.title}</span>
              <input
                type="range"
                min={IMPORTANCE_BOUNDS.min}
                max={IMPORTANCE_BOUNDS.max}
                step={IMPORTANCE_BOUNDS.step}
                value={avg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  for (const k of keys) setNutrientImportance(k, v);
                }}
                data-tip="Applique cette importance à tout le groupe"
                aria-label={`Importance du groupe ${g.title}`}
              />
              <span className="mono small" style={{ width: 34, textAlign: 'right' }}>×{fmt(avg, 1)}</span>
            </div>
            {keys.map((k) => {
              const t = targetByKey.get(k)!;
              const val = effectiveImportance(k, overrides);
              const overridden = overrides[k] !== undefined;
              const isOpen = expanded === k;
              return (
                <div key={k}>
                  {/* Sous-détail (C16+C14, stéarique) : décalé sous son parent pour
                      qu'on lise « ce sont des morceaux d'AG saturés », pas trois
                      nutriments indépendants. */}
                  <div className={`importance-row${t.parent ? ' is-sub' : ''}`}>
                    <button
                      className="importance-label nutrient-toggle"
                      data-tip={t.role}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded((cur) => (cur === k ? null : k))}
                    >
                      <span className="nutrient-caret">{isOpen ? '▾' : '▸'}</span> {t.label}
                    </button>
                    <input
                      type="range"
                      min={IMPORTANCE_BOUNDS.min}
                      max={IMPORTANCE_BOUNDS.max}
                      step={IMPORTANCE_BOUNDS.step}
                      value={val}
                      onChange={(e) => setNutrientImportance(k, Number(e.target.value))}
                      aria-label={`Importance : ${t.label}`}
                    />
                    <span className="mono small" style={{ width: 34, textAlign: 'right', color: val === 0 ? 'var(--muted)' : undefined }}>
                      ×{fmt(val, 1)}
                    </span>
                    <button
                      className="ghost small importance-reset"
                      style={{ visibility: overridden ? 'visible' : 'hidden' }}
                      onClick={() => resetNutrientImportance(k)}
                      data-tip="Revenir au défaut"
                      aria-label={`Réinitialiser l'importance : ${t.label}`}
                    >
                      ↺
                    </button>
                  </div>
                  {isOpen && (
                    <div className="nutrient-detail small">
                      <div className="mono" style={{ color: t.goal === 'limit' ? 'var(--warn)' : 'var(--text)' }}>
                        {targetLine(t)}
                      </div>
                      <div style={{ marginTop: 4 }}>{t.role}</div>
                      {t.optimalNote && (
                        <div style={{ marginTop: 4, color: 'var(--muted)' }}>{t.optimalNote}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
