import { useMemo, useState } from 'react';
import { useStore, useEffectiveFoods } from '../store/store';
import { UNITS } from '../nutrition/types';
import type { Food, Unit } from '../nutrition/types';
import { FOODS, SUPPLEMENT_DOSE_DEFAULT } from '../nutrition/foods';
import { normalizeForMatch, isSupplementQuery } from '../nutrition/normalize';
import { toGrams, scaleNutrients } from '../nutrition/compute';
import { fmt, UNIT_LABELS } from './format';
import { NumberField } from './NumberField';
import { useBankUsage, derniereFoisLabel } from './useBankUsage';

/**
 * Ajout manuel « à la carte » : on cherche un aliment, on choisit la quantité
 * et l'unité (grammes par défaut), et l'entrée est ajoutée directement.
 * Plus proche d'une app de tracking classique, mais rapide.
 * `date` : jour ciblé (défaut aujourd'hui) — permet de compléter un jour passé.
 */
/** Résultats affichés par groupe : au-delà, la liste déborde de l'écran. */
const MAX_RESULTS = 8;

export function ManualAdd({ date, title }: { date?: string; title?: string } = {}) {
  const all = useEffectiveFoods();
  const usage = useBankUsage();
  const addFoodEntry = useStore((s) => s.addFoodEntry);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [quantite, setQuantite] = useState('100');
  const [unite, setUnite] = useState<Unit>('g');
  const [flash, setFlash] = useState('');

  const match = (f: Food, q: string) => {
    const hay = [f.nom, ...f.aliases].map(normalizeForMatch);
    if (hay.some((h) => h.includes(q))) return true;
    // « supplément »/« complément » : fait remonter toute la catégorie
    return f.categorie === 'supplement' && isSupplementQuery(q);
  };

  /**
   * Ma banque d'abord, triée par consommation la plus récente : ce qu'on ajoute à
   * la main, c'est presque toujours quelque chose qu'on mange déjà. L'ordre
   * alphabétique ferait remonter un aliment mangé une fois il y a six mois avant
   * le yaourt de tous les matins.
   */
  const results = useMemo(() => {
    const q = normalizeForMatch(query);
    if (!q) return [];
    return all
      .filter((f) => match(f, q))
      .sort((a, b) => (usage.get(b.id)?.derniere ?? '').localeCompare(usage.get(a.id)?.derniere ?? ''))
      .slice(0, MAX_RESULTS);
  }, [query, all, usage]);

  /**
   * Repli sur le catalogue de référence : un aliment jamais mangé n'est pas dans
   * la banque, mais il doit rester ajoutable sans dicter ni payer un appel à
   * l'IA. Le choisir le fera entrer dans la banque (cf. `addFoodEntry`).
   */
  const catalogResults = useMemo(() => {
    const q = normalizeForMatch(query);
    if (!q) return [];
    const dansMaBanque = new Set(all.map((f) => f.id));
    return FOODS.filter((f) => !dansMaBanque.has(f.id) && match(f, q)).slice(0, MAX_RESULTS);
  }, [query, all]);

  function pick(food: Food) {
    setSelected(food);
    setQuery(food.nom);
    // Complément mono-élément : dose directe en mg/µg de l'élément (comme l'étiquette).
    const dose = SUPPLEMENT_DOSE_DEFAULT[food.id];
    if (dose) {
      setUnite(dose.unite);
      setQuantite(String(dose.quantite));
    } else if (food.pieceGrams) {
      // pré-remplit une quantité pratique : 1 pièce si connue, sinon 100 g
      setUnite('piece');
      setQuantite('1');
    } else {
      setUnite('g');
      setQuantite('100');
    }
  }

  const qNum = parseFloat(quantite.replace(',', '.'));
  const grams = selected && qNum > 0 ? toGrams({ aliment: selected.nom, quantite: qNum, unite, estimation: false }, selected) : 0;
  const kcal = selected && grams > 0 ? scaleNutrients(selected.n, grams).kcal : 0;
  const canAdd = selected !== null && qNum > 0;

  function add() {
    if (!selected || !(qNum > 0)) return;
    addFoodEntry(selected, qNum, unite, date);
    const when = date ? ` au ${new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')}` : '';
    setFlash(`Ajouté${when} : ${fmt(qNum, 2)} ${UNIT_LABELS[unite]} de ${selected.nom} (${fmt(kcal)} kcal).`);
    setSelected(null);
    setQuery('');
    setQuantite('100');
    setUnite('g');
  }

  return (
    <div className="panel">
      <h2>{title ?? 'Ajout manuel rapide'}</h2>
      <input
        style={{ width: '100%' }}
        placeholder="Chercher un aliment (ex. « banane », « poulet »)…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
      />

      {selected === null && results.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>
            Déjà mangés
          </div>
          {results.map((f) => {
            const u = usage.get(f.id);
            return (
              <div className="item-row" key={f.id} style={{ cursor: 'pointer' }} onClick={() => pick(f)}>
                <div className="item-name">
                  <span>{f.nom}</span>
                  <span className="kcal">
                    {fmt(f.n.kcal)} kcal/100 g{f.pieceGrams ? ` · 1 pièce ≈ ${fmt(f.pieceGrams)} g` : ''}
                    {u ? ` · dernière fois ${derniereFoisLabel(u.derniere)} (${u.jours} j)` : ''}
                  </span>
                </div>
                <span />
                <span />
                <button className="ghost small" onClick={(e) => { e.stopPropagation(); pick(f); }}>
                  Choisir
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected === null && catalogResults.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="small" style={{ color: 'var(--muted)', marginBottom: 4 }}>
            Catalogue de référence — jamais mangés, les choisir les ajoute à votre banque
          </div>
          {catalogResults.map((f) => (
            <div className="item-row" key={f.id} style={{ cursor: 'pointer' }} onClick={() => pick(f)}>
              <div className="item-name">
                <span>{f.nom}</span>
                <span className="kcal">
                  {fmt(f.n.kcal)} kcal/100 g{f.pieceGrams ? ` · 1 pièce ≈ ${fmt(f.pieceGrams)} g` : ''}
                </span>
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

      {selected === null && query.trim() !== '' && results.length === 0 && catalogResults.length === 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          Aucun aliment trouvé. Dictez-le en haut (l'IA l'estimera et il rejoindra votre banque), ou créez-le dans
          l'onglet « Ma banque ».
        </div>
      )}

      {selected && (
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 0 118px' }}>
            Quantité
            <NumberField
              min={0}
              step={1}
              value={quantite}
              onChange={setQuantite}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </label>
          <label className="field" style={{ flex: '0 0 140px' }}>
            Unité
            <select value={unite} onChange={(e) => setUnite(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </label>
          <span className="small mono" style={{ flex: 1 }}>
            = {fmt(grams)} g · {fmt(kcal)} kcal
          </span>
          <button className="primary" disabled={!canAdd} onClick={add}>
            Ajouter
          </button>
        </div>
      )}

      {flash && <div className="status" style={{ marginTop: 8 }}>{flash}</div>}
    </div>
  );
}
