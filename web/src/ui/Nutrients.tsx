import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, dayTotals, todayStr } from '../store/store';
import type { Target } from '../nutrition/targets';
import { computeRatios } from '../nutrition/ratios';
import type { RatioResult } from '../nutrition/ratios';
import type { NutrientKey } from '../nutrition/types';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { NUTRIENT_GUIDE, EVIDENCE_LABEL } from '../nutrition/guide';
import type { EvidenceLevel } from '../nutrition/guide';
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

      {/* Ce qu'il y a à FAIRE d'abord (quoi manger, carence en vue), la lecture
          ensuite : les rapports sont une explication, ils ferment la page. */}
      <Recommendations averages={averages} targets={targets} hasData={recorded.length > 0} />

      <NutrientImportancePanel targets={targets} />

      <VitaminDPanel status={vitDStatus} />

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

/**
 * Une décimale sous 10, aucune au-dessus : « AJR 1 mg » pour la vitamine B6 (1,4)
 * serait faux de 40 % sur une page qui promet des seuils précis.
 */
const q = (v: number) => fmt(v, v < 10 ? 1 : 0);

/** Cible lisible d'un nutriment (AJR / optimal, ou plafond pour une limite). */
function targetLine(t: Target): string {
  if (t.goal === 'limit') return `Idéal ≤ ${q(t.optimal)} ${t.unit} · plafond ${q(t.ajr)} ${t.unit}`;
  if (t.optimal !== t.ajr) return `AJR ${q(t.ajr)} ${t.unit} → optimal ${q(t.optimal)} ${t.unit}`;
  return `AJR ${q(t.ajr)} ${t.unit}`;
}

/**
 * Seconde ligne de repères, côté HAUT : le seuil de prudence puis, quand elle
 * est connue, la dose à laquelle des effets ont réellement été observés. Les
 * deux sont volontairement distingués — confondre « au-delà, ce n'est plus
 * anodin » et « à cette dose, des gens ont été malades » est ce qui rend la
 * plupart des mises en garde nutritionnelles inutilisables.
 */
function dangerLine(t: Target): string | null {
  if (t.upper == null && t.toxic == null) return null;
  const parts: string[] = [];
  if (t.upper != null) parts.push(`prudence au-delà de ${q(t.upper)} ${t.unit}`);
  if (t.toxic != null) parts.push(`effets observés à partir de ${q(t.toxic)} ${t.unit}`);
  return parts.join(' · ');
}

const EVIDENCE_COLOR: Record<EvidenceLevel, string> = {
  etabli: 'var(--accent-2)',
  discute: 'var(--warn)',
  incertain: 'var(--muted)',
};

/**
 * Contenu déplié d'un nutriment : les quatre mêmes questions pour tous, dans le
 * même ordre, précédées du niveau de preuve. C'est ici qu'ont été rapatriés les
 * anciens panneaux « AG saturés » et « Fer » — un pavé par nutriment tout en
 * haut de la page ne passait pas à l'échelle de 37 lignes, et personne n'allait
 * chercher le fer en bas de page alors que sa tuile est dans le bilan.
 */
function NutrientDetail({ t }: { t: Target }) {
  const g = NUTRIENT_GUIDE[t.key];
  const danger = dangerLine(t);
  const ref = useRef<HTMLDivElement>(null);

  // Ces textes sont longs : dépliés depuis le bas de l'écran, ils s'ouvrent
  // hors champ et on tombe au milieu d'un paragraphe. On remonte donc la ligne
  // du nutriment en haut de la fenêtre — mais SEULEMENT si le bloc dépasse
  // effectivement, pour ne pas faire sauter la page quand il tient déjà.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const visible = window.innerHeight - rect.top;
    if (rect.height <= visible) return;
    // Le parent porte la ligne cliquée ET ce bloc : c'est lui qu'on aligne,
    // sinon le nom du nutriment sortirait de l'écran par le haut.
    (el.parentElement ?? el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="nutrient-detail small" ref={ref}>
      {g && (
        <div className="ng-evidence" style={{ borderColor: EVIDENCE_COLOR[g.evidence.level] }}>
          <span className="ng-evidence-tag" style={{ color: EVIDENCE_COLOR[g.evidence.level] }}>
            {EVIDENCE_LABEL[g.evidence.level]}
          </span>
          {g.evidence.text}
        </div>
      )}

      <div className="mono" style={{ color: t.goal === 'limit' ? 'var(--warn)' : 'var(--text)' }}>
        {targetLine(t)}
      </div>
      {danger && (
        <div className="mono" style={{ color: 'var(--danger)', opacity: 0.85 }}>
          {danger}
        </div>
      )}

      {g ? (
        <>
          <GuideBlock title="Trop bas" color="var(--accent)" text={g.low} />
          <GuideBlock title="À quoi ça sert" color="var(--text)" text={g.role} />
          <GuideBlock title="Monter plus haut ?" color="var(--accent-2)" text={g.higher} />
          {g.high && <GuideBlock title="Trop haut" color="var(--danger)" text={g.high} />}
          {g.extra?.map((e) => <GuideBlock key={e.title} title={e.title} color="var(--muted)" text={e.text} />)}
          {g.tip && (
            <div className="hint" style={{ marginTop: 8 }}>
              <strong>À retenir</strong> — {g.tip}
            </div>
          )}
        </>
      ) : (
        <div style={{ marginTop: 4 }}>{t.role}</div>
      )}

      {t.optimalNote && <div className="ng-note">{t.optimalNote}</div>}
    </div>
  );
}

function GuideBlock({ title, color, text }: { title: string; color: string; text: string }) {
  return (
    <div className="ng-block">
      <div className="ng-title" style={{ color }}>{title}</div>
      <div className="ng-text">{text}</div>
    </div>
  );
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
        <h2 style={{ margin: 0 }}>Comprendre &amp; régler chaque nutriment</h2>
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
      <p className="small" style={{ marginTop: 10, marginBottom: 6 }}>
        <strong>Cliquez le nom d'un nutriment pour le déplier</strong> : ce qui arrive quand on en manque et à
        partir de quelle dose, à quoi il sert, ce qu'on gagne réellement à monter plus haut, et à partir de
        quelle quantité l'excès devient un problème — avec, à chaque fois, ce qui est solidement établi et ce
        qui ne l'est pas.
      </p>
      <div className="hint" style={{ marginTop: 8 }}>
        Le curseur, lui, pondère le nutriment. <strong>×0</strong> = ignoré (aucun conseil), <strong>×1</strong> =
        normal, <strong>×3</strong> = prioritaire. Réglez tout un groupe d'un coup avec le curseur du groupe.
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
                <div key={k} className="nutrient-item">
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
                  {isOpen && <NutrientDetail t={t} />}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
