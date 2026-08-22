import { useMemo, useState } from 'react';
import type { FavoriteMeal, FavoriteMealItem } from '../store/store';
import { useStore, useEffectiveFoods } from '../store/store';
import { UNITS } from '../nutrition/types';
import type { Food, Unit } from '../nutrition/types';
import { normalizeForMatch } from '../nutrition/normalize';
import { fmt, UNIT_LABELS } from './format';
import { NumberField } from './NumberField';

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
 * supprimer passent par un mode « Modifier », pour ne pas encombrer chaque pastille ;
 * dans ce mode, cliquer sur la pastille elle-même ouvre l'édition de son CONTENU
 * (aliments/quantités) au lieu de l'ajouter au jour — la seule façon jusqu'ici de
 * corriger un favori était de le supprimer et de le recréer.
 */
export function FavoriteMeals({ date }: { date?: string } = {}) {
  const favorites = useStore((s) => s.favoriteMeals);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const removeFavoriteMeal = useStore((s) => s.removeFavoriteMeal);
  const renameFavoriteMeal = useStore((s) => s.renameFavoriteMeal);
  const [flash, setFlash] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingItemsId, setEditingItemsId] = useState<string | null>(null);

  if (favorites.length === 0) return null;

  const shown = showAll ? favorites : favorites.slice(0, FAV_SHOWN);
  const hidden = favorites.length - shown.length;
  const editingItemsOf = favorites.find((f) => f.id === editingItemsId) ?? null;

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

  function toggleEditing() {
    setEditing((e) => !e);
    setEditingItemsId(null);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Repas favoris</h2>
        <button className="ghost small" onClick={toggleEditing}>
          {editing ? 'Terminer' : 'Modifier'}
        </button>
      </div>

      <div className="fav-grid">
        {shown.map((f) => (
          <div className="fav-chip" key={f.id}>
            <button
              className={`fav-add${editingItemsId === f.id ? ' on' : ''}`}
              data-tip={editing ? 'Modifier les aliments de ce favori' : favoriteTip(f)}
              onClick={() =>
                editing ? setEditingItemsId((id) => (id === f.id ? null : f.id)) : add(f.id, f.nom)
              }
            >
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
        {editing
          ? "Cliquez un favori pour modifier ses aliments (quantité, unité, remplacement)."
          : `Un clic ajoute le repas ${date ? 'à ce jour' : "à aujourd'hui"} (valeurs recalculées avec la banque à jour) ; le détail des aliments est au survol. À la voix : dictez simplement le nom du favori (ex. « petit-déj habituel »).`}
      </div>
      {flash && <div className="status">{flash}</div>}

      {editingItemsOf && <FavoriteItemsEditor fav={editingItemsOf} onClose={() => setEditingItemsId(null)} />}
    </div>
  );
}

/** Édition du contenu d'un favori : aliments, quantités, unités — ajout et retrait compris. */
function FavoriteItemsEditor({ fav, onClose }: { fav: FavoriteMeal; onClose: () => void }) {
  const foods = useEffectiveFoods();
  const updateFavoriteMealItem = useStore((s) => s.updateFavoriteMealItem);
  const removeFavoriteMealItem = useStore((s) => s.removeFavoriteMealItem);
  const addFavoriteMealItem = useStore((s) => s.addFavoriteMealItem);

  return (
    <div className="panel" style={{ borderLeft: '3px solid var(--accent)', marginTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>⭐ {fav.nom} — contenu</h3>
        <button className="ghost small" onClick={onClose}>
          Fermer
        </button>
      </div>

      {fav.items.length === 0 && <div className="empty">Aucun aliment — ajoutez-en un ci-dessous.</div>}
      {fav.items.map((it, i) => (
        <FavoriteItemRow
          key={i}
          item={it}
          foods={foods}
          canRemove={fav.items.length > 1}
          onUpdate={(patch) => updateFavoriteMealItem(fav.id, i, patch)}
          onRemove={() => removeFavoriteMealItem(fav.id, i)}
        />
      ))}

      <AddFavoriteItem foods={foods} onAdd={(item) => addFavoriteMealItem(fav.id, item)} />
    </div>
  );
}

/** Une ligne d'aliment du favori — toujours en édition (le bloc entier EST l'éditeur). */
function FavoriteItemRow({
  item,
  foods,
  canRemove,
  onUpdate,
  onRemove,
}: {
  item: FavoriteMealItem;
  foods: Food[];
  canRemove: boolean;
  onUpdate: (patch: Partial<FavoriteMealItem>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="item-row item-row-edit">
      <select
        className="item-row-edit-food"
        value={item.foodId ?? ''}
        onChange={(e) => {
          const food = foods.find((f) => f.id === e.target.value) ?? null;
          onUpdate({ foodId: food?.id ?? null, nomAffiche: food?.nom ?? item.nomAffiche });
        }}
      >
        {!item.foodId && <option value="">{item.nomAffiche} (non trouvé)</option>}
        {foods.map((f) => (
          <option key={f.id} value={f.id}>
            {f.nom}
          </option>
        ))}
      </select>
      <NumberField
        min={0}
        step={1}
        inputStep="any"
        adaptiveStep
        value={item.quantite}
        onChange={(v) => onUpdate({ quantite: parseFloat(v.replace(',', '.')) || 0 })}
      />
      <select value={item.unite} onChange={(e) => onUpdate({ unite: e.target.value as Unit })}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))}
      </select>
      <span className="item-row-actions">
        {canRemove && (
          <button className="danger small" data-tip="Retirer cet aliment du favori" onClick={onRemove}>
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

/** Ajoute un nouvel aliment au favori en cours d'édition (recherche dans la banque). */
function AddFavoriteItem({ foods, onAdd }: { foods: Food[]; onAdd: (item: FavoriteMealItem) => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [quantite, setQuantite] = useState('100');
  const [unite, setUnite] = useState<Unit>('g');

  const results = useMemo(() => {
    const q = normalizeForMatch(query);
    if (!q) return [];
    return foods.filter((f) => [f.nom, ...f.aliases].map(normalizeForMatch).some((h) => h.includes(q))).slice(0, 8);
  }, [query, foods]);

  function pick(food: Food) {
    setSelected(food);
    setQuery(food.nom);
    if (food.pieceGrams) {
      setUnite('piece');
      setQuantite('1');
    } else {
      setUnite('g');
      setQuantite('100');
    }
  }

  function submit() {
    const q = parseFloat(quantite.replace(',', '.'));
    if (!selected || !(q > 0)) return;
    onAdd({ foodId: selected.id, nomAffiche: selected.nom, quantite: q, unite, estimation: false });
    setSelected(null);
    setQuery('');
    setQuantite('100');
    setUnite('g');
  }

  return (
    <div style={{ marginTop: 10 }}>
      <input
        style={{ width: '100%' }}
        placeholder="Ajouter un aliment au favori (ex. « banane »)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
      />
      {selected === null && results.length > 0 && (
        <div style={{ marginTop: 6 }}>
          {results.map((f) => (
            <div className="item-row" key={f.id} style={{ cursor: 'pointer' }} onClick={() => pick(f)}>
              <div className="item-name">
                <span>{f.nom}</span>
                <span className="kcal">{fmt(f.n.kcal)} kcal/100 g</span>
              </div>
              <span />
              <span />
              <button className="ghost small" onClick={(e) => { e.stopPropagation(); pick(f); }}>
                Choisir
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div className="row" style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 0 100px' }}>
            Quantité
            <NumberField min={0} step={1} inputStep="any" adaptiveStep value={quantite} onChange={setQuantite} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          <label className="field" style={{ flex: '0 0 130px' }}>
            Unité
            <select value={unite} onChange={(e) => setUnite(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </label>
          <button className="primary small" onClick={submit}>
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
