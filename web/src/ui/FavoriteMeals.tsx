import { useMemo, useRef, useState } from 'react';
import type { FavoriteMeal, FavoriteMealItem } from '../store/store';
import { useStore, useEffectiveFoods, todayStr } from '../store/store';
import { UNITS } from '../nutrition/types';
import type { Food, Unit } from '../nutrition/types';
import { normalizeForMatch } from '../nutrition/normalize';
import { fmt, UNIT_LABELS } from './format';
import { NumberField } from './NumberField';
import { frequentFoodShortcuts, repeatedMealShortcuts } from './recentShortcuts';

function StarIcon() {
  return <svg className="favorite-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>;
}
function PencilIcon() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" /></svg>;
}
function favoriteTip(f: Pick<FavoriteMeal, 'nom' | 'items'>): string {
  return f.items.map((it) => `${fmt(it.quantite, 2)} ${UNIT_LABELS[it.unite]} de ${it.nomAffiche}`).join(' · ');
}

export function FavoriteMeals({ date, onChooseFood }: { date?: string; onChooseFood: (food: Food) => void }) {
  const favorites = useStore((s) => s.favoriteMeals);
  const entries = useStore((s) => s.entries);
  const foods = useEffectiveFoods();
  const targetDate = date ?? todayStr();
  const repeated = useMemo(() => repeatedMealShortcuts(entries, foods, targetDate), [entries, foods, targetDate]);
  const frequent = useMemo(() => frequentFoodShortcuts(entries, foods, targetDate), [entries, foods, targetDate]);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const addMealItems = useStore((s) => s.addMealItems);
  const saveFavoriteMeal = useStore((s) => s.saveFavoriteMeal);
  const removeFavoriteMeal = useStore((s) => s.removeFavoriteMeal);
  const [flash, setFlash] = useState('');
  const [editingItemsId, setEditingItemsId] = useState<string | null>(null);
  const [mealTab, setMealTab] = useState<'favorites' | 'frequent' | null>(null);
  const hasFrequent = frequent.length + repeated.length > 0;
  const activeTab = mealTab ?? (favorites.length ? 'favorites' : 'frequent');
  const foodSuggestions = frequent.map(({ food, days }) => ({ key: food.id, nom: food.nom, items: [] as FavoriteMealItem[], days, food }));
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const editedFavorite = favorites.find((fav) => fav.id === editingItemsId);
  const mealSuggestions = repeated.map((meal) => ({ ...meal, food: null as Food | null }));
  if (!favorites.length && !hasFrequent) return null;
  function switchTab(tab: 'favorites' | 'frequent') {
    setMealTab(tab); setEditingItemsId(null); setFlash('');
  }
  return (
    <div className="panel meal-shortcuts" onTouchStart={(e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, .favorite-editor')) return;
      touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }} onTouchEnd={(e) => {
      const start = touchStart.current; touchStart.current = null;
      if (!start || !hasFrequent) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // Horizontal suggestion lanes keep their own scroll gesture.
        if ((e.target as HTMLElement).closest('.frequent-lane')) return;
        switchTab(dx < 0 ? 'frequent' : 'favorites');
      }
    }} onTouchCancel={() => { touchStart.current = null; }}>
      <div className="quick-meal-heading">
        <h2>Repas rapides</h2>
      </div>
      <div className="meal-shortcut-tabs" role="group" aria-label="Suggestions de repas">
        <button aria-pressed={activeTab === 'favorites'} onClick={() => switchTab('favorites')}><StarIcon /> Favoris</button>
        {hasFrequent && <button aria-pressed={activeTab === 'frequent'} onClick={() => switchTab('frequent')}>Souvent mangés <span className="shortcut-period">15 j</span></button>}
      </div>
      {activeTab === 'favorites' && <>
        {!favorites.length && <p className="small">Enregistrez un repas avec « ☆ Favori » ou l’étoile des suggestions.</p>}
        <div className="fav-grid favorite-scroll" tabIndex={0} role="region" aria-label="Repas favoris">
          {favorites.map((fav) => <div className={`fav-chip favorite-card${editingItemsId === fav.id ? ' on' : ''}`} key={fav.id}>
            <button className="fav-add" data-tip={favoriteTip(fav)} aria-label={`Ajouter ${fav.nom}`} onClick={() => {
              if (applyFavoriteMeal(fav.id, date)) setFlash(`Ajouté : ${fav.nom}.`);
            }}><StarIcon /><span className="fav-name">{fav.nom}</span></button>
            <button className="favorite-edit-button" aria-label={`Modifier ${fav.nom}`} aria-expanded={editingItemsId === fav.id} onClick={() => setEditingItemsId(editingItemsId === fav.id ? null : fav.id)}><PencilIcon /></button>
          </div>)}
        </div>
        <div className="small shortcut-help">Cliquez sur un élément pour l’ajouter automatiquement, et sur le crayon pour modifier le repas favori.</div>
        {editedFavorite && <div className="fav-expanded"><FavoriteItemsEditor key={editedFavorite.id} fav={editedFavorite} onClose={() => setEditingItemsId(null)} onDelete={() => {
          if (window.confirm(`Supprimer le repas favori « ${editedFavorite.nom} » ?`)) { removeFavoriteMeal(editedFavorite.id); setEditingItemsId(null); }
        }} /></div>}
      </>}
      {activeTab === 'frequent' && <div className="frequent-groups">
        {[{ title: 'Aliments', items: foodSuggestions, type: 'foods' }, { title: 'Combinaisons', items: mealSuggestions, type: 'meals' }].map((group) => <div key={group.type}>
          <div className="frequent-label">{group.title}</div>
          <div className={`frequent-lane frequent-lane-${group.type}`} role="region" aria-label={group.title} tabIndex={0}>
        {group.items.map((item) => {
          const alreadySaved = favorites.some((fav) => fav.items.length === item.items.length && [...fav.items].map((i) => `${i.foodId}|${i.quantite}|${i.unite}`).sort().join(';') === item.items.map((i) => `${i.foodId}|${i.quantite}|${i.unite}`).sort().join(';'));
          return <div className="fav-chip frequent-chip" key={item.key}>
            <button className="fav-add" data-tip={item.food ? `${item.days} jours sur 15 · Choisir la quantité` : favoriteTip(item)} aria-label={item.food ? `Choisir ${item.nom} (fréquent)` : `Ajouter le repas récurrent : ${item.nom}`} onClick={() => {
              if (item.food) onChooseFood(item.food);
              else if (addMealItems(`Repas récurrent : ${item.nom}`, item.items, date)) setFlash(`Ajouté : ${item.nom}.`);
            }}><span className="fav-name">{item.nom}</span><span className="shortcut-days" data-tip={`${item.days} jours sur 15`}>{item.days} j</span></button>
            {!item.food && <button className={`save-shortcut${alreadySaved ? ' saved' : ''}`} disabled={alreadySaved} aria-label={alreadySaved ? `${item.nom} déjà en favoris` : `Enregistrer ${item.nom} en favoris`} onClick={() => { saveFavoriteMeal(item.nom, item.items); setFlash('Repas enregistré dans les favoris.'); }}><StarIcon /></button>}
          </div>;
        })}
          {group.items.length === 0 && <span className="small frequent-empty">{group.type === 'foods' ? 'Pas encore d’aliment répété sur 15 jours.' : 'Aucun groupe d’au moins deux aliments retrouvé ensemble sur deux jours.'}</span>}
          </div>
          {group.type === 'meals' && group.items.length > 0 && <div className="small shortcut-help">Aliments souvent pris ensemble, même avec des extras. Quantités de la dernière prise.</div>}
        </div>)}
      </div>}
      {flash && <div className="status" role="status">{flash}</div>}
    </div>
  );
}

/** Édition du contenu d'un favori : aliments, quantités, unités — ajout et retrait compris. */
function FavoriteItemsEditor({ fav, onClose, onDelete }: { fav: FavoriteMeal; onClose: () => void; onDelete: () => void }) {
  const rename = useStore((s) => s.renameFavoriteMeal);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(fav.nom);
  function saveName() {
    if (name.trim()) rename(fav.id, name.trim());
    else setName(fav.nom);
    setRenaming(false);
  }
  const foods = useEffectiveFoods();
  const updateFavoriteMealItem = useStore((s) => s.updateFavoriteMealItem);
  const removeFavoriteMealItem = useStore((s) => s.removeFavoriteMealItem);
  const addFavoriteMealItem = useStore((s) => s.addFavoriteMealItem);

  return (
    <div className="favorite-editor">
      <div className="favorite-editor-heading">
        <div className="favorite-title-edit">
          <StarIcon />
          {renaming ? <input aria-label="Nom du favori" value={name} autoFocus onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => {
            if (e.key === 'Enter') saveName();
            if (e.key === 'Escape') { setName(fav.nom); setRenaming(false); }
          }} /> : <><strong>{fav.nom}</strong><button className="quick-manage" aria-label={`Renommer ${fav.nom}`} onClick={() => { setName(fav.nom); setRenaming(true); }}><PencilIcon /></button></>}
        </div>
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
      <button className="favorite-remove" onClick={onDelete}>Supprimer ce favori</button>
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
        placeholder="Ajouter un aliment…"
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
