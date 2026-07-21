import { useState } from 'react';
import { useStore } from '../store/store';
import { fmt, UNIT_LABELS } from './format';

/**
 * Repas favoris / récurrents : un repas type enregistré (« petit-déj habituel »)
 * s'ajoute au journal en un clic (ou à la voix : dictez simplement son nom).
 * `date` : jour ciblé (défaut aujourd'hui) — utilisable aussi depuis l'historique.
 */
export function FavoriteMeals({ date }: { date?: string } = {}) {
  const favorites = useStore((s) => s.favoriteMeals);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const removeFavoriteMeal = useStore((s) => s.removeFavoriteMeal);
  const [flash, setFlash] = useState('');

  if (favorites.length === 0) return null;

  function add(id: string, nom: string) {
    const entryId = applyFavoriteMeal(id, date);
    if (entryId) {
      const when = date ? ` au ${new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')}` : '';
      setFlash(`⭐ « ${nom} » ajouté${when}.`);
    }
  }

  return (
    <div className="panel">
      <h2>Repas favoris</h2>
      {favorites.map((f) => (
        <div className="item-row" key={f.id} style={{ gridTemplateColumns: '1fr auto auto' }}>
          <div className="item-name">
            <span>⭐ {f.nom}</span>
            <span className="kcal">
              {f.items
                .map((it) => `${it.nomAffiche} ${fmt(it.quantite, 2)} ${UNIT_LABELS[it.unite]}`)
                .join(' · ')}
            </span>
          </div>
          <button className="primary small" onClick={() => add(f.id, f.nom)}>
            + Ajouter
          </button>
          <button
            className="danger small"
            data-tip="Supprimer ce favori"
            onClick={() => window.confirm(`Supprimer le repas favori « ${f.nom} » ?`) && removeFavoriteMeal(f.id)}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="hint">
        Un clic ajoute le repas {date ? 'à ce jour' : "à aujourd'hui"} (valeurs recalculées avec la banque à jour).
        À la voix : dictez simplement le nom du favori (ex. « petit-déj habituel »).
      </div>
      {flash && <div className="status">{flash}</div>}
    </div>
  );
}
