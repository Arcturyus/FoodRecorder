import { useState } from 'react';
import { useStore } from '../store/store';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import type { FoodCategory, Nutrients } from '../nutrition/types';
import { fmt } from './format';

/** Champs de micros optionnels exposés dans le formulaire d'ajout. */
const OPTIONAL_MICROS: { key: keyof Nutrients; label: string }[] = [
  { key: 'fibres', label: 'Fibres (g)' },
  { key: 'agSatures', label: 'AG saturés (g)' },
  { key: 'fer', label: 'Fer (mg)' },
  { key: 'calcium', label: 'Calcium (mg)' },
  { key: 'magnesium', label: 'Magnésium (mg)' },
  { key: 'potassium', label: 'Potassium (mg)' },
  { key: 'sodium', label: 'Sodium (mg)' },
];

/**
 * Écran d'aliments personnalisés : l'utilisateur ajoute vite un aliment avec
 * ses propres calories/macros (micros optionnels). Il devient matchable ensuite.
 */
export function CustomFoods() {
  const customFoods = useStore((s) => s.customFoods);
  const addCustomFood = useStore((s) => s.addCustomFood);
  const removeCustomFood = useStore((s) => s.removeCustomFood);

  const [nom, setNom] = useState('');
  const [aliases, setAliases] = useState('');
  const [piece, setPiece] = useState('');
  const [n, setN] = useState<Partial<Nutrients>>({});
  const [showMicros, setShowMicros] = useState(false);

  const setField = (key: keyof Nutrients, v: string) =>
    setN((prev) => ({ ...prev, [key]: v === '' ? undefined : parseFloat(v.replace(',', '.')) }));

  const canSave = nom.trim() !== '' && (n.kcal ?? 0) >= 0 && nom.trim().length >= 2;

  const save = () => {
    if (!canSave) return;
    addCustomFood({
      nom: nom.trim(),
      categorie: 'autre' as FoodCategory,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      pieceGrams: piece ? parseFloat(piece) : undefined,
      n: { ...EMPTY_NUTRIENTS, ...n },
    });
    setNom('');
    setAliases('');
    setPiece('');
    setN({});
    setShowMicros(false);
  };

  return (
    <>
      <div className="panel">
        <h2>Ajouter un aliment personnalisé</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Valeurs pour 100 g. Seules les calories sont obligatoires ; le reste est optionnel.
        </p>
        <div className="row wrap-form">
          <label className="field">
            Nom
            <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Barre protéinée maison" />
          </label>
          <label className="field">
            Synonymes (virgules)
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="barre, ma barre" />
          </label>
          <label className="field">
            Poids d'une pièce (g)
            <input value={piece} onChange={(e) => setPiece(e.target.value)} placeholder="60" inputMode="decimal" />
          </label>
        </div>
        <div className="row wrap-form" style={{ marginTop: 10 }}>
          <label className="field">
            Calories (kcal) *
            <input value={n.kcal ?? ''} onChange={(e) => setField('kcal', e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            Protéines (g)
            <input value={n.proteines ?? ''} onChange={(e) => setField('proteines', e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            Glucides (g)
            <input value={n.glucides ?? ''} onChange={(e) => setField('glucides', e.target.value)} inputMode="decimal" />
          </label>
          <label className="field">
            Lipides (g)
            <input value={n.lipides ?? ''} onChange={(e) => setField('lipides', e.target.value)} inputMode="decimal" />
          </label>
        </div>

        <button className="ghost small" style={{ marginTop: 10 }} onClick={() => setShowMicros((v) => !v)}>
          {showMicros ? '− Masquer les micronutriments' : '+ Micronutriments (optionnel)'}
        </button>
        {showMicros && (
          <div className="row wrap-form" style={{ marginTop: 10 }}>
            {OPTIONAL_MICROS.map((m) => (
              <label className="field" key={m.key}>
                {m.label}
                <input value={(n[m.key] as number | undefined) ?? ''} onChange={(e) => setField(m.key, e.target.value)} inputMode="decimal" />
              </label>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="primary" disabled={!canSave} onClick={save}>
            Enregistrer l'aliment
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Mes aliments ({customFoods.length})</h2>
        {customFoods.length === 0 ? (
          <div className="empty">Aucun aliment personnalisé pour l'instant.</div>
        ) : (
          customFoods.map((f) => (
            <div className="item-row" key={f.id}>
              <div className="item-name">
                <span>{f.nom}</span>
                <span className="kcal">
                  {fmt(f.n.kcal)} kcal · P {fmt(f.n.proteines, 1)} · G {fmt(f.n.glucides, 1)} · L {fmt(f.n.lipides, 1)} /100 g
                  {f.pieceGrams ? ` · 1 pièce ≈ ${fmt(f.pieceGrams)} g` : ''}
                </span>
              </div>
              <span />
              <span />
              <button className="danger small" onClick={() => removeCustomFood(f.id)}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
