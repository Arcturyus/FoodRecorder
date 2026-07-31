import { useMemo, useState } from 'react';
import { normalize, isSupplementQuery } from '../nutrition/normalize';
import { RDA } from '../nutrition/rda';
import type { RdaEntry } from '../nutrition/rda';
import { computeTargets } from '../nutrition/targets';
import { useStore, useEffectiveFoods } from '../store/store';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import type { Food, FoodCategory, NutrientKey, Nutrients } from '../nutrition/types';
import { fmt, UNIT_LABELS, CATEGORY_LABELS } from './format';
import { FoodExplorer } from './FoodExplorer';
import { FoodCompare } from './FoodCompare';
import { FoodConsumption } from './FoodFrequency';

const LABEL_BY_KEY = new Map(CATEGORY_LABELS.map((c) => [c.key, c.label]));

/** Base toujours affichée en dur (calories, protéines, glucides, lipides). */
const BASE_MACRO_KEYS = new Set<keyof Nutrients>(['kcal', 'proteines', 'glucides', 'lipides']);

/**
 * Champs de micros optionnels exposés dans le formulaire d'ajout / d'édition :
 * tous les nutriments du type `Nutrients` sauf les 4 macros de base ci-dessus,
 * pour que rien (collagène, créatine, iode, vitamines, AG détaillés…) ne soit
 * impossible à corriger — un champ non renseigné reste traité comme zéro.
 */
const OPTIONAL_MICROS: { key: keyof Nutrients; label: string }[] = RDA.filter(
  (r: RdaEntry) => !BASE_MACRO_KEYS.has(r.key) && !r.parent,
).map((r) => ({ key: r.key, label: `${r.label} (${r.unit})` }));

/**
 * Sous-détails d'un nutriment composite : ils ont leur propre bloc de saisie
 * plutôt que d'être noyés dans la liste des micronutriments, parce qu'ils ne
 * s'additionnent pas au reste — ce sont des MORCEAUX d'un total déjà saisi, et
 * on veut pouvoir vérifier d'un coup d'œil que la somme reste cohérente.
 */
const SUB_DETAIL_GROUPS: { total: keyof Nutrients; totalLabel: string; parts: { key: keyof Nutrients; label: string; hint: string }[] }[] = [
  {
    total: 'agSatures',
    totalLabel: 'AG saturés',
    parts: [
      { key: 'agSaturesLdl', label: 'dont C16+C14 (g)', hint: 'palmitique + myristique — ceux qui font monter le LDL' },
      { key: 'agSaturesStearique', label: 'dont C18 stéarique (g)', hint: 'neutre sur le LDL (beurre de cacao, bœuf)' },
    ],
  },
  {
    total: 'omega3',
    totalLabel: 'Oméga 3',
    parts: [
      { key: 'omega3Ala', label: 'dont ALA (g)', hint: 'végétal brut — ne compte que pour 1/10 dans la cible' },
      { key: 'omega3Epa', label: 'dont EPA (g)', hint: 'marin/animal, compte en direct' },
      { key: 'omega3Dha', label: 'dont DHA (g)', hint: 'marin/animal, compte en direct' },
    ],
  },
];

type Mode = 'liste' | 'classement' | 'consommation' | 'explorer' | 'comparer';

/**
 * Onglet « Banque d'aliments » : fusion de l'ancienne banque et des aliments perso.
 * Tout aliment (banque ou perso) est modifiable. Cinq modes :
 *  - « Liste » : recherche/filtre, ajout perso et édition en place de chaque aliment ;
 *  - « Classement » : aliments les plus riches en un nutriment choisi (pour 100 g) ;
 *  - « Consommation » : ce que VOUS mangez le plus (fréquences sur le journal) ;
 *  - « Explorer visuel » : atelier de visualisations D3 ;
 *  - « Comparer » : deux aliments face à face + carte ACP de toute la banque.
 */
export function Foods() {
  const [mode, setMode] = useState<Mode>('liste');
  const [compareIds, setCompareIds] = useState<[string | null, string | null]>([null, null]);
  const foods = useEffectiveFoods();

  /** Depuis la liste : « comparer » charge l'aliment en emplacement A et bascule sur le mode. */
  const startCompare = (id: string) => {
    setCompareIds(([, b]) => [id, b === id ? null : b]);
    setMode('comparer');
  };

  return (
    <>
      <div className="panel">
        <h2>Banque d'aliments ({foods.length})</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Banque curée (approximations CIQUAL 2020 / USDA) + vos aliments perso. Valeurs pour 100 g. Tout est modifiable.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`ghost small ${mode === 'liste' ? 'chip-active' : ''}`} onClick={() => setMode('liste')}>
            Liste
          </button>
          <button
            className={`ghost small ${mode === 'classement' ? 'chip-active' : ''}`}
            onClick={() => setMode('classement')}
          >
            Classement par nutriment
          </button>
          <button
            className={`ghost small ${mode === 'consommation' ? 'chip-active' : ''}`}
            onClick={() => setMode('consommation')}
          >
            Ma consommation
          </button>
          <button
            className={`ghost small ${mode === 'explorer' ? 'chip-active' : ''}`}
            onClick={() => setMode('explorer')}
          >
            Explorer visuel
          </button>
          <button
            className={`ghost small ${mode === 'comparer' ? 'chip-active' : ''}`}
            onClick={() => setMode('comparer')}
          >
            ⚖️ Comparer
          </button>
        </div>
      </div>

      {mode === 'liste' && <FoodList foods={foods} onCompare={startCompare} />}
      {mode === 'classement' && <NutrientRanking foods={foods} />}
      {mode === 'consommation' && <FoodConsumption />}
      {mode === 'explorer' && <FoodExplorer foods={foods} />}
      {mode === 'comparer' && <FoodCompare foods={foods} ids={compareIds} setIds={setCompareIds} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mode « Liste » : recherche + filtres + ajout perso + édition en place
// ---------------------------------------------------------------------------

function FoodList({ foods, onCompare }: { foods: Food[]; onCompare: (id: string) => void }) {
  const overrides = useStore((s) => s.foodOverrides);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FoodCategory | 'all'>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const q = normalize(query);

  const filtered = useMemo(
    () =>
      foods.filter((f) => {
        if (onlyMine && !f.custom) return false;
        if (cat !== 'all' && f.categorie !== cat) return false;
        if (!q) return true;
        if (normalize(f.nom).includes(q)) return true;
        if (f.aliases.some((a) => normalize(a).includes(q))) return true;
        // « supplément »/« complément » : fait remonter toute la catégorie
        return f.categorie === 'supplement' && isSupplementQuery(q);
      }),
    [foods, q, cat, onlyMine],
  );

  const groups = useMemo(
    () =>
      CATEGORY_LABELS.map((c) => ({ ...c, foods: filtered.filter((f) => f.categorie === c.key) })).filter(
        (g) => g.foods.length > 0,
      ),
    [filtered],
  );

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Ajouter un aliment perso</h2>
          <button className="ghost small" onClick={() => setAdding((v) => !v)}>
            {adding ? 'Fermer' : '+ Nouvel aliment'}
          </button>
        </div>
        {adding && <FoodForm submitLabel="Enregistrer l'aliment" onDone={() => setAdding(false)} />}
      </div>

      <div className="panel">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un aliment (nom ou synonyme)…"
          style={{ width: '100%' }}
        />
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <button className={`ghost small ${cat === 'all' && !onlyMine ? 'chip-active' : ''}`} onClick={() => { setCat('all'); setOnlyMine(false); }}>
            Tout
          </button>
          <button className={`ghost small ${onlyMine ? 'chip-active' : ''}`} onClick={() => setOnlyMine((v) => !v)}>
            ⭐ Mes aliments
          </button>
          {CATEGORY_LABELS.map((c) => (
            <button
              key={c.key}
              className={`ghost small ${cat === c.key ? 'chip-active' : ''}`}
              onClick={() => setCat(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="panel">
          <div className="empty">Aucun aliment ne correspond{query ? ` à « ${query} »` : ''}.</div>
        </div>
      ) : (
        groups.map((g) => (
          <div className="panel" key={g.key}>
            <h2>
              {LABEL_BY_KEY.get(g.key)} <span className="small">({g.foods.length})</span>
            </h2>
            {g.foods.map((f) =>
              editId === f.id ? (
                <FoodForm key={f.id} food={f} submitLabel="Enregistrer" onDone={() => setEditId(null)} />
              ) : (
                <FoodRow
                  key={f.id}
                  food={f}
                  modified={!!overrides[f.id]}
                  onEdit={() => setEditId(f.id)}
                  onCompare={() => onCompare(f.id)}
                />
              ),
            )}
          </div>
        ))
      )}
    </>
  );
}

/** Ligne d'un aliment (lecture) avec actions comparer / éditer / réinitialiser / supprimer. */
function FoodRow({ food, modified, onEdit, onCompare }: { food: Food; modified: boolean; onEdit: () => void; onCompare: () => void }) {
  const removeCustomFood = useStore((s) => s.removeCustomFood);
  const resetFood = useStore((s) => s.resetFood);
  const f = food;
  return (
    <div className="item-row" style={{ gridTemplateColumns: '1fr auto auto auto' }}>
      <div className="item-name">
        <span>
          {f.nom}
          {f.custom && <span className="badge est">perso</span>}
          {modified && <span className="badge doubt">modifié</span>}
        </span>
        <span className="kcal">
          {fmt(f.n.kcal)} kcal · P {fmt(f.n.proteines, 1)} · G {fmt(f.n.glucides, 1)} · L {fmt(f.n.lipides, 1)}
          {f.n.fibres ? ` · Fibres ${fmt(f.n.fibres, 1)}` : ''} /100 g{portionLabel(f)}
        </span>
      </div>
      <button className="ghost small" onClick={onCompare} data-tip="Comparer cet aliment">
        ⚖️
      </button>
      <button className="ghost small" onClick={onEdit}>
        ✏️ Modifier
      </button>
      {f.custom ? (
        <button
          className="danger small"
          data-tip="Supprimer cet aliment perso"
          onClick={() => window.confirm(`Supprimer l'aliment personnalisé « ${f.nom} » ?`) && removeCustomFood(f.id)}
        >
          ✕
        </button>
      ) : modified ? (
        <button className="ghost small" onClick={() => resetFood(f.id)} data-tip="Rétablir les valeurs d'origine">
          ↺
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * Saisie des sous-détails d'un nutriment composite (répartition des AG saturés,
 * des oméga 3). Affiche le total de référence et signale une somme incohérente :
 * ce sont des morceaux, ils ne peuvent pas dépasser le tout. Sans ce garde-fou,
 * une coquille passerait inaperçue et fausserait le plafond qui compte.
 */
function SubDetailFields({
  group,
  n,
  setField,
}: {
  group: (typeof SUB_DETAIL_GROUPS)[number];
  n: Partial<Nutrients>;
  setField: (key: keyof Nutrients, v: string) => void;
}) {
  const total = (n[group.total] as number | undefined) ?? 0;
  const sum = group.parts.reduce((a, p) => a + ((n[p.key] as number | undefined) ?? 0), 0);
  const incoherent = sum > total + 0.01;
  return (
    <div style={{ marginTop: 10 }}>
      <div className="small" style={{ color: 'var(--muted)' }}>
        Répartition — {group.totalLabel} : <strong className="mono">{total || 0} g</strong> au total, dont{' '}
        <span className="mono" style={incoherent ? { color: 'var(--danger)' } : undefined}>{sum.toFixed(2)} g</span> détaillés.
        {incoherent && ' ⚠ la somme dépasse le total.'}
      </div>
      <div className="row wrap-form" style={{ marginTop: 6 }}>
        {group.parts.map((p) => (
          <label className="field" key={p.key} data-tip={p.hint}>
            {p.label}
            <input
              value={(n[p.key] as number | undefined) ?? ''}
              onChange={(e) => setField(p.key, e.target.value)}
              inputMode="decimal"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Formulaire d'ajout (food absent) ou d'édition (food fourni) d'un aliment.
 * À l'ajout : crée un aliment perso. À l'édition : override banque ou édition perso.
 */
function FoodForm({ food, submitLabel, onDone }: { food?: Food; submitLabel: string; onDone: () => void }) {
  const addCustomFood = useStore((s) => s.addCustomFood);
  const editFood = useStore((s) => s.editFood);

  const [nom, setNom] = useState(food?.nom ?? '');
  const [aliases, setAliases] = useState(food?.aliases.join(', ') ?? '');
  const [piece, setPiece] = useState(food?.pieceGrams != null ? String(food.pieceGrams) : '');
  const [n, setN] = useState<Partial<Nutrients>>(food ? { ...food.n } : {});
  const [showMicros, setShowMicros] = useState(false);

  const setField = (key: keyof Nutrients, v: string) =>
    setN((prev) => ({ ...prev, [key]: v === '' ? undefined : parseFloat(v.replace(',', '.')) }));

  const canSave = nom.trim().length >= 2 && (n.kcal ?? 0) >= 0;

  const save = () => {
    if (!canSave) return;
    const patch = {
      nom: nom.trim(),
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
      pieceGrams: piece ? parseFloat(piece) : undefined,
      n: { ...EMPTY_NUTRIENTS, ...n },
    };
    if (food) {
      editFood(food.id, patch);
    } else {
      addCustomFood({ ...patch, categorie: 'autre' as FoodCategory });
    }
    onDone();
  };

  return (
    <div className="food-form">
      <p className="small" style={{ marginTop: 0 }}>
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
        <>
          <div className="row wrap-form" style={{ marginTop: 10 }}>
            {OPTIONAL_MICROS.map((m) => (
              <label className="field" key={m.key}>
                {m.label}
                <input value={(n[m.key] as number | undefined) ?? ''} onChange={(e) => setField(m.key, e.target.value)} inputMode="decimal" />
              </label>
            ))}
          </div>
          {SUB_DETAIL_GROUPS.map((g) => (
            <SubDetailFields key={g.total} group={g} n={n} setField={setField} />
          ))}
        </>
      )}

      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end', gap: 8 }}>
        <button className="ghost small" onClick={onDone}>
          Annuler
        </button>
        <button className="primary" disabled={!canSave} onClick={save}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode « Classement » : aliments les plus riches en un nutriment donné
// ---------------------------------------------------------------------------

const TOP_N = 30;

function NutrientRanking({ foods }: { foods: Food[] }) {
  const profile = useStore((s) => s.profile);
  const targets = useMemo(() => computeTargets(profile), [profile]);

  const [key, setKey] = useState<NutrientKey>('proteines');
  const t = targets.find((r) => r.key === key)!;
  const distinct = !t.upperLimit && t.optimal !== t.ajr;

  const ranked = useMemo(
    () =>
      // Les compléments (produits purs très concentrés) sont exclus : sinon un
      // comprimé de vitamine C écraserait tous les vrais aliments du classement.
      foods
        .filter((f) => f.categorie !== 'supplement' && f.n[key] > 0)
        .sort((a, b) => b.n[key] - a.n[key])
        .slice(0, TOP_N),
    [foods, key],
  );

  const maxFood = ranked.length ? ranked[0].n[key] : 0;
  const scaleMax = Math.max(maxFood, t.ajr, t.optimal) || 1;
  const ajrPos = (t.ajr / scaleMax) * 100;
  const optPos = (t.optimal / scaleMax) * 100;

  return (
    <>
      <div className="panel">
        <label className="field" style={{ maxWidth: 340 }}>
          Trouver les aliments les plus riches en…
          <select value={key} onChange={(e) => setKey(e.target.value as NutrientKey)}>
            {RDA.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label} ({r.unit})
              </option>
            ))}
          </select>
        </label>
        <p className="small" style={{ marginBottom: 6 }}>
          Top {ranked.length} · valeurs pour 100 g. La barre montre la part du besoin couverte par 100 g.
        </p>
        <div className="row small" style={{ gap: 14 }}>
          <span>
            <i className="ref-legend ajr" /> AJR {fmt(t.ajr)} {t.unit}/j
          </span>
          {distinct && (
            <span>
              <i className="ref-legend opti" /> Optimal sportif {fmt(t.optimal)} {t.unit}/j
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        {ranked.length === 0 ? (
          <div className="empty">Aucun aliment renseigné pour ce nutriment.</div>
        ) : (
          ranked.map((f, i) => {
            const value = f.n[key];
            const pctAjr = t.ajr > 0 ? (value / t.ajr) * 100 : 0;
            const pctOpt = t.optimal > 0 ? (value / t.optimal) * 100 : 0;
            return (
              <div className="stat" key={f.id} style={{ marginBottom: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    <span className="small mono">#{i + 1}</span> {f.nom}
                  </span>
                  <span className="mono">
                    {fmt(value, value < 10 ? 1 : 0)} {t.unit}
                  </span>
                </div>
                <div className="bar good">
                  <span style={{ width: `${Math.min(100, (value / scaleMax) * 100)}%` }} />
                  <i className="mark ajr" style={{ left: `${ajrPos}%` }} data-tip={`AJR ${fmt(t.ajr)} ${t.unit}`} />
                  {distinct && (
                    <i className="mark opti" style={{ left: `${optPos}%` }} data-tip={`Optimal ${fmt(t.optimal)} ${t.unit}`} />
                  )}
                </div>
                <div className="small mono">
                  {fmt(pctAjr)}% AJR{distinct ? ` · ${fmt(pctOpt)}% opti` : ''} / 100 g
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/** Décrit les portions/pièces d'un aliment (poids par pièce + unités surchargées). */
function portionLabel(f: Food): string {
  const parts: string[] = [];
  if (f.pieceGrams) parts.push(`1 pièce ≈ ${fmt(f.pieceGrams)} g`);
  if (f.unitGrams) {
    for (const [unit, g] of Object.entries(f.unitGrams)) {
      if (unit === 'piece' && f.pieceGrams) continue;
      parts.push(`1 ${UNIT_LABELS[unit as keyof typeof UNIT_LABELS]} ≈ ${fmt(g as number)} g`);
    }
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}
