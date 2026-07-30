import { describe, expect, it } from 'vitest';
import { bucketKey, bucketLabel, groupDates, granularityUnit } from '../src/ui/PeriodSelector';

/**
 * Agrégat par semaine / mois des axes temporels (Stats, Ma consommation).
 * Les semaines commencent le LUNDI, et la date représentative d'un groupe est la
 * première date réellement présente — jamais un lundi/1er du mois théorique qui
 * tomberait avant le début de la période affichée.
 */

describe('regroupement des dates', () => {
  it('la clé « semaine » est le lundi de la semaine', () => {
    // 2026-07-30 est un jeudi ; le lundi précédent est le 27.
    expect(bucketKey('2026-07-30', 'semaine')).toBe('2026-07-27');
    expect(bucketKey('2026-07-27', 'semaine')).toBe('2026-07-27'); // lundi lui-même
    expect(bucketKey('2026-07-26', 'semaine')).toBe('2026-07-20'); // dimanche → semaine d'avant
  });

  it('la clé « mois » est le mois, la clé « jour » la date elle-même', () => {
    expect(bucketKey('2026-07-30', 'mois')).toBe('2026-07');
    expect(bucketKey('2026-07-30', 'jour')).toBe('2026-07-30');
  });

  it('en granularité « jour », chaque date forme son propre groupe', () => {
    const buckets = groupDates(['2026-07-01', '2026-07-03'], 'jour');
    expect(buckets.map((b) => b.dates)).toEqual([['2026-07-01'], ['2026-07-03']]);
    expect(buckets.map((b) => b.date)).toEqual(['2026-07-01', '2026-07-03']);
  });

  it('regroupe par semaine dans l’ordre chronologique, sans perdre de date', () => {
    const dates = ['2026-07-27', '2026-07-30', '2026-08-03', '2026-07-20'];
    const buckets = groupDates(dates, 'semaine');
    expect(buckets.map((b) => b.key)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
    expect(buckets.flatMap((b) => b.dates)).toHaveLength(dates.length);
    expect(buckets[1].dates).toEqual(['2026-07-27', '2026-07-30']);
  });

  it('la date d’un groupe est sa PREMIÈRE date présente (jamais avant la période)', () => {
    // Période démarrée un jeudi : le point ne doit pas se placer au lundi 27.
    const buckets = groupDates(['2026-07-30', '2026-07-31'], 'semaine');
    expect(buckets[0].date).toBe('2026-07-30');
  });

  it('regroupe par mois', () => {
    const buckets = groupDates(['2026-06-30', '2026-07-01', '2026-07-15'], 'mois');
    expect(buckets.map((b) => b.key)).toEqual(['2026-06', '2026-07']);
    expect(buckets[1].dates).toHaveLength(2);
  });

  it('les libellés nomment le pas de temps', () => {
    expect(bucketLabel('2026-07-27', 'semaine')).toContain('sem. du');
    expect(bucketLabel('2026-07', 'mois')).toContain('2026');
    expect(granularityUnit('jour')).toBe('j');
    expect(granularityUnit('semaine')).toBe('sem.');
  });
});
