import { useState } from 'react';
import type { JournalEntry, JournalItem } from '../store/store';
import { useStore, useEffectiveFoods, todayStr } from '../store/store';
import { matchFood } from '../nutrition/match';
import { UNITS } from '../nutrition/types';
import { fmt, UNIT_LABELS } from './format';

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
              title="Recopie ce repas tel quel sur aujourd'hui"
              onClick={() => {
                duplicateEntry(entry.id);
                setSaved("Repas dupliqué sur aujourd'hui.");
              }}
            >
              ⧉ Auj.
            </button>
          )}
          <button className="ghost small" title="Enregistrer comme repas favori réutilisable" onClick={saveAsFavorite}>
            ☆ Favori
          </button>
          <button className="ghost small" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Terminer' : 'Modifier'}
          </button>
          <button className="danger small" onClick={() => removeEntry(entry.id)}>
            Suppr.
          </button>
        </div>
      </div>
      {saved && <div className="status">{saved}</div>}
      {entry.transcript && <div className="entry-transcript">« {entry.transcript} »</div>}
      {entry.items.map((it) => (
        <ItemRow key={it.id} entryId={entry.id} item={it} editing={editing} />
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

function ItemRow({ entryId, item, editing }: { entryId: string; item: JournalItem; editing: boolean }) {
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const foods = useEffectiveFoods();

  if (!editing) {
    return (
      <div className="item-row">
        <div className="item-name">
          <span>
            {item.nomAffiche}
            {item.estimation && <span className="badge est">estimé</span>}
            {item.douteux && <span className="badge doubt">à vérifier</span>}
          </span>
          <span className="kcal">
            {fmt(item.quantite, 2)} {UNIT_LABELS[item.unite]} · {fmt(item.grams)} g
          </span>
        </div>
        <span className="mono" style={{ textAlign: 'right' }}>{fmt(item.nutrients.kcal)}</span>
        <span className="small">kcal</span>
        <span />
      </div>
    );
  }

  // Alternatives proposées par le matching pour corriger l'aliment.
  const alts = matchFood(item.nomAffiche, foods).alternatives;
  const options = dedupeFoods([
    ...(item.foodId ? foods.filter((f) => f.id === item.foodId) : []),
    ...alts,
    ...foods,
  ]);

  return (
    <div className="item-row" style={{ gridTemplateColumns: '1fr 70px 120px auto' }}>
      <select
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
      <input
        type="number"
        min={0}
        step="any"
        value={item.quantite}
        onChange={(e) => updateItem(entryId, item.id, { quantite: parseFloat(e.target.value) || 0 })}
      />
      <select value={item.unite} onChange={(e) => updateItem(entryId, item.id, { unite: e.target.value as JournalItem['unite'] })}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))}
      </select>
      <button className="danger small" onClick={() => removeItem(entryId, item.id)}>
        ✕
      </button>
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
