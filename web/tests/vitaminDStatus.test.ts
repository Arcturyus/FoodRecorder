import { describe, expect, it } from 'vitest';
import { vitaminDFlux, VITD_LOW, VITD_OK } from '../src/sun/vitaminDStatus';
import { parseSunRules } from '../src/extraction/sun';

/** Clé de date LOCALE (comme le module) pour éviter les décalages de fuseau. */
function localKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Construit une map date→vitD sur les N derniers jours avec une valeur constante. */
function constantIntake(today: string, days: number, perDay: number): Map<string, number> {
  const m = new Map<string, number>();
  const base = new Date(`${today}T12:00:00`).getTime();
  for (let k = 0; k < days; k++) m.set(localKey(base - k * 86_400_000), perDay);
  return m;
}

const TODAY = '2026-07-10';

describe('statut vitamine D (flux moyen)', () => {
  it('null sans aucune donnée', () => {
    expect(vitaminDFlux(new Map(), TODAY)).toBeNull();
  });

  it('apport élevé → zone suffisante', () => {
    const s = vitaminDFlux(constantIntake(TODAY, 28, 20), TODAY)!;
    expect(s.zone).toBe('ok');
    expect(s.weightedAvg).toBeCloseTo(20, 5);
    expect(s.statusLabel).toContain('suffisant');
  });

  it('apport très faible → risque de carence', () => {
    const s = vitaminDFlux(constantIntake(TODAY, 28, 3), TODAY)!;
    expect(s.zone).toBe('low');
    expect(s.weightedAvg).toBeLessThan(VITD_LOW);
  });

  it('apport intermédiaire → zone grise', () => {
    const s = vitaminDFlux(constantIntake(TODAY, 28, 11), TODAY)!;
    expect(s.zone).toBe('mid');
    expect(s.weightedAvg).toBeGreaterThanOrEqual(VITD_LOW);
    expect(s.weightedAvg).toBeLessThan(VITD_OK);
  });

  it('détecte une tendance à la baisse (récent < ancien)', () => {
    const m = new Map<string, number>();
    const base = new Date(`${TODAY}T12:00:00`).getTime();
    for (let k = 0; k < 28; k++) {
      m.set(localKey(base - k * 86_400_000), k < 14 ? 5 : 25); // 14 jours récents bas, avant haut
    }
    const s = vitaminDFlux(m, TODAY)!;
    expect(s.trend).toBe('down');
  });
});

describe('parseur de dictée soleil', () => {
  it('extrait durée, heure, ciel, peau, crème', () => {
    const p = parseSunRules('ce midi je suis resté une demi-heure en plein soleil en short avec de la crème solaire');
    expect(p.dureeMin).toBe(30);
    expect(p.heure).toBe('13:00');
    expect(p.ciel).toBe('tres-ensoleille');
    expect(p.peau).toBe('bras-jambes');
    expect(p.creme).toBe('complete');
  });

  it('« crème sur le visage » → crème visage seulement', () => {
    const p = parseSunRules('20 minutes au soleil en t-shirt avec de la crème solaire sur le visage');
    expect(p.creme).toBe('visage');
  });

  it('comprend « 20 minutes », le t-shirt et le phototype', () => {
    const p = parseSunRules('20 minutes au soleil en t-shirt, peau mate');
    expect(p.dureeMin).toBe(20);
    expect(p.peau).toBe('visage-bras');
    expect(p.phenotype).toBe('mat');
    expect(p.ciel).toBe('ensoleille');
  });

  it('« trois quarts d\'heure » = 45 min et « torse nu »', () => {
    const p = parseSunRules('trois quarts d\'heure torse nu au bord de la piscine');
    expect(p.dureeMin).toBe(45);
    expect(p.peau).toBe('torse-nu');
  });
});
