import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useEffectiveFoods, todayStr } from '../store/store';
import { UNITS } from '../nutrition/types';
import type { Food, Unit } from '../nutrition/types';
import { FOODS, SUPPLEMENT_DOSE_DEFAULT } from '../nutrition/foods';
import { normalizeForMatch, isSupplementQuery } from '../nutrition/normalize';
import { toGrams, scaleNutrients } from '../nutrition/compute';
import { suggestQuantity, type QuantitySuggestion } from '../nutrition/quantitySuggestion';
import { parseQuickFoodQuery, quickQuantity } from '../nutrition/quickFoodQuery';
import { fmt, UNIT_LABELS } from './format';
import { NumberField } from './NumberField';
import { useBankUsage, derniereFoisLabel } from './useBankUsage';
import type { BankUsageOccurrence } from './useBankUsage';

/**
 * Ajout manuel « à la carte » : on cherche un aliment, on choisit la quantité
 * et l'unité (grammes par défaut), et l'entrée est ajoutée directement.
 * Plus proche d'une app de tracking classique, mais rapide.
 * `date` : jour ciblé (défaut aujourd'hui) — permet de compléter un jour passé.
 */
/** Résultats affichés par groupe : au-delà, la liste déborde de l'écran. */
const MAX_RESULTS = 8;

function recentUsageLabel(recent: BankUsageOccurrence): string {
  const quantity = recent.quantite != null && recent.unite
    ? `${fmt(recent.quantite, 2)} ${UNIT_LABELS[recent.unite]} `
    : '';
  return `${quantity}${derniereFoisLabel(recent.date)}`;
}

export function ManualAdd({
  date,
  title,
  entryId,
  autoFocus = false,
  onAdded,
  requestedFood,
  onRequestedFoodHandled,
}: {
  date?: string;
  /** `null` masque le titre pour l'utilisation dans un repas existant. */
  title?: string | null;
  /** Rattache l'aliment choisi à cette entrée au lieu de créer une nouvelle entrée. */
  entryId?: string;
  autoFocus?: boolean;
  onAdded?: () => void;
  requestedFood?: Food | null;
  onRequestedFoodHandled?: () => void;
} = {}) {
  const all = useEffectiveFoods();
  const targetDate = date ?? todayStr();
  const searchRef = useRef<HTMLInputElement>(null);
  const usage = useBankUsage();
  const addFoodEntry = useStore((s) => s.addFoodEntry);
  const addFoodToEntry = useStore((s) => s.addFoodToEntry);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Food | null>(null);
  const [quantite, setQuantite] = useState('100');
  const [unite, setUnite] = useState<Unit>('g');
  const [flash, setFlash] = useState('');
  const [suggestion, setSuggestion] = useState<QuantitySuggestion | null>(null);
  const [typedQuantity, setTypedQuantity] = useState(false);
  const [uncertainQuantity, setUncertainQuantity] = useState(false);
  /** Second clic demandé quand la quantité saisie est démesurée (cf. `ABSURDE_KCAL`). */
  const [confirmBig, setConfirmBig] = useState(false);

  const match = (f: Food, q: string) => {
    const hay = [f.nom, ...f.aliases].map(normalizeForMatch);
    if (hay.some((h) => h.includes(q))) return true;
    // « supplément »/« complément » : fait remonter toute la catégorie
    return f.categorie === 'supplement' && isSupplementQuery(q);
  };

  // Preserve the original search for real food names containing numbers (e.g. 0%).
  const parsedQuery = useMemo(() => {
    const raw = normalizeForMatch(query);
    return raw && [...all, ...FOODS].some((food) => match(food, raw))
      ? { foodQuery: query } : parseQuickFoodQuery(query);
  }, [query, all]);
  useEffect(() => {
    if (!requestedFood) return;
    pick(requestedFood, true);
    onRequestedFoodHandled?.();
    searchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [requestedFood]);

  /**
   * Ma banque d'abord, triée par consommation la plus récente : ce qu'on ajoute à
   * la main, c'est presque toujours quelque chose qu'on mange déjà. L'ordre
   * alphabétique ferait remonter un aliment mangé une fois il y a six mois avant
   * le yaourt de tous les matins.
   */
  const results = useMemo(() => {
    const q = normalizeForMatch(parsedQuery.foodQuery);
    if (!q) return [];
    return all
      .filter((f) => match(f, q))
      .sort((a, b) => (usage.get(b.id)?.derniere ?? '').localeCompare(usage.get(a.id)?.derniere ?? ''))
      .slice(0, MAX_RESULTS);
  }, [parsedQuery.foodQuery, all, usage]);

  /**
   * Repli sur le catalogue de référence : un aliment jamais mangé n'est pas dans
   * la banque, mais il doit rester ajoutable sans dicter ni payer un appel à
   * l'IA. Le choisir le fera entrer dans la banque (cf. `addFoodEntry`).
   */
  const catalogResults = useMemo(() => {
    const q = normalizeForMatch(parsedQuery.foodQuery);
    if (!q) return [];
    const dansMaBanque = new Set(all.map((f) => f.id));
    return FOODS.filter((f) => !dansMaBanque.has(f.id) && match(f, q)).slice(0, MAX_RESULTS);
  }, [parsedQuery.foodQuery, all]);

  function pick(food: Food, fromShortcut = false) {
    setSelected(food);
    setQuery(food.nom);
    const remembered = suggestQuantity(useStore.getState().entries, food.id, targetDate);
    const explicit = fromShortcut ? null : quickQuantity(parsedQuery, food, remembered);
    setTypedQuantity(!!explicit);
    setUncertainQuantity(!fromShortcut && (!!parsedQuery.uncertain || (parsedQuery.quantity != null && !explicit)));
    setSuggestion(explicit ? null : remembered);
    setConfirmBig(false);
    // Sans historique fiable, conserver les valeurs pratiques du catalogue.
    const dose = SUPPLEMENT_DOSE_DEFAULT[food.id];
    if (explicit) {
      setUnite(explicit.unite);
      setQuantite(String(explicit.quantite));
    } else if (remembered) {
      setUnite(remembered.unite);
      setQuantite(String(remembered.quantite));
    } else if (dose) {
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
  // Réinitialise la confirmation dès que la saisie change : elle ne vaut que
  // pour la quantité exacte qu'on avait sous les yeux.
  const qKey = `${quantite}|${unite}|${selected?.id ?? ''}`;
  const [confirmedKey, setConfirmedKey] = useState('');
  const grams = selected && qNum > 0 ? toGrams({ aliment: selected.nom, quantite: qNum, unite, estimation: false }, selected) : 0;
  const kcal = selected && grams > 0 ? scaleNutrients(selected.n, grams).kcal : 0;
  const canAdd = selected !== null && Number.isFinite(qNum) && qNum > 0;
  /**
   * Une saisie au-delà de ce seuil est presque toujours une confusion d'unité
   * (« 99 999 » tapé en pensant grammes sur une unité « pièce ») : un seul clic
   * suffisait à ruiner toutes les moyennes de la période. On n'interdit rien —
   * 3 kg de riz cuit, ça existe — on demande de confirmer.
   */
  const ABSURDE_KCAL = 5000;
  const absurde = canAdd && kcal > ABSURDE_KCAL;
  const pending = absurde && confirmBig && confirmedKey === qKey;

  function add() {
    if (!selected || !Number.isFinite(qNum) || !(qNum > 0)) return;
    // Premier clic sur une quantité démesurée : on demande confirmation.
    if (absurde && !pending) {
      setConfirmBig(true);
      setConfirmedKey(qKey);
      return;
    }
    setConfirmBig(false);
    if (entryId) addFoodToEntry(entryId, selected, qNum, unite);
    else addFoodEntry(selected, qNum, unite, date);
    const when = date ? ` au ${new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')}` : '';
    setFlash(`Ajouté${when} : ${fmt(qNum, 2)} ${UNIT_LABELS[unite]} de ${selected.nom} (${fmt(kcal)} kcal).`);
    setSelected(null);
    setQuery('');
    setQuantite('100');
    setUnite('g');
    searchRef.current?.focus();
    onAdded?.();
  }

  return (
    <div className={entryId ? 'manual-add-inline' : 'panel'}>
      {title !== null && <h2>{title ?? 'Ajout manuel rapide'}</h2>}
      <input
        ref={searchRef}
        style={{ width: '100%' }}
        placeholder={entryId ? 'Ajouter un aliment (ex. « banane 2 »)' : 'Chercher : banane 2, riz 150 g…'}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || selected) return;
          const first = results[0] ?? catalogResults[0];
          if (!first) return;
          e.preventDefault();
          pick(first);
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
                    {u?.recent.length ? (
                      <> · dernières fois : {u.recent.map((recent, index) => (
                        <span key={`${recent.date}-${index}`}>
                          {index > 0 && ' · '}
                          {recentUsageLabel(recent)}
                        </span>
                      ))}</>
                    ) : null}
                  </span>
                </div>
                <span />
                <span />
                {/* Le nom de l'aliment est dans l'aria-label, pas seulement à l'écran :
                    seize boutons « Choisir » alignés se lisent tous pareil à la voix. */}
                <button
                  className="ghost small"
                  aria-label={`Choisir ${f.nom}`}
                  onClick={(e) => { e.stopPropagation(); pick(f); }}
                >
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
              <button
                className="ghost small"
                aria-label={`Choisir ${f.nom} (catalogue)`}
                onClick={(e) => { e.stopPropagation(); pick(f); }}
              >
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
        <>
        {typedQuantity && <div className="small" style={{ marginTop: 8, color: 'var(--muted)' }}>Quantité reprise de votre saisie · vous pouvez modifier.</div>}
        {uncertainQuantity && <div className="small" style={{ marginTop: 8, color: 'var(--muted)' }}>Quantité ou unité ambiguë : préremplissage conservé. Vérifiez les champs ci-dessous.</div>}
        {suggestion && (
          <div className="small" style={{ marginTop: 8, color: 'var(--muted)' }}>
            {suggestion.reason === 'habit' ? 'Quantité habituelle' : 'Dernière prise'} : {fmt(suggestion.quantite, 2)} {UNIT_LABELS[suggestion.unite]} · vous pouvez modifier.
            {suggestion.reason === 'habit' && (
              <button className="ghost small" style={{ marginLeft: 8 }} onClick={() => {
                setQuantite(String(suggestion.latest.quantite));
                setUnite(suggestion.latest.unite);
                setSuggestion({ ...suggestion.latest, latest: suggestion.latest, reason: 'latest' });
              }}>
                Reprendre la dernière prise : {fmt(suggestion.latest.quantite, 2)} {UNIT_LABELS[suggestion.latest.unite]}
              </button>
            )}
          </div>
        )}
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '0 0 118px' }}>
            Quantité
            <NumberField
              min={0}
              step={1}
              inputStep="any"
              adaptiveStep
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
          <button className={pending ? 'danger' : 'primary'} disabled={!canAdd} onClick={add}>
            {pending ? 'Confirmer' : 'Ajouter'}
          </button>
        </div>
        </>
      )}

      {absurde && (
        <div className="hint" style={{ marginTop: 8, borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          ⚠ {fmt(qNum, 2)} {UNIT_LABELS[unite]} de {selected.nom}
          {unite !== 'g' && ` = ${fmt(grams)} g`}, soit {fmt(kcal)} kcal — l'équivalent de{' '}
          {fmt(kcal / 2000, 1)} journées d'alimentation.{' '}
          {unite !== 'g' && unite !== 'ml' && `Vouliez-vous dire ${fmt(qNum, 2)} g ?`}{' '}
          {pending ? "Cliquez « Confirmer » pour l'ajouter quand même." : "Un second clic sur « Ajouter » sera demandé."}
        </div>
      )}

      {flash && <div className="status" style={{ marginTop: 8 }}>{flash}</div>}
    </div>
  );
}
