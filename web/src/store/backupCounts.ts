/**
 * Mesure de « richesse » d'une sauvegarde : les compteurs qui ne font que
 * grandir avec le temps (une entrée de journal, une pesée, une note… ne
 * disparaissent pas toutes seules).
 *
 * Sert de garde-fou anti-écrasement à la sauvegarde automatique : un navigateur
 * au localStorage vide (autre navigateur, mode privé, nettoyage) produit une
 * sauvegarde « vierge » qui ne doit PAS remplacer le fichier du jour déjà écrit
 * depuis le vrai navigateur. C'est arrivé : le fichier du 30/07/2026 s'est
 * retrouvé à 0 entrée alors que la veille et le lendemain en comptaient 115+.
 *
 * Module volontairement SANS import : il est chargé à la fois par l'app (React)
 * et par le middleware de dev côté Node (cf. vite-plugin-save.ts), qui ne doit
 * pas tirer tout le store dans la config Vite.
 */

/** Compteurs comparables d'une sauvegarde (tolérant : champs absents = 0). */
export function backupCounts(b: Record<string, unknown>): Record<string, number> {
  const len = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
  const size = (v: unknown): number => (v && typeof v === 'object' ? Object.keys(v as object).length : 0);
  return {
    entries: len(b.entries),
    pesées: len(b.weightEntries),
    soleil: len(b.sunExposures),
    // Clé volontairement inchangée (« aliments perso ») bien qu'elle compte
    // désormais TOUTE ma banque : elle sert à comparer deux sauvegardes entre
    // elles, la renommer ferait lire 0 sur les fichiers d'avant et déclencherait
    // une fausse alerte de perte de données.
    'aliments perso': len(b.customFoods),
    favoris: len(b.favoriteMeals),
    'jours réglés': size(b.mutedDays),
    notes: size(b.dayNotes),
    importances: size(b.nutrientImportance),
  };
}

/**
 * Seuil de perte jugée anormale. En dessous de la moitié de la référence, ce
 * n'est plus une suppression manuelle mais un état vierge ou tronqué. On reste
 * tolérant au-dessus : supprimer quelques entrées reste une opération légitime
 * qui doit continuer d'être sauvegardée.
 */
const DROP_RATIO = 0.5;

/**
 * La sauvegarde `next` perd-elle massivement des données par rapport à `ref` ?
 * Retourne la raison lisible (à journaliser / afficher), ou `null` si l'écriture
 * est sûre.
 */
export function suspiciousLoss(next: Record<string, unknown>, ref: Record<string, unknown>): string | null {
  const a = backupCounts(next);
  const b = backupCounts(ref);
  const lost = Object.keys(b).filter((k) => b[k] > 0 && a[k] < b[k] * DROP_RATIO);
  if (lost.length === 0) return null;
  return lost.map((k) => `${k} ${b[k]} → ${a[k]}`).join(', ');
}
