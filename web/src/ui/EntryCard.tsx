import { useMemo, useState } from 'react';
import type { JournalEntry, JournalItem } from '../store/store';
import { useStore, useEffectiveFoods, todayStr } from '../store/store';
import { matchFood } from '../nutrition/match';
import { UNITS, EMPTY_NUTRIENTS } from '../nutrition/types';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { computeTargets } from '../nutrition/targets';
import { fmt, round, UNIT_LABELS } from './format';
import { NumberField } from './NumberField';

/** Carte récap d'une entrée enregistrée, avec édition en place (plan §Phase 4). */
export function EntryCard({ entry }: { entry: JournalEntry }) {
  const [editing, setEditing] = useState(false);
  const removeEntry = useStore((s) => s.removeEntry);
  const moveEntry = useStore((s) => s.moveEntry);
  const duplicateEntry = useStore((s) => s.duplicateEntry);
  const saveFavoriteMeal = useStore((s) => s.saveFavoriteMeal);
  const [saved, setSaved] = useState('');

  const kcal = entry.items.reduce((a, it) => a + it.nutrients.kcal, 0);
  const time = new Date(entry.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const isPast = entry.date !== todayStr();

  function confirmRemoveEntry() {
    const count = entry.items.length;
    if (!window.confirm(`Supprimer ce repas (${count} aliment${count > 1 ? 's' : ''}, ${fmt(kcal)} kcal) ?`)) return;
    removeEntry(entry.id);
  }

  function saveAsFavorite() {
    const suggestion = entry.transcript.replace(/^⭐\s*/, '') || entry.items.map((it) => it.nomAffiche).join(', ');
    const nom = window.prompt('Nom du repas favori (ex. « petit-déj habituel ») :', suggestion);
    if (!nom || !nom.trim()) return;
    saveFavoriteMeal(nom, entry.items);
    setSaved(`⭐ Enregistré comme favori : « ${nom.trim()} » (visible sur l'onglet Aujourd'hui).`);
  }

  return (
    <div className="panel entry-card">
      <div className="entry-meta">
        <span>
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
            <button
              className="ghost small"
              data-tip="Recopie ce repas tel quel sur aujourd'hui"
              onClick={() => {
                duplicateEntry(entry.id);
                setSaved("Repas dupliqué sur aujourd'hui.");
              }}
            >
              ⧉ Auj.
            </button>
          )}
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
      {editing && <AddItemInline entryId={entry.id} />}
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
  const foods = useEffectiveFoods();
  const [open, setOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(false);

  function confirmRemoveItem() {
    if (!window.confirm(`Retirer « ${item.nomAffiche} » de ce repas ?`)) return;
    removeItem(entryId, item.id);
  }

  if (editingItem) {
    // Alternatives proposées par le matching pour corriger l'aliment.
    const alts = matchFood(item.nomAffiche, foods).alternatives;
    const options = dedupeFoods([
      ...(item.foodId ? foods.filter((f) => f.id === item.foodId) : []),
      ...alts,
      ...foods,
    ]);

    return (
      <div className="item-row item-row-edit">
        <select
          className="item-row-edit-food"
          value={item.foodId ?? ''}
          onChange={(e) => updateItem(entryId, item.id, { foodId: e.target.value || null })}
        >
          {!item.foodId && <option value="">{item.nomAffiche} (non trouvé)</option>}
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nom}
            </option>
          ))}
        </select>
        <NumberField
          min={0}
          step={1}
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
  const isIa = item.iaEstime && !item.customN;
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

/** Nutriments détaillés d'un item, regroupés par famille (ordre d'affichage). */
const DETAIL_GROUPS: { title: string; keys: NutrientKey[] }[] = [
  { title: 'Macros', keys: ['kcal', 'proteines', 'glucides', 'lipides', 'fibres'] },
  { title: 'Lipides & oméga', keys: ['agSatures', 'agTrans', 'agMonoInsatures', 'agPolyInsatures', 'omega3', 'omega6', 'omega9'] },
  { title: 'Minéraux', keys: ['fer', 'magnesium', 'potassium', 'calcium', 'zinc', 'sodium', 'selenium', 'iode'] },
  { title: 'Vitamines', keys: ['vitA', 'vitC', 'vitD', 'vitE', 'vitK1', 'vitK2', 'vitB1', 'vitB2', 'vitB3', 'vitB5', 'vitB6', 'vitB9', 'vitB12'] },
  { title: 'Autres', keys: ['creatine'] },
];

/**
 * Détail nutritionnel complet d'un item (ce qu'il apporte réellement au bilan),
 * dépliable depuis la ligne. Permet aussi d'ajuster les valeurs « pour cette
 * fois » sans créer de nouvel aliment — utile pour vérifier/corriger les
 * estimations IA ou une portion atypique, y compris dans l'historique.
 */
function ItemDetail({ entryId, item }: { entryId: string; item: JournalItem }) {
  const profile = useStore((s) => s.profile);
  const setItemNutrients = useStore((s) => s.setItemNutrients);
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const byKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const g of DETAIL_GROUPS) {
      for (const k of g.keys) {
        const v = item.nutrients[k] ?? 0;
        d[k] = v ? String(round(v, v < 10 ? 2 : 0)) : '';
      }
    }
    setDraft(d);
    setEditing(true);
  };

  const save = () => {
    const contribution: Nutrients = { ...EMPTY_NUTRIENTS };
    for (const g of DETAIL_GROUPS) {
      for (const k of g.keys) {
        const raw = draft[k];
        contribution[k] = !raw ? 0 : parseFloat(raw.replace(',', '.')) || 0;
      }
    }
    setItemNutrients(entryId, item.id, contribution);
    setEditing(false);
  };

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
          rescalent si vous changez la quantité, et l'aliment de la base n'est pas modifié.
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
                <div className={`idg-cell${!editing && value <= 0 ? ' zero' : ''}`} key={k}>
                  <span className="idg-label">{t.label}</span>
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
