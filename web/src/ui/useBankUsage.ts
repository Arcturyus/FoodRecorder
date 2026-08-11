/**
 * Usage de chaque aliment de ma banque : combien de fois, combien de jours, et
 * quand pour la dernière fois.
 *
 * C'est la mesure qui remplace « est-il dans la base ? » : depuis que la banque
 * ne contient que du réellement mangé, ce qui distingue les aliments entre eux
 * n'est plus leur présence mais leur FRÉQUENCE. Elle sert au filtre des écrans
 * de stats (« mangé au moins N jours ») et au tri de l'ajout manuel.
 */

import { useMemo } from 'react';
import { useStore } from '../store/store';
import { foodFrequencies } from '../nutrition/frequency';

export interface BankUsage {
  /** Nombre d'items de journal (deux fois dans la même journée = 2). */
  occurrences: number;
  /** Jours distincts de consommation — la mesure d'une habitude. */
  jours: number;
  /** Dernière consommation (YYYY-MM-DD). */
  derniere: string;
}

/** Toute la période : `foodFrequencies` filtre sur une plage inclusive de dates ISO. */
const TOUT = { start: '0000-01-01', end: '9999-12-31' };

/** Usage par foodId sur tout l'historique. Mémoïsé : il relit tout le journal. */
export function useBankUsage(): Map<string, BankUsage> {
  const entries = useStore((s) => s.entries);
  return useMemo(() => {
    const map = new Map<string, BankUsage>();
    for (const f of foodFrequencies(entries, TOUT)) {
      // Les aliments non résolus (clé `nom:…`) n'ont pas d'aliment de banque à
      // décrire : ils sont comptés ailleurs, dans « Ma consommation ».
      if (!f.foodId) continue;
      map.set(f.foodId, { occurrences: f.occurrences, jours: f.jours, derniere: f.derniere });
    }
    return map;
  }, [entries]);
}

/** Nombre de jours entre une date ISO et aujourd'hui (0 = aujourd'hui). */
export function joursDepuis(dateIso: string, today = new Date()): number {
  const d = new Date(`${dateIso}T00:00:00`);
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((ref.getTime() - d.getTime()) / 86_400_000);
}

/** « aujourd'hui », « hier », « il y a 5 j », « il y a 3 mois ». */
export function derniereFoisLabel(dateIso: string, today = new Date()): string {
  const n = joursDepuis(dateIso, today);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  if (n < 31) return `il y a ${n} j`;
  const mois = Math.round(n / 30.44);
  if (mois < 24) return `il y a ${mois} mois`;
  return `il y a ${Math.round(n / 365.25)} ans`;
}
