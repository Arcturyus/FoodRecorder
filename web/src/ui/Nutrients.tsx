import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, dayTotals, todayStr } from '../store/store';
import type { Target } from '../nutrition/targets';
import { PER_KG_KEYS, countTargetOverrides, hasTargetOverride, protParKgEffectif } from '../nutrition/targets';
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
import { Section } from './Section';
import { useDefaultTargets } from './useTargets';

const STATUS_COLOR: Record<string, string> = {
  good: 'var(--accent-2)',
  warn: 'var(--warn)',
  bad: 'var(--danger)',
  na: 'var(--muted)',
};

/**
 * Onglet « Nutriments » : la page « comprendre + régler + agir ». De haut en bas :
 *  - un sélecteur de période propre (qui pilote recommandations et vitamine D) ;
 *  - le cœur : l'importance de chaque nutriment (curseur ×0→3) fusionnée avec son
 *    rôle et sa cible, dépliables au clic — le menu est déplié par défaut, pas
 *    chaque nutriment ;
 *  - les recommandations d'aliments/suppléments sur la période ;
 *  - le statut de carence en vitamine D ;
 *  - les rapports optimaux (valeur d'aujourd'hui).
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
  // Replié : combien de rapports sont dans leur cible — la seule chose qu'on
  // vient vérifier ici quand on ne cherche pas le détail.
  const ratioSummary = `${ratios.filter((r) => r.status === 'good').length}/${ratios.length} dans la cible`;

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
          Recommandations et vitamine D sont calculées sur {recorded.length} jour(s) enregistré(s)
          {!includeToday && ", aujourd'hui exclu"}. Importance et cibles de chaque nutriment se règlent
          juste en dessous, sous « Comprendre &amp; régler ».
        </div>
      </div>

      {/* Réglage en haut, déplié (mais chaque nutriment reste replié) : c'est la
          première chose qu'on vient faire en arrivant sur cette page, avant les
          recommandations qui en dépendent. La lecture (rapports) ferme la page. */}
      <NutrientSettingsPanel targets={targets} />

      <Recommendations averages={averages} targets={targets} hasData={recorded.length > 0} />

      <VitaminDPanel status={vitDStatus} />

      <Section id="nutriments-ratios" title="Rapports optimaux" summary={ratioSummary}>
        <p className="small" style={{ marginTop: -6 }}>
          La valeur affichée est celle d'aujourd'hui. Ce sont souvent ces équilibres, plus que les quantités,
          qui pilotent l'inflammation, la tension et la santé osseuse.
        </p>
        {ratios.map((r) => (
          <RatioCard key={r.def.key} r={r} />
        ))}
      </Section>
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

/** Les deux repères réglables d'un nutriment. */
type TargetField = 'ajr' | 'optimal';

/**
 * Tout ce qui sert à LIRE et à RÉGLER les cibles d'un nutriment, au même endroit :
 * le curseur de la ligne et les champs précis du bloc déplié s'appuient tous les
 * deux dessus et ne peuvent donc pas diverger.
 */
function useNutrientTarget(t: Target) {
  const override = useStore((s) => s.nutrientTargets[t.key]);
  const setNutrientTarget = useStore((s) => s.setNutrientTarget);
  const resetNutrientTarget = useStore((s) => s.resetNutrientTarget);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const poids = profile.poids;

  const canPerKg = PER_KG_KEYS.has(t.key) && poids > 0;
  // Les protéines s'ouvrent en g/kg : c'est l'unité dans laquelle leur réglage
  // existe déjà (profil), et celle dans laquelle la question se pose.
  const perKg = (override?.perKg ?? t.key === 'proteines') && canPerKg;
  const unit = perKg ? `${t.unit}/kg` : t.unit;

  /**
   * Les protéines ont DÉJÀ leur réglage, dans le profil (`protParKg`, en g/kg) :
   * il pilote la cible, les conseils et le panneau de dépense. En écrire un
   * second ici ferait diverger les deux écrans en silence — l'un annonçant
   * 1,8 g/kg pendant que la cible réelle en vaudrait 2,2. La cible haute des
   * protéines écrit donc dans le profil : c'est la même donnée, vue d'ici.
   */
  const protLie = t.key === 'proteines';

  /** Ordre de lecture des deux repères : le bas puis le haut, quel que soit l'objectif. */
  const lowField: TargetField = t.goal === 'limit' ? 'optimal' : 'ajr';
  const highField: TargetField = t.goal === 'limit' ? 'ajr' : 'optimal';
  const lowLabel = t.goal === 'limit' ? 'Idéal (bas)' : 'AJR';
  const highLabel = t.goal === 'limit' ? 'Plafond' : 'Optimal';

  /** Convertit une valeur absolue (mg, µg, g) dans l'unité affichée. */
  const toDisplay = (v: number) => round2(perKg ? v / poids : v);

  /** Valeur SAISIE pour ce repère (unité affichée), ou `undefined` si l'app décide. */
  function saved(field: TargetField): number | undefined {
    if (protLie && field === 'optimal') {
      if (profile.protParKg == null) return undefined;
      const parKg = protParKgEffectif(profile);
      return round2(perKg ? parKg : parKg * poids);
    }
    const v = override?.[field];
    return v == null ? undefined : round2(v);
  }

  /**
   * Fixe (ou efface, avec `undefined`) un repère, dans l'unité affichée. Zéro est
   * une cible valable — c'est celle de l'alcool et des AG trans.
   */
  function setValue(field: TargetField, v: number | undefined): void {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) return;
    if (protLie && field === 'optimal') {
      setProfile({ protParKg: v === undefined ? undefined : perKg ? v : v / poids });
      return;
    }
    setNutrientTarget(t.key, { [field]: v, ...(canPerKg ? { perKg } : {}) });
  }

  /** Bascule g ↔ g/kg SANS changer la cible : seule l'unité de saisie change. */
  function setPerKg(next: boolean): void {
    const conv = (v: number | undefined) => (v == null ? undefined : round2(next ? v / poids : v * poids));
    setNutrientTarget(t.key, {
      perKg: next,
      ...(override?.ajr != null ? { ajr: conv(override.ajr) } : {}),
      ...(override?.optimal != null ? { optimal: conv(override.optimal) } : {}),
    });
  }

  function reset(): void {
    resetNutrientTarget(t.key);
    if (protLie) setProfile({ protParKg: undefined });
  }

  const tuned = hasTargetOverride(override) || (protLie && profile.protParKg != null);

  return {
    perKg,
    canPerKg,
    unit,
    poids,
    protLie,
    lowField,
    highField,
    lowLabel,
    highLabel,
    toDisplay,
    saved,
    setValue,
    setPerKg,
    reset,
    tuned,
  };
}

type TargetControl = ReturnType<typeof useNutrientTarget>;

/**
 * Pas du curseur : ~1 % de l'échelle, ramené au multiple de 1, 2 ou 5 le plus
 * proche. Un pas brut donnerait des cibles à 4,37 µg que personne n'a choisies,
 * et un pas fixe serait absurde d'un nutriment à l'autre (0,05 g/kg de protéines
 * contre 50 mg de potassium).
 */
export function niceStep(max: number): number {
  const raw = max / 100;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

/** Affichage court d'une cible, avec assez de décimales pour rester exacte. */
function tv(v: number): string {
  return fmt(v, v < 1 ? 2 : v < 10 ? 1 : 0);
}

/**
 * Curseur de cible, sur la ligne du nutriment — donc réglable SANS déplier.
 * Deux poignées sur un même rail, parce que les deux repères ne se lisent que
 * l'un par rapport à l'autre : « AJR 375 → optimal 500 » est une information,
 * « optimal 500 » seul n'en est pas une. L'échelle va de 0 à deux fois la valeur
 * conseillée, avec un repère sur celle-ci : on voit d'un coup d'œil de combien
 * on s'écarte de la référence.
 */
function TargetSlider({ t, def, ctl }: { t: Target; def: Target; ctl: TargetControl }) {
  const { lowField, highField, lowLabel, highLabel, unit, toDisplay, setValue } = ctl;
  const max = round2(2 * toDisplay(def.goal === 'limit' ? def.ajr : def.optimal));
  const step = niceStep(max);
  const low = toDisplay(t[lowField]);
  const high = toDisplay(t[highField]);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;

  return (
    <div className="tgt">
      <div className="tgt-rail">
        <span className="tgt-track" />
        {/* La zone entre les deux poignées : pour un nutriment à couvrir, « de quoi
            ne pas être carencé, jusqu'à la cible » ; pour une limite, la marge
            encore acceptable. */}
        <span className="tgt-fill" style={{ left: pct(low), right: `calc(100% - ${pct(high)})` }} />
        <i
          className="tgt-mark"
          style={{ left: pct(toDisplay(def[lowField])) }}
          data-tip={`${lowLabel} conseillé : ${tv(toDisplay(def[lowField]))} ${unit}`}
        />
        <i
          className="tgt-mark"
          style={{ left: pct(toDisplay(def[highField])) }}
          data-tip={`${highLabel} conseillé : ${tv(toDisplay(def[highField]))} ${unit}`}
        />
        <input
          type="range"
          className="tgt-h low"
          min={0}
          max={max}
          step={step}
          value={low}
          // Les poignées ne se croisent pas : la basse pousserait la haute sans
          // qu'on comprenne pourquoi la cible a bougé toute seule.
          onChange={(e) => setValue(lowField, Math.min(Number(e.target.value), high))}
          aria-label={`${lowLabel} : ${t.label}`}
        />
        <input
          type="range"
          className="tgt-h high"
          min={0}
          max={max}
          step={step}
          value={high}
          onChange={(e) => setValue(highField, Math.max(Number(e.target.value), low))}
          aria-label={`${highLabel} : ${t.label}`}
        />
      </div>
      <span className="tgt-val mono small" data-tip={`${lowLabel} ${tv(low)} · ${highLabel} ${tv(high)} ${unit}`}>
        {tv(low)}
        <span className="tgt-arrow">{t.goal === 'limit' ? '·' : '→'}</span>
        {tv(high)} {unit}
      </span>
    </div>
  );
}

/**
 * Saisie exacte des cibles, dans le bloc déplié : le curseur de la ligne suffit
 * pour ajuster, pas pour poser un chiffre précis (« mon médecin dit 2 000 UI »).
 * Vide = conseillé : on ne stocke que ce qui a été explicitement changé, et tout
 * le reste continue de suivre les références quand elles évoluent.
 */
function TargetEditor({ t, def, ctl }: { t: Target; def: Target; ctl: TargetControl }) {
  const {
    perKg,
    canPerKg,
    unit,
    poids,
    protLie,
    lowField,
    highField,
    lowLabel,
    highLabel,
    toDisplay,
    saved,
    setValue,
    setPerKg,
    reset,
    tuned,
  } = ctl;

  const field = (f: TargetField, label: string) => {
    const v = saved(f);
    const conseil = toDisplay(def[f]);
    return (
      <label className="te-field" key={f}>
        <span className="small">{label}</span>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={v ?? ''}
          placeholder={tv(conseil)}
          onChange={(e) => {
            const txt = e.target.value.trim();
            setValue(f, txt === '' ? undefined : parseFloat(txt.replace(',', '.')));
          }}
          aria-label={`${label} : ${t.label}`}
        />
        <span className="small te-unit">{unit}</span>
      </label>
    );
  };

  return (
    <div className="target-editor">
      <div className="te-head">
        <span className="te-title">Cibles</span>
        {canPerKg && (
          <span className="row" style={{ gap: 4, alignItems: 'center' }}>
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={`small ${perKg === v ? 'chip-active' : 'ghost'}`}
                onClick={() => setPerKg(v)}
                data-tip={
                  v
                    ? `Cible exprimée par kilo de poids de corps (${fmt(poids)} kg) : elle suit le poids`
                    : 'Cible exprimée en valeur absolue par jour'
                }
              >
                {v ? `${t.unit}/kg` : t.unit}
              </button>
            ))}
          </span>
        )}
        {tuned && (
          <button className="ghost small" onClick={reset} data-tip="Revenir aux valeurs conseillées">
            ↺ conseillé
          </button>
        )}
      </div>

      <div className="te-grid">
        {field(lowField, lowLabel)}
        {field(highField, highLabel)}
      </div>

      <div className="small mono te-applied">
        appliqué : {lowLabel.toLowerCase()} {tv(t[lowField])} {t.unit} · {highLabel.toLowerCase()} {tv(t[highField])}{' '}
        {t.unit}
        {perKg && ` (pour ${fmt(poids)} kg)`}
      </div>
      {protLie && (
        <div className="small te-note">
          Les protéines se règlent aussi dans <strong>Profil › Protéines</strong> : c'est le même réglage, en g/kg.
        </div>
      )}
      {tuned && (
        <div className="small te-note">
          Cible personnelle : elle remplace la référence partout (bilan du jour, recommandations, conseils).
        </div>
      )}
    </div>
  );
}

/** Arrondi d'affichage des cibles réglées : deux décimales suffisent (0,03 g/kg de créatine). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Contenu déplié d'un nutriment : les quatre mêmes questions pour tous, dans le
 * même ordre, précédées du niveau de preuve. C'est ici qu'ont été rapatriés les
 * anciens panneaux « AG saturés » et « Fer » — un pavé par nutriment tout en
 * haut de la page ne passait pas à l'échelle de 37 lignes, et personne n'allait
 * chercher le fer en bas de page alors que sa tuile est dans le bilan.
 */
function NutrientDetail({ t, def, ctl }: { t: Target; def: Target; ctl: TargetControl }) {
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

      <TargetEditor t={t} def={def} ctl={ctl} />
      <ImportanceSetting t={t} />
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

/**
 * Poids du nutriment dans les recommandations et les conseils du jour. Il vivait
 * sur la ligne, à côté du nom ; il en est descendu ici parce qu'il répond à une
 * question rare (« ce nutriment compte-t-il pour moi ? ») quand la ligne, elle,
 * doit répondre à la question courante : « quelle est ma cible ? ».
 */
function ImportanceSetting({ t }: { t: Target }) {
  const overrides = useStore((s) => s.nutrientImportance);
  const setNutrientImportance = useStore((s) => s.setNutrientImportance);
  const resetNutrientImportance = useStore((s) => s.resetNutrientImportance);
  const val = effectiveImportance(t.key, overrides);
  const overridden = overrides[t.key] !== undefined;

  return (
    <div className="imp-setting">
      <span className="small imp-label">Importance</span>
      <input
        type="range"
        min={IMPORTANCE_BOUNDS.min}
        max={IMPORTANCE_BOUNDS.max}
        step={IMPORTANCE_BOUNDS.step}
        value={val}
        onChange={(e) => setNutrientImportance(t.key, Number(e.target.value))}
        aria-label={`Importance : ${t.label}`}
      />
      <span className="mono small imp-val" style={val === 0 ? { color: 'var(--muted)' } : undefined}>
        ×{fmt(val, 1)}
      </span>
      <button
        className="ghost small importance-reset"
        style={{ visibility: overridden ? 'visible' : 'hidden' }}
        onClick={() => resetNutrientImportance(t.key)}
        data-tip="Revenir au défaut"
        aria-label={`Réinitialiser l'importance : ${t.label}`}
      >
        ↺
      </button>
      <span className="small imp-hint">
        ×0 = ignoré dans les conseils · ×1 = normal · ×3 = prioritaire
      </span>
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
 * Une ligne du réglage : le nom (cliquable, déplie tout le reste) et le curseur
 * de cible. C'est la seule chose qu'on règle souvent, donc la seule chose
 * visible sans déplier.
 */
function NutrientRow({ t, def, open, onToggle }: { t: Target; def: Target; open: boolean; onToggle: () => void }) {
  const ctl = useNutrientTarget(t);
  return (
    <div className="nutrient-item">
      {/* Sous-détail (C16+C14, stéarique) : décalé sous son parent pour qu'on lise
          « ce sont des morceaux d'AG saturés », pas trois nutriments indépendants. */}
      <div className={`importance-row${t.parent ? ' is-sub' : ''}`}>
        <button className="importance-label nutrient-toggle" data-tip={t.role} aria-expanded={open} onClick={onToggle}>
          <span className="nutrient-caret">{open ? '▾' : '▸'}</span> {t.label}
          {ctl.tuned && (
            <span className="te-flag" data-tip="Cible personnalisée">
              ✎
            </span>
          )}
        </button>
        <TargetSlider t={t} def={def} ctl={ctl} />
        <button
          className="ghost small importance-reset"
          style={{ visibility: ctl.tuned ? 'visible' : 'hidden' }}
          onClick={ctl.reset}
          data-tip="Revenir aux cibles conseillées"
          aria-label={`Réinitialiser les cibles : ${t.label}`}
        >
          ↺
        </button>
      </div>
      {open && <NutrientDetail t={t} def={def} ctl={ctl} />}
    </div>
  );
}

/**
 * Cœur de la page : une ligne par nutriment, groupée par famille. La ligne porte
 * le nom et le curseur de CIBLE — le seul réglage qu'on vient changer souvent.
 * Tout le reste (valeurs exactes, unité par kilo, poids du nutriment dans les
 * conseils, et le texte qui explique à quoi il sert) se déplie au clic sur le nom.
 */
function NutrientSettingsPanel({ targets }: { targets: Target[] }) {
  const overrides = useStore((s) => s.nutrientImportance);
  const resetAllNutrientImportance = useStore((s) => s.resetAllNutrientImportance);
  const nutrientTargets = useStore((s) => s.nutrientTargets);
  const resetAllNutrientTargets = useStore((s) => s.resetAllNutrientTargets);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const defaults = useDefaultTargets();
  const defaultByKey = useMemo(() => new Map(defaults.map((t) => [t.key, t])), [defaults]);
  const [expanded, setExpanded] = useState<NutrientKey | null>(null);

  const hasOverrides = Object.keys(overrides).length > 0;
  // Les protéines comptent aussi quand leur réglage vit dans le profil : sans
  // ça, le résumé annoncerait « tout aux valeurs conseillées » avec un ✎ affiché
  // juste en dessous.
  const nTargets = countTargetOverrides(nutrientTargets) + (profile.protParKg != null && !hasTargetOverride(nutrientTargets.proteines) ? 1 : 0);

  // Ce qui est écrit sur la ligne repliée : l'état des réglages. « 3 modifiés »
  // suffit à savoir qu'on a touché à quelque chose ; sans ce compte, il faudrait
  // déplier 42 curseurs pour le vérifier.
  const nImportances = Object.keys(overrides).length;
  const summary =
    nImportances === 0 && nTargets === 0
      ? 'tout aux valeurs conseillées'
      : [
          nImportances > 0 ? `${nImportances} importance${nImportances > 1 ? 's' : ''}` : null,
          nTargets > 0 ? `${nTargets} cible${nTargets > 1 ? 's' : ''}` : null,
        ]
          .filter(Boolean)
          .join(' · ') + ' modifiée(s)';

  return (
    <Section
      id="nutriments-reglages"
      title="Comprendre & régler chaque nutriment"
      summary={summary}
      defaultOpen={true}
      head={
        (hasOverrides || nTargets > 0) && (
          <span className="row" style={{ gap: 6 }}>
            {hasOverrides && (
              <button className="ghost small" onClick={resetAllNutrientImportance}>
                Réinitialiser les importances
              </button>
            )}
            {nTargets > 0 && (
              <button
                className="ghost small"
                onClick={() => {
                  resetAllNutrientTargets();
                  setProfile({ protParKg: undefined });
                }}
              >
                Réinitialiser les cibles
              </button>
            )}
          </span>
        )
      }
    >
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
        Le curseur de chaque ligne porte les <strong>deux repères</strong> du nutriment : la poignée basse (AJR, ou
        cible idéale pour un nutriment à limiter) et la poignée haute (optimal, ou plafond). Les traits sur le rail
        marquent les valeurs conseillées. Pour un chiffre précis, l'unité en g/kg ou le poids du nutriment dans les
        conseils, dépliez son nom.
      </div>

      {NUTRIENT_GROUPS.map((g) => {
        const keys = g.keys.filter((k) => k !== 'kcal' && targetByKey.has(k));
        if (keys.length === 0) return null;
        return (
          <div className="importance-group" key={g.title}>
            {/* L'en-tête de famille n'a plus de curseur : il réglait l'importance
                de tout le groupe, et l'importance a quitté la ligne. */}
            <div className="importance-group-head">
              <span className="gh">{g.title}</span>
            </div>
            {keys.map((k) => (
              <NutrientRow
                key={k}
                t={targetByKey.get(k)!}
                def={defaultByKey.get(k) ?? targetByKey.get(k)!}
                open={expanded === k}
                onToggle={() => setExpanded((cur) => (cur === k ? null : k))}
              />
            ))}
          </div>
        );
      })}
    </Section>
  );
}
