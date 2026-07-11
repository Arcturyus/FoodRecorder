/**
 * Statut vitamine D : interprète les apports quotidiens (alimentation + soleil)
 * comme un flux d'entrée (µg/j) lissé sur ~4 semaines.
 *
 * Pourquoi une fenêtre longue et pondérée ? La demi-vie de la 25(OH)D est de
 * ~2–3 semaines : le corps « oublie » lentement. Une moyenne glissante pondérée
 * par la récence (demi-vie 21 j) sur 28 jours reproduit cette inertie — et,
 * étant lente, elle n'oscille pas d'un jour à l'autre autour des seuils (c'est
 * l'anti-oscillation demandée, obtenue par le lissage plutôt qu'un état stocké).
 */

export const VITD_WINDOW_DAYS = 28;
const HALF_LIFE_DAYS = 21;

/** Seuils d'interprétation du flux moyen (µg/j). */
export const VITD_LOW = 8; // en dessous : risque de carence élevé
export const VITD_OK = 15; // au-dessus : apport suffisant

export type VitDZone = 'low' | 'mid' | 'ok';
export type VitDTrend = 'up' | 'down' | 'flat';

export interface VitDFlux {
  /** Moyenne pondérée récence sur la fenêtre (µg/j). */
  weightedAvg: number;
  zone: VitDZone;
  statusLabel: string;
  advice: string;
  trend: VitDTrend;
  /** Nombre de jours (avec données) pris en compte. */
  nDays: number;
  windowDays: number;
}

function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}

function zoneOf(avg: number): VitDZone {
  if (avg >= VITD_OK) return 'ok';
  if (avg < VITD_LOW) return 'low';
  return 'mid';
}

const ADVICE: Record<VitDZone, { label: string; advice: string }> = {
  ok: {
    label: 'apport suffisant',
    advice: 'Apports (soleil + alimentation) au-dessus de ~15 µg/j : inutile de supplémenter tant que ce niveau tient.',
  },
  mid: {
    label: 'apport intermédiaire',
    advice: 'Zone grise (8–15 µg/j) : sans risque immédiat, mais une supplémentation d’appoint (~1000–2000 UI/j) est raisonnable, surtout d’octobre à mars où le soleil ne suffit pas.',
  },
  low: {
    label: 'apport faible',
    advice: 'Sous 8 µg/j : risque de carence élevé sur la durée. Une supplémentation (≈2000 UI/j) est recommandée, surtout en hiver.',
  },
};

/**
 * Calcule le flux vitamine D moyen pondéré et son interprétation.
 * `dailyVitD` : apport total (alimentation + soleil) par jour ENREGISTRÉ
 * (les jours absents = données inconnues, exclus du calcul). `null` si aucun jour.
 */
export function vitaminDFlux(
  dailyVitD: Map<string, number>,
  today: string,
  windowDays = VITD_WINDOW_DAYS,
): VitDFlux | null {
  const DAY = 86_400_000;
  const base = new Date(`${today}T12:00:00`).getTime();

  let wSum = 0;
  let wvSum = 0;
  let nDays = 0;
  const half = Math.floor(windowDays / 2);
  const recent: number[] = [];
  const older: number[] = [];

  for (let k = 0; k < windowDays; k++) {
    const d = localDate(new Date(base - k * DAY));
    const v = dailyVitD.get(d);
    if (v == null) continue;
    const w = Math.pow(0.5, k / HALF_LIFE_DAYS);
    wSum += w;
    wvSum += w * v;
    nDays++;
    if (k < half) recent.push(v);
    else older.push(v);
  }

  if (nDays === 0 || wSum === 0) return null;

  const weightedAvg = wvSum / wSum;
  const rA = mean(recent);
  const oA = mean(older);
  let trend: VitDTrend = 'flat';
  if (Number.isFinite(rA) && Number.isFinite(oA)) {
    if (rA > oA * 1.15 + 0.5) trend = 'up';
    else if (rA < oA * 0.85 - 0.5) trend = 'down';
  }

  const zone = zoneOf(weightedAvg);
  return {
    weightedAvg,
    zone,
    statusLabel: ADVICE[zone].label,
    advice: ADVICE[zone].advice,
    trend,
    nDays,
    windowDays,
  };
}
