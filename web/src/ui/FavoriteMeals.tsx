import { useState } from 'react';
import type { FavoriteMeal } from '../store/store';
import { useStore } from '../store/store';
import { fmt, UNIT_LABELS } from './format';

/** Favoris affichés d'emblée ; au-delà, un bouton « + N autres » déplie le reste. */
const FAV_SHOWN = 6;

/** Détail des aliments d'un favori — en info-bulle, plus sur la ligne (place). */
function favoriteTip(f: FavoriteMeal): string {
  const items = f.items.map((it) => `${it.nomAffiche} ${fmt(it.quantite, 2)} ${UNIT_LABELS[it.unite]}`).join(' · ');
  return `${f.nom} — ${items}`;
}

/**
 * Repas favoris / récurrents : un repas type enregistré (« petit-déj habituel »)
 * s'ajoute au journal en un clic (ou à la voix : dictez simplement son nom).
 * `date` : jour ciblé (défaut aujourd'hui) — utilisable aussi depuis l'historique.
 *
 * Présentation en grille de pastilles (nom seul, détail au survol) : avec une
 * ligne par favori, le bloc mangeait tout l'écran dès qu'il y en avait quelques-uns
 * — d'autant que les noms proposés reprenaient la dictée entière. Renommer et
 * supprimer passent par un mode « Modifier », pour ne pas encombrer chaque pastille.
 */
export function FavoriteMeals({ date }: { date?: string } = {}) {
  const favorites = useStore((s) => s.favoriteMeals);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const removeFavoriteMeal = useStore((s) => s.removeFavoriteMeal);
  const renameFavoriteMeal = useStore((s) => s.renameFavoriteMeal);
  const [flash, setFlash] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);

  if (favorites.length === 0) return null;

  const shown = showAll ? favorites : favorites.slice(0, FAV_SHOWN);
  const hidden = favorites.length - shown.length;

  function add(id: string, nom: string) {
    const entryId = applyFavoriteMeal(id, date);
    if (entryId) {
      const when = date ? ` au ${new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')}` : '';
      setFlash(`⭐ « ${nom} » ajouté${when}.`);
    }
  }

  function rename(f: FavoriteMeal) {
    const nom = window.prompt('Nom du repas favori (court, c’est lui qui s’affiche) :', f.nom);
    if (nom && nom.trim()) renameFavoriteMeal(f.id, nom);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Repas favoris</h2>
        <button className="ghost small" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Terminer' : 'Modifier'}
        </button>
      </div>

      <div className="fav-grid">
        {shown.map((f) => (
          <div className="fav-chip" key={f.id}>
            <button className="fav-add" data-tip={favoriteTip(f)} onClick={() => add(f.id, f.nom)}>
              <span aria-hidden>⭐</span>
              <span className="fav-name">{f.nom}</span>
            </button>
            {editing && (
              <>
                <button className="fav-act" data-tip="Renommer" aria-label={`Renommer ${f.nom}`} onClick={() => rename(f)}>
                  ✎
                </button>
                <button
                  className="fav-act danger"
                  data-tip="Supprimer ce favori"
                  aria-label={`Supprimer ${f.nom}`}
                  onClick={() => window.confirm(`Supprimer le repas favori « ${f.nom} » ?`) && removeFavoriteMeal(f.id)}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
        {hidden > 0 && (
          <button className="fav-chip fav-more" onClick={() => setShowAll(true)}>
            + {hidden} autre{hidden > 1 ? 's' : ''}
          </button>
        )}
        {showAll && favorites.length > FAV_SHOWN && (
          <button className="fav-chip fav-more" onClick={() => setShowAll(false)}>
            Réduire
          </button>
        )}
      </div>

      <div className="hint">
        Un clic ajoute le repas {date ? 'à ce jour' : "à aujourd'hui"} (valeurs recalculées avec la banque à jour) ;
        le détail des aliments est au survol. À la voix : dictez simplement le nom du favori (ex. « petit-déj
        habituel »).
      </div>
      {flash && <div className="status">{flash}</div>}
    </div>
  );
}
