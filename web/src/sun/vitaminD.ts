/**
 * Exposition au soleil → estimation du gain de vitamine D (µg).
 *
 * Le soleil n'est pas un aliment : les expositions sont enregistrées à part
 * (section « Soleil ») et leur gain estimé s'ajoute à la vitamine D du bilan.
 *
 * Modèle volontairement simple, calibré pour la France métropolitaine
 * (latitude ~44–50° N) sur les ordres de grandeur usuels de la littérature :
 * ~15 min de soleil d'été à la mi-journée, visage + avant-bras découverts, peau
 * claire ≈ 25 µg (1000 UI). De novembre à février, les UVB sont trop rasants :
 * gain quasi nul.
 *
 * Les facteurs ne sont PAS indépendants, le modèle les interconnecte :
 *  - heure × durée : l'intensité UVB est INTÉGRÉE sur toute la sortie (3 h
 *    démarrées à 9 h traversent le pic de midi ; 3 h démarrées à 16 h finissent
 *    hors fenêtre) ;
 *  - saison × heure : la fenêtre horaire utile se referme hors été (±5,5 h
 *    autour du midi solaire en juillet, ±~2,6 h en janvier) ;
 *  - saturation × dose : la pré-vitamine D se dégrade avec la DOSE d'UV reçue,
 *    pas avec l'horloge — un soleil faible (hiver, nuages, peau foncée, crème)
 *    sature plus lentement, donc une peau foncée synthétise moins vite mais
 *    tend vers le même plateau si l'exposition dure ;
 *  - crème « visage » × peau découverte : seule la surface crémée est freinée
 *    (et elle sature aussi plus lentement), l'effet est donc d'autant plus fort
 *    que la peau exposée est petite.
 *
 * Formule :
 *   dose  = ∫ f_heure(t) dt × f_saison × f_ciel × f_phénotype   (min « plein midi »)
 *   gain  = BASE_RATE × Σ_zones surface × saturation(dose × f_crème_zone)
 * Le détail affiché (vitaminDBreakdown) redéfinit les facteurs pour que
 * base × produit reconstitue exactement ce gain.
 */

export type SkyCondition = 'tres-ensoleille' | 'ensoleille' | 'voile' | 'nuageux' | 'couvert';
export type SkinExposure = 'visage-mains' | 'visage-bras' | 'bras-jambes' | 'torse-nu';
export type Phenotype = 'blanc' | 'bronze' | 'mat' | 'noir';
/**
 * Crème solaire posée : aucune, sur le visage seulement (cas courant du SPF
 * quotidien « anti-âge » où le corps reste exposé), ou complète (tout le corps).
 */
export type Creme = 'aucune' | 'visage' | 'complete';

/** Une sortie au soleil enregistrée (journée `date`). */
export interface SunExposure {
  id: string;
  date: string; // YYYY-MM-DD
  heure: string; // HH:MM (début de la sortie)
  dureeMin: number; // durée approximative, minutes
  ciel: SkyCondition;
  peau: SkinExposure;
  /** Phototype de peau (par défaut « blanc »). */
  phenotype: Phenotype;
  /**
   * Crème solaire SPF 50 (posée une fois au début, moyennement bien appliquée).
   * Ancien format booléen encore accepté en lecture (true = « complete »).
   */
  creme: Creme;
  createdAt: number;
}

export const SKY_OPTIONS: { value: SkyCondition; label: string; short: string; factor: number }[] = [
  { value: 'tres-ensoleille', label: 'Très ensoleillé', short: '☀️ Grand soleil', factor: 1 },
  { value: 'ensoleille', label: 'Ensoleillé', short: '🌤️ Ensoleillé', factor: 0.85 },
  { value: 'voile', label: 'Ciel voilé', short: '🌥️ Voilé', factor: 0.55 },
  { value: 'nuageux', label: 'Nuageux', short: '☁️ Nuageux', factor: 0.3 },
  { value: 'couvert', label: 'Très couvert', short: '🌫️ Couvert', factor: 0.1 },
];

export const SKIN_OPTIONS: { value: SkinExposure; label: string; short: string; factor: number }[] = [
  { value: 'visage-mains', label: 'Visage et mains', short: 'Visage/mains', factor: 0.4 },
  { value: 'visage-bras', label: 'Visage + bras (t-shirt)', short: 'T-shirt', factor: 1 },
  { value: 'bras-jambes', label: 'Bras et jambes (short)', short: 'Short', factor: 1.6 },
  { value: 'torse-nu', label: 'Torse nu / maillot', short: 'Maillot', factor: 2.2 },
];

export const PHENOTYPE_OPTIONS: { value: Phenotype; label: string; factor: number }[] = [
  { value: 'blanc', label: 'Peau claire', factor: 1 },
  { value: 'bronze', label: 'Peau bronzée', factor: 0.7 },
  { value: 'mat', label: 'Peau mate', factor: 0.5 },
  { value: 'noir', label: 'Peau foncée', factor: 0.3 },
];

/**
 * Crème SPF 50 posée UNE fois au début et moyennement bien appliquée : bloque
 * une bonne part des UVB au départ mais s'estompe (sueur, temps, sous-dosage).
 * Facteur appliqué à la peau protégée (bien moins protecteur qu'un SPF 50 idéal).
 */
export const SUNSCREEN_FACTOR = 0.4;

/**
 * Surface relative du visage seul, dans les mêmes unités que `SKIN_OPTIONS.factor`
 * (où « visage + bras » vaut 1). Sert à modéliser une crème posée uniquement sur
 * le visage : seule cette petite surface est protégée, le reste de la peau
 * découverte continue de synthétiser normalement — l'effet est donc d'autant plus
 * faible que la peau exposée est grande (torse nu ≫ visage/mains).
 */
export const FACE_SURFACE = 0.25;

export const CREME_OPTIONS: { value: Creme; label: string; short: string; icon: string }[] = [
  { value: 'aucune', label: 'Aucune', short: 'Aucune', icon: '' },
  { value: 'visage', label: 'Visage seulement', short: '🧴 Visage', icon: '🧴' },
  { value: 'complete', label: 'Complète (tout le corps)', short: '🧴 Complète', icon: '🧴' },
];

/** Tolère l'ancien format booléen (true = crème complète) et l'absence de valeur. */
export function normalizeCreme(c: Creme | boolean | undefined | null): Creme {
  if (c === true) return 'complete';
  if (c === false || c == null) return 'aucune';
  return c;
}

/** Champs qu'une dictée peut renseigner (structurellement : `SunPatch`). */
export type SunPatchLike = Partial<
  Pick<SunExposure, 'date' | 'heure' | 'dureeMin' | 'ciel' | 'peau' | 'phenotype' | 'creme'>
>;

/** Toutes les valeurs d'une sortie, servant de fond à une dictée partielle. */
export type SunDefaults = Omit<SunExposure, 'id' | 'createdAt'>;

/**
 * Réglages retenus quand rien n'est dit ni affiché à l'écran (synchro entre
 * appareils : le poste qui analyse n'a pas le formulaire de celui qui a dicté).
 * Volontairement prudents : sans précision, on suppose un ciel moyen et une
 * tenue courante plutôt que les conditions les plus généreuses.
 */
export const SUN_FALLBACK: Omit<SunDefaults, 'date'> = {
  heure: '13:00',
  dureeMin: 30,
  ciel: 'ensoleille',
  peau: 'visage-bras',
  phenotype: 'blanc',
  creme: 'aucune',
};

/** Bornes du curseur de durée (une sortie enregistrée reste dans cette plage). */
const MIN_DUREE = 5;
const MAX_DUREE = 240;

/**
 * Complète une sortie dictée (partielle) avec des valeurs par défaut : l'IA ne
 * renseigne que ce qui a été dit, le reste vient du formulaire (UI) ou de
 * `SUN_FALLBACK` (synchro). `ignoreDate` : le jour est imposé par l'écran
 * (édition d'un jour passé), la date dictée est alors écartée.
 */
export function completeSunExposure(p: SunPatchLike, defaults: SunDefaults, ignoreDate = false): SunDefaults {
  return {
    date: !ignoreDate && p.date ? p.date : defaults.date,
    heure: p.heure ?? defaults.heure,
    dureeMin: Math.min(MAX_DUREE, Math.max(MIN_DUREE, Math.round(p.dureeMin ?? defaults.dureeMin))),
    ciel: p.ciel ?? defaults.ciel,
    peau: p.peau ?? defaults.peau,
    phenotype: p.phenotype ?? defaults.phenotype,
    creme: p.creme != null ? normalizeCreme(p.creme) : defaults.creme,
  };
}

/**
 * Surface de peau crémée (dans les unités de `SKIN_OPTIONS.factor`) : toute la
 * peau découverte en crème « complète », seulement le visage en crème « visage »
 * (le reste continue de synthétiser normalement — interconnexion crème × peau).
 */
function cremedSurface(creme: Creme, fPeau: number): number {
  if (creme === 'complete') return fPeau;
  if (creme === 'visage') return Math.min(FACE_SURFACE, fPeau);
  return 0;
}

/** Créneaux horaires pratiques proposés en un clic (heure = début de sortie). */
export const TIME_PRESETS: { label: string; heure: string }[] = [
  { label: 'Matin', heure: '08:00' },
  { label: 'Fin de matinée', heure: '11:00' },
  { label: 'Midi', heure: '13:00' },
  { label: 'Après-midi', heure: '15:00' },
  { label: 'Fin d’après-midi', heure: '17:00' },
];

/** µg/min en conditions optimales (été, midi solaire, ciel dégagé, visage + bras, peau claire). */
const BASE_RATE = 1.7;

/**
 * La synthèse sature : au-delà de ~60 min de dose « plein midi » équivalente,
 * chaque minute rapporte de moins en moins (cf. saturate()).
 */
const SATURATION_MIN = 60;

/** Plafond journalier (µg) toutes expositions confondues. */
export const SUN_DAY_CAP = 150;

/**
 * Facteur saisonnier France (janv → déc) : intensité UVB relative à la
 * mi-journée. Quasi nul de novembre à février (« hiver de la vitamine D »).
 */
const MONTH_FACTOR = [0.03, 0.08, 0.3, 0.6, 0.85, 1, 1, 0.9, 0.65, 0.35, 0.08, 0.03];

/** Heure décimale depuis « HH:MM » (null si illisible). */
function parseHour(heure: string): number | null {
  const [h, m] = heure.split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return h + (Number.isFinite(m) ? m / 60 : 0);
}

/**
 * Interconnexion saison × heure : demi-largeur (en heures autour du midi
 * solaire ~13 h 30) de la fenêtre UVB utile. Été : ±5,5 h ; cœur de l'hiver :
 * ±~2,6 h — hors été le soleil est trop rasant en dehors du milieu de journée.
 */
export function windowHalfWidth(fSaison: number): number {
  return 2.5 + 3 * fSaison;
}

/** Intensité UVB relative à l'instant `t` (heure décimale), cloche en cosinus. */
function hourFactorAt(t: number, halfWidth: number): number {
  const dist = Math.abs(t - 13.5);
  if (dist >= halfWidth) return 0;
  return Math.pow(Math.cos((dist / halfWidth) * (Math.PI / 2)), 1.5);
}

/** Facteur horaire instantané au début de la sortie (fenêtre ajustée à la saison). */
export function hourFactor(heure: string, fSaison = 1): number {
  const t = parseHour(heure);
  return t == null ? 0 : hourFactorAt(t, windowHalfWidth(fSaison));
}

/**
 * Interconnexion heure × durée : minutes « équivalent plein midi » reçues sur
 * TOUTE la sortie — intégrale du facteur horaire de `heure` (début) à
 * `heure + dureeMin`. Une sortie longue traverse des heures plus ou moins
 * efficaces au lieu d'être jugée sur son seul point de départ.
 */
export function hourIntegral(heure: string, dureeMin: number, fSaison: number): number {
  const t0 = parseHour(heure);
  if (t0 == null || dureeMin <= 0) return 0;
  const w = windowHalfWidth(fSaison);
  let sum = 0;
  for (let k = 0; k < dureeMin; k++) sum += hourFactorAt(t0 + (k + 0.5) / 60, w);
  return sum;
}

export function monthFactor(date: string): number {
  const month = Number(date.slice(5, 7));
  return MONTH_FACTOR[(month || 1) - 1] ?? 0;
}

/**
 * Interconnexion saturation × dose : minutes de synthèse effectives pour une
 * dose d'UV donnée (en minutes « optimales » équivalentes). La pré-vitamine D
 * se dégrade avec la dose reçue, pas avec l'horloge : par soleil faible la
 * saturation arrive plus tard, chaque minute garde sa valeur plus longtemps.
 */
export function saturate(dose: number): number {
  if (dose <= 0) return 0;
  return SATURATION_MIN * (1 - Math.exp(-dose / SATURATION_MIN));
}

function skyFactor(ciel: SkyCondition): number {
  return SKY_OPTIONS.find((o) => o.value === ciel)?.factor ?? 0;
}
function skinFactor(peau: SkinExposure): number {
  return SKIN_OPTIONS.find((o) => o.value === peau)?.factor ?? 0;
}
function phenotypeFactor(phenotype: Phenotype | undefined): number {
  return PHENOTYPE_OPTIONS.find((o) => o.value === (phenotype ?? 'blanc'))?.factor ?? 1;
}

type SunInput = Pick<SunExposure, 'date' | 'heure' | 'dureeMin' | 'ciel' | 'peau'> &
  Partial<Pick<SunExposure, 'phenotype' | 'creme'>>;

/** Un terme de la formule, pour l'affichage détaillé (hover). */
export interface VitDFactor {
  key: string;
  symbol: string;
  label: string;
  value: number;
  /** Formatage lisible de la valeur (ex. « ×0,85 », « 12 min eff. »). */
  display: string;
  detail: string;
  /** Force relative du terme (0–1) pour la jauge visuelle du survol. */
  gauge: number;
  /** Émoji d'illustration. */
  icon: string;
}

/** « 15:45 » pour l'heure décimale 15,75 (affichage de la fin de sortie). */
function fmtHour(t: number): string {
  const tt = ((t % 24) + 24) % 24;
  const h = Math.floor(tt);
  const m = Math.round((tt - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Décompose le calcul en facteurs (formule affichée avec valeurs au survol). */
export function vitaminDBreakdown(e: SunInput): { base: number; factors: VitDFactor[]; gain: number; capped: boolean } {
  const fSaison = monthFactor(e.date);
  const fCiel = skyFactor(e.ciel);
  const fPeau = skinFactor(e.peau);
  const fPheno = phenotypeFactor(e.phenotype);
  const creme = normalizeCreme(e.creme);

  // Heure × durée : intensité horaire intégrée sur toute la sortie, fenêtre
  // resserrée hors été (saison × heure). fHeure = intensité moyenne subie.
  const hInt = hourIntegral(e.heure, e.dureeMin, fSaison);
  const fHeure = e.dureeMin > 0 ? hInt / e.dureeMin : 0;

  // Dose d'UV reçue par la peau nue (minutes « optimales » équivalentes) : c'est
  // elle qui pilote la saturation, donc un soleil faible sature plus lentement.
  const dose = hInt * fSaison * fCiel * fPheno;

  // Zones crémée / nue : chacune sature selon sa propre dose (crème × durée).
  const cremed = cremedSurface(creme, fPeau);
  const bare = fPeau - cremed;
  const satBare = saturate(dose);
  const satCremed = saturate(dose * SUNSCREEN_FACTOR);
  const raw = BASE_RATE * (bare * satBare + cremed * satCremed);
  const gain = Math.min(raw, SUN_DAY_CAP);

  // Facteurs affichés, redéfinis pour que base × produit == gain (hors plafond) :
  //  - f_durée = minutes « utiles » après saturation, ramenées aux conditions
  //    (durée × sat(dose)/dose) — dépend donc AUSSI du ciel/saison/phototype ;
  //  - f_crème = ratio réel avec/sans crème (zones + saturation comprises).
  const dureeEff = dose > 0 ? (e.dureeMin * satBare) / dose : 0;
  const fCreme = fPeau > 0 && satBare > 0 ? (bare * satBare + cremed * satCremed) / (fPeau * satBare) : 1;

  const t0 = parseHour(e.heure);
  const sessionStr = t0 == null ? '' : ` (${e.heure} → ${fmtHour(t0 + e.dureeMin / 60)})`;
  const windowStr = `±${windowHalfWidth(fSaison).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h autour de ~13 h 30`;

  const factors: VitDFactor[] = [
    { key: 'duree', symbol: 'f_durée', label: 'Durée', icon: '⏱️', value: dureeEff, gauge: Math.min(1, dureeEff / SATURATION_MIN), display: `${dureeEff.toFixed(0)} min eff.`, detail: `${e.dureeMin} min réelles → ${dureeEff.toFixed(0)} min utiles. La synthèse sature avec la dose d'UV reçue (~1 h « plein midi ») : par soleil faible (hiver, nuages, peau foncée, crème), elle sature plus lentement et chaque minute garde sa valeur plus longtemps.` },
    { key: 'saison', symbol: 'f_saison', label: 'Saison', icon: '📅', value: fSaison, gauge: fSaison, display: `×${fSaison.toFixed(2)}`, detail: 'Intensité UVB du mois en France métropolitaine. Quasi nulle de novembre à février (« hiver de la vitamine D »), maximale en juin-juillet. Elle resserre aussi la fenêtre horaire utile.' },
    { key: 'heure', symbol: 'f_heure', label: 'Heure', icon: '🕐', value: fHeure, gauge: fHeure, display: `×${fHeure.toFixed(2)}`, detail: `Intensité moyenne sur toute la sortie${sessionStr}, pas seulement au départ : une sortie longue traverse des heures plus ou moins efficaces. Fenêtre utile de saison : ${windowStr}.` },
    { key: 'ciel', symbol: 'f_ciel', label: 'Ciel', icon: '☁️', value: fCiel, gauge: fCiel, display: `×${fCiel.toFixed(2)}`, detail: `${SKY_OPTIONS.find((o) => o.value === e.ciel)?.label ?? ''}. Les nuages et la brume filtrent une part des UVB (et retardent d'autant la saturation).` },
    { key: 'peau', symbol: 'f_peau', label: 'Peau découverte', icon: '👕', value: fPeau, gauge: Math.min(1, fPeau / 2.2), display: `×${fPeau.toFixed(2)}`, detail: `${SKIN_OPTIONS.find((o) => o.value === e.peau)?.label ?? ''}. Plus la surface de peau exposée est grande, plus la synthèse est élevée.` },
    { key: 'phenotype', symbol: 'f_phéno', label: 'Phototype', icon: '🧑', value: fPheno, gauge: fPheno, display: `×${fPheno.toFixed(2)}`, detail: `${PHENOTYPE_OPTIONS.find((o) => o.value === (e.phenotype ?? 'blanc'))?.label} : la mélanine filtre les UV — synthèse plus lente à exposition égale, mais qui sature aussi plus tard (une exposition longue rattrape une partie de l'écart).` },
    { key: 'creme', symbol: 'f_crème', label: 'Crème solaire', icon: '🧴', value: fCreme, gauge: fCreme, display: `×${fCreme.toFixed(2)}`, detail: cremeDetail(creme) },
  ];

  return { base: BASE_RATE, factors, gain, capped: raw > SUN_DAY_CAP };
}

/** Détail affiché (survol) du facteur crème selon la zone protégée. */
function cremeDetail(creme: Creme): string {
  if (creme === 'complete') {
    return 'SPF 50 sur tout le corps, posé une seule fois et moyennement appliqué : bloque une bonne part des UVB, mais s’estompe (sueur, temps, sous-dosage). La peau crémée sature aussi plus tard : sur une sortie longue, la crème coûte un peu moins que son filtre.';
  }
  if (creme === 'visage') {
    return 'Crème sur le visage seulement : seule cette petite surface est protégée, le reste de la peau découverte continue de synthétiser. L’effet est donc faible (et d’autant plus faible que la peau exposée est grande).';
  }
  return 'Aucune crème : rien ne filtre les UVB.';
}

/** Gain estimé (µg) d'une exposition. Ordre de grandeur, pas une mesure. */
export function estimateVitaminD(e: SunInput): number {
  return vitaminDBreakdown(e).gain;
}

/** Gain total (µg) d'un jour, plafonné (la synthèse ne s'additionne pas à l'infini). */
export function sunVitDForDate(exposures: SunExposure[], date: string): number {
  const total = exposures
    .filter((e) => e.date === date)
    .reduce((a, e) => a + estimateVitaminD(e), 0);
  return Math.min(total, SUN_DAY_CAP);
}

/** Note saisonnière affichée sous le formulaire (attentes réalistes). */
export function seasonHint(date: string): string | null {
  const month = Number(date.slice(5, 7));
  if (month >= 11 || month <= 2) {
    return 'De novembre à février en France, les UVB sont trop faibles : la synthèse de vitamine D est quasi nulle, même par beau temps.';
  }
  if (month === 3 || month === 10) {
    return 'En mi-saison, seule la tranche 11 h – 15 h apporte un gain notable de vitamine D.';
  }
  return null;
}
