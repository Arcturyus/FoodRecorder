import { useState } from 'react';
import type { JournalEntry, JournalItem } from '../store/store';
import { useStore } from '../store/store';
import { FOODS } from '../nutrition/foods';
import { matchFood } from '../nutrition/match';
import { UNITS } from '../nutrition/types';
import { fmt, UNIT_LABELS } from './format';

/** Carte récap d'une entrée enregistrée, avec édition en place (plan §Phase 4). */
export function EntryCard({ entry }: { entry: JournalEntry }) {
  const [editing, setEditing] = useState(false);
  const removeEntry = useStore((s) => s.removeEntry);

  const kcal = entry.items.reduce((a, it) => a + it.nutrients.kcal, 0);
  const time = new Date(entry.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="panel entry-card">
      <div className="entry-meta">
        <span>
          {time} · {fmt(kcal)} kcal ·{' '}
          {entry.source === 'llm' ? 'IA' : entry.source === 'rules' ? 'auto' : 'manuel'}
        </span>
        <div className="row">
          <button className="ghost small" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Terminer' : 'Modifier'}
          </button>
          <button className="danger small" onClick={() => removeEntry(entry.id)}>
            Suppr.
          </button>
        </div>
      </div>
      {entry.transcript && <div className="entry-transcript">« {entry.transcript} »</div>}
      {entry.items.map((it) => (
        <ItemRow key={it.id} entryId={entry.id} item={it} editing={editing} />
      ))}
      {editing && <AddItemInline entryId={entry.id} />}
    </div>
  );
}

function ItemRow({ entryId, item, editing }: { entryId: string; item: JournalItem; editing: boolean }) {
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const customFoods = useStore((s) => s.customFoods);

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
  const alts = matchFood(item.nomAffiche, customFoods).alternatives;
  const options = dedupeFoods([
    ...(item.foodId ? FOODS.filter((f) => f.id === item.foodId) : []),
    ...customFoods,
    ...alts,
    ...FOODS,
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
