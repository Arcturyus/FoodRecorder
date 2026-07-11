/**
 * Exposition au soleil → estimation du gain de vitamine D (µg).
 *
 * Le soleil n'est pas un aliment : les expositions sont enregistrées à part
 * (section « Soleil ») et leur gain estimé s'ajoute à la vitamine D du bilan.
 *
 * Modèle volontairement simple, calibré pour la France métropolitaine
 * (latitude ~44–50° N) sur les ordres de grandeur usuels de la littérature :
 * ~15 min de soleil d'été à la mi-journée, visage + avant-bras découverts, peau
 * claire ≈ 25 µg (1000 UI). La synthèse plafonne (la pré-vitamine D se dégrade
 * sous UV), d'où des rendements décroissants sur la durée et un plafond
 * journalier. De novembre à février, les UVB sont trop rasants : gain quasi nul.
 *
 * Formule :
 *   Gain = BASE_RATE × f_durée × f_saison × f_heure × f_ciel × f_peau
 *          × f_phénotype × f_crème
 * (f_durée est en « minutes efficaces », les autres sont des facteurs 0–~2).
 */

export type SkyCondition = 'tres-ensoleille' | 'ensoleille' | 'voile' | 'nuageux' | 'couvert';
export type SkinExposure = 'visage-mains' | 'visage-bras' | 'bras-jambes' | 'torse-nu';
export type Phenotype = 'blanc' | 'bronze' | 'mat' | 'noir';

/** Une sortie au soleil enregistrée (journée `date`). */
export interface SunExposure {
  id: string;
  date: string; // YYYY-MM-DD
  heure: string; // HH:MM (milieu approximatif de la sortie)
  dureeMin: number; // durée approximative, minutes
  ciel: SkyCondition;
  peau: SkinExposure;
  /** Phototype de peau (par défaut « blanc »). */
  phenotype: Phenotype;
  /** Crème solaire SPF 50 (posée une fois au début, moyennement bien appliquée). */
  creme: boolean;
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
 * Facteur global sur la session (bien moins protecteur qu'un SPF 50 idéal).
 */
export const SUNSCREEN_FACTOR = 0.4;

/** Créneaux horaires pratiques proposés en un clic (heure ≈ milieu de sortie). */
export const TIME_PRESETS: { label: string; heure: string }[] = [
  { label: 'Matin', heure: '08:00' },
  { label: 'Fin de matinée', heure: '11:00' },
  { label: 'Midi', heure: '13:00' },
  { label: 'Après-midi', heure: '15:00' },
  { label: 'Fin d’après-midi', heure: '17:00' },
];

/** µg/min en conditions optimales (été, midi solaire, ciel dégagé, visage + bras, peau claire). */
const BASE_RATE = 1.7;

/** La synthèse sature : au-delà, chaque minute rapporte de moins en moins. */
const SATURATION_MIN = 60;

/** Plafond journalier (µg) toutes expositions confondues. */
export const SUN_DAY_CAP = 150;

/**
 * Facteur saisonnier France (janv → déc) : intensité UVB relative à la
 * mi-journée. Quasi nul de novembre à février (« hiver de la vitamine D »).
 */
const MONTH_FACTOR = [0.03, 0.08, 0.3, 0.6, 0.85, 1, 1, 0.9, 0.65, 0.35, 0.08, 0.03];

/**
 * Facteur horaire : les UVB utiles sont concentrés autour du midi solaire
 * (~13 h 30 en heure d'été française). Fenêtre efficace ≈ 10 h – 17 h.
 */
export function hourFactor(heure: string): number {
  const [h, m] = heure.split(':').map(Number);
  if (!Number.isFinite(h)) return 0;
  const t = h + (Number.isFinite(m) ? m / 60 : 0);
  const dist = Math.abs(t - 13.5);
  if (dist >= 5.5) return 0;
  // Cloche en cosinus : 1 au midi solaire, 0 à ±5,5 h.
  return Math.pow(Math.cos((dist / 5.5) * (Math.PI / 2)), 1.5);
}

export function monthFactor(date: string): number {
  const month = Number(date.slice(5, 7));
  return MONTH_FACTOR[(month || 1) - 1] ?? 0;
}

/** Minutes « efficaces » avec rendements décroissants (plateau de synthèse). */
export function effectiveMinutes(dureeMin: number): number {
  if (dureeMin <= 0) return 0;
  return SATURATION_MIN * (1 - Math.exp(-dureeMin / SATURATION_MIN));
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

/** Décompose le calcul en facteurs (formule affichée avec valeurs au survol). */
export function vitaminDBreakdown(e: SunInput): { base: number; factors: VitDFactor[]; gain: number; capped: boolean } {
  const dureeEff = effectiveMinutes(e.dureeMin);
  const fSaison = monthFactor(e.date);
  const fHeure = hourFactor(e.heure);
  const fCiel = skyFactor(e.ciel);
  const fPeau = skinFactor(e.peau);
  const fPheno = phenotypeFactor(e.phenotype);
  const fCreme = e.creme ? SUNSCREEN_FACTOR : 1;

  const raw = BASE_RATE * dureeEff * fSaison * fHeure * fCiel * fPeau * fPheno * fCreme;
  const gain = Math.min(raw, SUN_DAY_CAP);

  const factors: VitDFactor[] = [
    { key: 'duree', symbol: 'f_durée', label: 'Durée', icon: '⏱️', value: dureeEff, gauge: Math.min(1, dureeEff / SATURATION_MIN), display: `${dureeEff.toFixed(0)} min eff.`, detail: `${e.dureeMin} min réelles → ${dureeEff.toFixed(0)} min efficaces. La synthèse plafonne au-delà de ~1 h : les minutes suivantes rapportent de moins en moins.` },
    { key: 'saison', symbol: 'f_saison', label: 'Saison', icon: '📅', value: fSaison, gauge: fSaison, display: `×${fSaison.toFixed(2)}`, detail: 'Intensité UVB du mois en France métropolitaine. Quasi nulle de novembre à février (« hiver de la vitamine D »), maximale en juin-juillet.' },
    { key: 'heure', symbol: 'f_heure', label: 'Heure', icon: '🕐', value: fHeure, gauge: fHeure, display: `×${fHeure.toFixed(2)}`, detail: 'Fenêtre UVB utile ~10 h–17 h, maximale autour du midi solaire (~13 h 30 en heure d’été). Le matin et le soir, les rayons sont trop rasants.' },
    { key: 'ciel', symbol: 'f_ciel', label: 'Ciel', icon: '☁️', value: fCiel, gauge: fCiel, display: `×${fCiel.toFixed(2)}`, detail: `${SKY_OPTIONS.find((o) => o.value === e.ciel)?.label ?? ''}. Les nuages et la brume filtrent une part des UVB.` },
    { key: 'peau', symbol: 'f_peau', label: 'Peau découverte', icon: '👕', value: fPeau, gauge: Math.min(1, fPeau / 2.2), display: `×${fPeau.toFixed(2)}`, detail: `${SKIN_OPTIONS.find((o) => o.value === e.peau)?.label ?? ''}. Plus la surface de peau exposée est grande, plus la synthèse est élevée.` },
    { key: 'phenotype', symbol: 'f_phéno', label: 'Phototype', icon: '🧑', value: fPheno, gauge: fPheno, display: `×${fPheno.toFixed(2)}`, detail: `${PHENOTYPE_OPTIONS.find((o) => o.value === (e.phenotype ?? 'blanc'))?.label} : la mélanine protège des UV, donc plus la peau est foncée, moins elle synthétise à exposition égale.` },
    { key: 'creme', symbol: 'f_crème', label: 'Crème solaire', icon: '🧴', value: fCreme, gauge: fCreme, display: `×${fCreme.toFixed(2)}`, detail: e.creme ? 'SPF 50 posé une seule fois et moyennement appliqué : bloque une bonne part des UVB, mais s’estompe (sueur, temps, sous-dosage).' : 'Aucune crème : rien ne filtre les UVB.' },
  ];

  return { base: BASE_RATE, factors, gain, capped: raw > SUN_DAY_CAP };
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
