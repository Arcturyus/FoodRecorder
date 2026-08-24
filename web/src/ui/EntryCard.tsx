import { useEffect, useMemo, useRef, useState } from 'react';
import type { JournalEntry, JournalItem } from '../store/store';
import { useStore, useEffectiveFoods, todayStr } from '../store/store';
import { matchFood } from '../nutrition/match';
import { normalizeForMatch } from '../nutrition/normalize';
import { UNITS } from '../nutrition/types';
import type { Food, NutrientKey } from '../nutrition/types';
import { useTargets } from './useTargets';
import { fmt, UNIT_LABELS } from './format';
import { DETAIL_GROUPS, SHORT_LABELS, draftToContribution, nutrientsToDraft } from './itemDetail';
import { DayPickerButton, relativeDayLabel } from './DayPicker';
import { NumberField } from './NumberField';
import { MEAL_GAP_MIN, type MealPosition } from './meals';

/** Heure courte d'un horodatage (« 12:30 »). */
export function hhmm(ts: number): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Résumé d'un repas en une ligne, pour l'affichage compact : la dictée si elle
 * existe (c'est ce que l'utilisateur a dit, donc ce qu'il reconnaîtra), sinon
 * les aliments. Tronqué par le CSS, pas ici : couper à N caractères couperait
 * au milieu d'un mot différent selon la largeur de l'écran.
 */
function entrySummary(entry: JournalEntry): string {
  const dictee = entry.transcript.replace(/^⭐/, '').trim();
  if (dictee) return dictee;
  return entry.items.map((it) => it.nomAffiche).join(' · ');
}

/**
 * Carte récap d'une entrée enregistrée, avec édition en place (plan §Phase 4).
 * `collapsed` donne l'état d'ouverture VOULU par la page (mode compact du jour) ;
 * la carte garde ensuite son propre état, pour qu'ouvrir un repas n'ouvre pas
 * les autres.
 */
export function EntryCard({
  entry,
  collapsed = false,
  mealPos,
}: {
  entry: JournalEntry;
  collapsed?: boolean;
  /** Place de l'entrée dans son repas — absente si la page ne groupe pas. */
  mealPos?: MealPosition;
}) {
  const [open, setOpen] = useState(!collapsed);
  // Basculer le mode compact de la journée reprend la main sur les cartes
  // ouvertes une à une : sinon « tout replier » laisserait ouvert ce qu'on
  // venait de déplier, et le bouton paraîtrait cassé.
  useEffect(() => {
    setOpen(!collapsed);
  }, [collapsed]);
  const [editing, setEditing] = useState(false);
  const removeEntry = useStore((s) => s.removeEntry);
  const moveEntry = useStore((s) => s.moveEntry);
  const setEntryMealLink = useStore((s) => s.setEntryMealLink);
  const duplicateEntry = useStore((s) => s.duplicateEntry);
  const saveFavoriteMeal = useStore((s) => s.saveFavoriteMeal);
  const [saved, setSaved] = useState('');

  const kcal = entry.items.reduce((a, it) => a + it.nutrients.kcal, 0);
  const time = hhmm(entry.createdAt);
  const isPast = entry.date !== todayStr();

  function copyTo(date: string) {
    duplicateEntry(entry.id, date);
    setSaved(`Repas recopié ${relativeDayLabel(date)}.`);
  }

  function confirmRemoveEntry() {
    const count = entry.items.length;
    if (!window.confirm(`Supprimer ce repas (${count} aliment${count > 1 ? 's' : ''}, ${fmt(kcal)} kcal) ?`)) return;
    removeEntry(entry.id);
  }

  function saveAsFavorite() {
    // Jamais la dictée comme nom proposé : elle fait des favoris à rallonge
    // (« alors du fromage blanc 3 % je dirais 200 g avec deux carrés de… »),
    // illisibles dans la grille et impossibles à redire à la voix. On propose
    // les aliments — sauf si l'entrée vient déjà d'un favori, dont on garde le nom.
    const fromFavorite = entry.transcript.startsWith('⭐') ? entry.transcript.slice(1).trim() : '';
    const suggestion = fromFavorite || entry.items.slice(0, 3).map((it) => it.nomAffiche).join(', ');
    const nom = window.prompt('Nom du repas favori, court (ex. « petit-déj habituel ») :', suggestion);
    if (!nom || !nom.trim()) return;
    saveFavoriteMeal(nom, entry.items);
    setSaved(`⭐ Enregistré comme favori : « ${nom.trim()} » (visible sur l'onglet Aujourd'hui).`);
  }

  if (!open) {
    const n = entry.items.length;
    return (
      <div className="panel entry-card entry-compact">
        <button type="button" className="entry-compact-btn" aria-expanded={false} onClick={() => setOpen(true)}>
          <span className="sec-chevron" aria-hidden="true">
            ▸
          </span>
          <span className="mono entry-compact-time">{time}</span>
          <span className="entry-compact-title">{entrySummary(entry)}</span>
          <span className="mono entry-compact-kcal">
            {fmt(kcal)} kcal · {n} aliment{n > 1 ? 's' : ''}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="panel entry-card">
      <div className="entry-meta">
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="sec-toggle entry-fold"
            aria-expanded={true}
            data-tip="Replier ce repas"
            onClick={() => setOpen(false)}
          >
            <span className="sec-chevron open" aria-hidden="true">
              ▸
            </span>
          </button>
          {time} · {fmt(kcal)} kcal ·{' '}
          {entry.source === 'llm'
            ? 'IA'
            : entry.source === 'anthropic'
              ? 'Claude'
              : entry.source === 'claudecode'
                ? 'Claude Code'
                : entry.source === 'rules'
                  ? 'auto'
                  : 'manuel'}
        </span>
        <div className="row">
          {isPast && (
            <button className="ghost small" data-tip="Recopie ce repas tel quel sur aujourd'hui" onClick={() => copyTo(todayStr())}>
              ⧉ Auj.
            </button>
          )}
          <DayPickerButton
            label="⧉ Copier"
            tip="Recopier ce repas sur un autre jour (il a aussi été mangé hier, l'oubli d'un jour passé…)"
            exclude={entry.date}
            onPick={copyTo}
          />
          <button className="ghost small" data-tip="Enregistrer comme repas favori réutilisable" onClick={saveAsFavorite}>
            ☆ Favori
          </button>
          <button className="ghost small" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Terminer' : 'Options'}
          </button>
          <button className="danger small" onClick={confirmRemoveEntry}>
            Suppr.
          </button>
        </div>
      </div>
      {saved && <div className="status">{saved}</div>}
      {entry.transcript && <div className="entry-transcript">« {entry.transcript} »</div>}
      {entry.items.map((it) => (
        <ItemRow key={it.id} entryId={entry.id} item={it} canDeleteItem={entry.items.length > 1} />
      ))}
      {editing && (
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <label className="field">
            Jour de l'entrée
            <input
              type="date"
              value={entry.date}
              max={todayStr()}
              onChange={(e) => e.target.value && moveEntry(entry.id, e.target.value)}
            />
          </label>
          <span className="small" style={{ flex: 1 }}>
            Changez la date si ce repas concerne un autre jour (oubli d'hier, saisie le lendemain…).
          </span>
        </div>
      )}
      {editing && mealPos && <MealLinkSetting entry={entry} pos={mealPos} onSet={setEntryMealLink} />}
      {editing && <AddItemInline entryId={entry.id} />}
    </div>
  );
}

/**
 * Correction du découpage en repas, dans les options d'une entrée. L'app suppose
 * que deux saisies à moins de 30 min sont le même repas ; c'est faux dès qu'on
 * rattrape une journée le soir (tout arrive dans la même minute) ou qu'on grignote
 * une heure après le plat. Les deux boutons portent une HEURE, jamais « au-dessus »
 * ou « en dessous » : la liste s'affiche du plus récent au plus ancien, l'inverse
 * de l'ordre où les repas se sont enchaînés.
 */
function MealLinkSetting({
  entry,
  pos,
  onSet,
}: {
  entry: JournalEntry;
  pos: MealPosition;
  onSet: (id: string, link: 'join' | 'break' | null) => void;
}) {
  const force = entry.mealLink;
  return (
    <div className="row" style={{ marginTop: 10, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="small">Repas :</span>
      {pos.isFirst && pos.previousStart != null && (
        <button
          className={`small ${force === 'join' ? 'chip-active' : 'ghost'}`}
          data-tip={`Compter cette saisie avec le repas de ${hhmm(pos.previousStart)}, malgré l'écart de temps`}
          onClick={() => onSet(entry.id, force === 'join' ? null : 'join')}
        >
          ⊞ Rattacher au repas de {hhmm(pos.previousStart)}
        </button>
      )}
      {!pos.isFirst && (
        <button
          className={`small ${force === 'break' ? 'chip-active' : 'ghost'}`}
          data-tip="Détacher cette saisie du repas en cours : elle en commence un nouveau"
          onClick={() => onSet(entry.id, force === 'break' ? null : 'break')}
        >
          ⊟ Nouveau repas à {hhmm(entry.createdAt)}
        </button>
      )}
      {force && (
        <button className="ghost small" data-tip="Revenir au regroupement automatique" onClick={() => onSet(entry.id, null)}>
          ↺ automatique
        </button>
      )}
      <span className="small" style={{ flex: 1, color: 'var(--muted)' }}>
        Les saisies faites à moins de {MEAL_GAP_MIN} min d'intervalle sont comptées comme un seul repas.
      </span>
    </div>
  );
}

/**
 * Une ligne d'aliment gère son PROPRE mode édition (indépendant des autres
 * items du repas) : passer un seul élément en édition ne touche pas les autres.
 */
function ItemRow({ entryId, item, canDeleteItem }: { entryId: string; item: JournalItem; canDeleteItem: boolean }) {
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  // L'aliment de banque porte le drapeau « à vérifier » depuis que les estimations
  // de l'IA y entrent au lieu de rester enfermées dans l'item.
  const aVerifier = useStore((s) => (item.foodId ? s.customFoods.find((f) => f.id === item.foodId)?.aVerifier : undefined));
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(false);

  function confirmRemoveItem() {
    if (!window.confirm(`Retirer « ${item.nomAffiche} » de ce repas ?`)) return;
    removeItem(entryId, item.id);
  }

  if (editingItem) {
    return (
      <div className="item-row item-row-edit">
        <ItemFoodField entryId={entryId} item={item} />
        <NumberField
          min={0}
          step={1}
          inputStep="any"
          adaptiveStep
          value={item.quantite}
          onChange={(v) => updateItem(entryId, item.id, { quantite: parseFloat(v.replace(',', '.')) || 0 })}
        />
        <select value={item.unite} onChange={(e) => updateItem(entryId, item.id, { unite: e.target.value as JournalItem['unite'] })}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
        <span className="item-row-actions">
          <button className="ghost small" data-tip="Terminer la modification de cet aliment" onClick={() => setEditingItem(false)}>
            ✓
          </button>
          {canDeleteItem && (
            <button className="danger small" data-tip="Retirer seulement cet aliment du repas" onClick={confirmRemoveItem}>
              ✕
            </button>
          )}
        </span>
      </div>
    );
  }

  // Une fois ajusté « pour cette fois », l'estimation IA est considérée vérifiée.
  // `item.iaEstime` couvre l'historique d'avant la banque personnelle.
  const isIa = (aVerifier || item.iaEstime) && !item.customN;
  return (
    <>
      <div className={`item-row${isIa ? ' ia-estime' : ''}`}>
        <div className="item-name">
          <span>
            {item.nomAffiche}
            {isIa && (
              <span className="badge ia" data-tip="Valeurs nutritionnelles estimées par l'IA (aliment hors base) — ouvrez le détail pour les vérifier / ajuster">
                IA · à vérifier
              </span>
            )}
            {item.customN && (
              <span className="badge adj" data-tip="Valeurs ajustées pour cette fois — l'aliment de la base n'est pas modifié">
                ajusté
              </span>
            )}
            {item.estimation && <span className="badge est">estimé</span>}
            {item.douteux && <span className="badge doubt">à vérifier</span>}
          </span>
          <span className="kcal">
            {fmt(item.quantite, 2)} {UNIT_LABELS[item.unite]} · {fmt(item.grams)} g
          </span>
        </div>
        <span className="mono" style={{ textAlign: 'right' }}>{fmt(item.nutrients.kcal)}</span>
        <span className="small">kcal</span>
        <span className="item-row-actions">
          <button
            className={`ghost small item-detail-toggle${open ? ' on' : ''}`}
            aria-expanded={open}
            data-tip="Voir tout ce que cet aliment apporte / l'ajuster pour cette fois"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? '▲ Détail' : '⌄ Détail'}
          </button>
          <button
            className="ghost small"
            data-tip="Modifier seulement cet aliment (choix, quantité, unité)"
            onClick={() => setEditingItem(true)}
          >
            ✎
          </button>
          {canDeleteItem && (
            <button
              className="danger small"
              data-tip="Retirer seulement cet aliment du repas (sans supprimer les autres)"
              onClick={confirmRemoveItem}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      {open && <ItemDetail entryId={entryId} item={item} />}
    </>
  );
}

/** Nombre de suggestions d'aliments montrées sous le champ. */
const SUGGESTIONS_SHOWN = 8;

/**
 * Champ « quel aliment est-ce ? » : recherche dans la banque (un menu déroulant
 * de 150 entrées est inutilisable au doigt) ET nom libre. Le nom libre est ce
 * qui permet de corriger un plat estimé par l'IA — « pizza » → « pizza
 * 4 fromages » — ou un nom mal entendu à la dictée, sans supprimer la ligne et
 * tout redire.
 */
function ItemFoodField({ entryId, item }: { entryId: string; item: JournalItem }) {
  const updateItem = useStore((s) => s.updateItem);
  const renameItem = useStore((s) => s.renameItem);
  const foods = useEffectiveFoods();
  const [text, setText] = useState(item.nomAffiche);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  // Le nom peut changer sous nos pieds (choix d'un aliment, « Rétablir »).
  useEffect(() => setText(item.nomAffiche), [item.nomAffiche]);

  const results = useMemo(() => {
    const q = normalizeForMatch(text.trim());
    if (!q) return [];
    // Le matching de l'app d'abord (il rattrape fautes et alias), puis le
    // recoupement direct sur le libellé pour tout le reste.
    const m = matchFood(text, foods);
    const byName = foods.filter((f) => [f.nom, ...f.aliases].some((h) => normalizeForMatch(h).includes(q)));
    return dedupeFoods([...(m.food ? [m.food] : []), ...m.alternatives, ...byName]).slice(0, SUGGESTIONS_SHOWN);
  }, [text, foods]);

  const clean = text.trim();
  /** Le texte tapé ne désigne aucun aliment exactement : il vaut comme nom libre. */
  const isFreeName = clean !== '' && clean !== item.nomAffiche && !results.some((f) => f.nom === clean);

  function pickFood(f: Food) {
    updateItem(entryId, item.id, { foodId: f.id });
    setOpen(false);
  }

  function keepFreeName() {
    renameItem(entryId, item.id, text);
    setOpen(false);
  }

  return (
    <span
      className="item-food-field"
      ref={box}
      onBlur={(e) => {
        // Un clic sur une suggestion garde le focus dans le champ composé.
        if (box.current?.contains(e.relatedTarget as Node)) return;
        if (isFreeName) keepFreeName();
        setOpen(false);
      }}
    >
      <input
        value={text}
        aria-label="Nom de l'aliment"
        placeholder="Nom de l'aliment"
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (isFreeName) keepFreeName();
            else setOpen(false);
          }
          if (e.key === 'Escape') {
            setText(item.nomAffiche);
            setOpen(false);
          }
        }}
      />
      {open && (results.length > 0 || isFreeName) && (
        <div className="food-suggest">
          {isFreeName && (
            <button className="food-suggest-free" onMouseDown={(e) => e.preventDefault()} onClick={keepFreeName}>
              Garder « {clean} »<small>nom libre — les apports actuels sont conservés</small>
            </button>
          )}
          {results.map((f) => (
            <button
              key={f.id}
              className={f.id === item.foodId ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickFood(f)}
            >
              {f.nom}
              <small>{fmt(f.n.kcal)} kcal/100 g</small>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Sous-parts d'un nutriment qui ne doivent jamais dépasser leur total (le
 * détail est éditable : rien n'empêche de saisir 20 g de C16 sous 10 g d'AG
 * saturés, autant le dire).
 */
const SPLIT_CHECKS: { parent: NutrientKey; parts: NutrientKey[]; label: string }[] = [
  { parent: 'agSatures', parts: ['agSaturesLdl', 'agSaturesStearique'], label: 'AG saturés' },
  { parent: 'omega3', parts: ['omega3Ala', 'omega3Epa', 'omega3Dha'], label: 'oméga 3' },
];

/**
 * Détail nutritionnel complet d'un item (ce qu'il apporte réellement au bilan),
 * dépliable depuis la ligne. Permet aussi d'ajuster les valeurs « pour cette
 * fois » sans créer de nouvel aliment — utile pour vérifier/corriger les
 * estimations IA ou une portion atypique, y compris dans l'historique.
 */
function ItemDetail({ entryId, item }: { entryId: string; item: JournalItem }) {
  const setItemNutrients = useStore((s) => s.setItemNutrients);
  const targets = useTargets();
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const startEdit = () => {
    setDraft(nutrientsToDraft(item.nutrients));
    setEditing(true);
  };

  const save = () => {
    setItemNutrients(entryId, item.id, draftToContribution(item.nutrients, draft));
    setEditing(false);
  };

  /** Sous-parts saisies au-dessus de leur total : signalé sans bloquer. */
  const splitWarnings = useMemo(() => {
    if (!editing) return [];
    const num = (k: NutrientKey) => parseFloat((draft[k] ?? '').replace(',', '.')) || 0;
    return SPLIT_CHECKS.filter((c) => c.parts.reduce((a, k) => a + num(k), 0) > num(c.parent) * 1.01 + 0.001).map(
      (c) => c.label,
    );
  }, [editing, draft]);

  return (
    <div className="item-detail">
      <div className="item-detail-head">
        <span className="small">
          Apports pour <strong>{fmt(item.grams)} g</strong> de {item.nomAffiche}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {editing ? (
            <>
              <button className="ghost small" onClick={() => setEditing(false)}>
                Annuler
              </button>
              <button className="primary small" onClick={save}>
                Enregistrer
              </button>
            </>
          ) : (
            <>
              {item.customN && (
                <button
                  className="ghost small"
                  data-tip="Rétablir les valeurs de l'aliment de la base"
                  onClick={() => setItemNutrients(entryId, item.id, null)}
                >
                  ↺ Rétablir
                </button>
              )}
              <button className="ghost small" onClick={startEdit}>
                ✎ Ajuster pour cette fois
              </button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <p className="small item-detail-hint">
          Corrigez ce que cet aliment a réellement apporté cette fois (ex. un pain plus protéiné). Les valeurs
          rescalent si vous changez la quantité, et l'aliment de la base n'est pas modifié. Les lignes « ↳ » sont un
          détail de la ligne au-dessus (ex. C16+C14 dans les AG saturés) : elles ne s'ajoutent pas au total.
        </p>
      )}
      {splitWarnings.length > 0 && (
        <p className="small item-detail-warn">
          ⚠ Le détail dépasse le total pour : {splitWarnings.join(', ')}. Vérifiez les lignes « ↳ ».
        </p>
      )}
      {DETAIL_GROUPS.map((g) => (
        <div className="item-detail-group" key={g.title}>
          <div className="idg-title">{g.title}</div>
          <div className="idg-grid">
            {g.keys.map((k) => {
              const t = byKey.get(k);
              if (!t) return null;
              const value = item.nutrients[k] ?? 0;
              const pct = t.optimal > 0 ? (value / t.optimal) * 100 : 0;
              return (
                <div className={`idg-cell${!editing && value <= 0 ? ' zero' : ''}${t.parent ? ' sub' : ''}`} key={k}>
                  <span className="idg-label" data-tip={SHORT_LABELS[k] ? t.label : undefined}>
                    {SHORT_LABELS[k] ?? t.label}
                  </span>
                  {editing ? (
                    <span className="idg-input">
                      <input
                        inputMode="decimal"
                        value={draft[k] ?? ''}
                        onChange={(e) => setDraft((p) => ({ ...p, [k]: e.target.value }))}
                      />
                      <small>{t.unit}</small>
                    </span>
                  ) : (
                    <span className="idg-val mono">
                      {fmt(value, value < 10 ? 1 : 0)} <small>{t.unit}</small>
                      {t.goal !== 'limit' && value > 0 && <span className="idg-pct"> · {fmt(pct)}% obj.</span>}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddItemInline({ entryId }: { entryId: string }) {
  const [text, setText] = useState('');
  const addItemToEntry = useStore((s) => s.addItemToEntry);
  const submit = () => {
    if (!text.trim()) return;
    addItemToEntry(entryId, { aliment: text.trim(), quantite: 1, unite: 'portion', estimation: true });
    setText('');
  };
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <input
        style={{ flex: 1 }}
        placeholder="Ajouter un aliment (ex. « une pomme »)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button onClick={submit}>Ajouter</button>
    </div>
  );
}

function dedupeFoods<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of list) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}
