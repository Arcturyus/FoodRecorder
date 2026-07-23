# analysis/ — cours de rappel ACP sur la banque d'aliments

Analyse **externe à `web/`** qui reproduit à la main la carte ACP de l'app (onglet *Comparer →
Carte ACP*) et déroule les diagnostics classiques d'une ACP, pour comprendre / réviser.

Le notebook est **fidèle à l'app** : mêmes réglages par défaut (base *pour 100 kcal*, nutriments
standardisés puis pondérés par l'importance, compléments exclus) → mêmes chiffres. On retrouve
**PC1 ≈ 23 %** et **PC2 ≈ 17 %** de variance, comme l'avertissement « carte approximative » de l'app.

## Contenu

| Fichier | Rôle |
|---|---|
| `pca_course.ipynb` | Le cours (déjà exécuté, graphes inclus — lisible tel quel). |
| `data/foods.csv` | Banque exportée : un aliment/ligne, valeurs **pour 100 g** (brutes). |
| `data/nutrients.csv` | Métadonnées nutriments (libellé, unité, AJR, objectif, importance, famille). |
| `export_data.ts` | Régénère les CSV depuis la source TS (à relancer si la banque change). |
| `_build_notebook.py` | Régénère le `.ipynb` (le notebook est construit par code, pas édité à la main). |
| `run.py` | Exécute le notebook et le réenregistre avec ses sorties, sans ouvrir Jupyter. |

## Ce que le notebook couvre

1. Construction de la matrice aliments × nutriments (base 100 kcal).
2. Standardisation (z-score) + pondération par l'importance.
3. ACP par SVD + **variance expliquée par PC1, PC2, PC3…** (scree + cumulé).
4. **Quels nutriments comptent pour combien** dans PC1–PC4 (loadings + contributions %, barres, heatmap).
5. Le **biplot** : aliments **et** nutriments sur la même carte (paramètre α ; distances vs corrélations).
6. **Pourquoi les aliments sont au centre et les flèches loin — sauf les épinards** (standardisation +
   base 100 kcal + rééchelonnage des flèches).
7. Diagnostics classiques : **cos²** (qualité de représentation en 2D) et contributions.
8. **Autres projections 2D** : **t-SNE** et **MDS** comparées à l'ACP — ce que chacune préserve, leurs
   pièges, et comment un utilisateur s'en sert (repérer familles/intrus, distances honnêtes, etc.).

Trois boutons à jouer en tête de notebook — `BASE`, `WEIGHTED`, `EXCLUDE_SUPPLEMENTS` — puis *Run All*
pour voir la carte se réorganiser.

## Mise en route

```bash
cd analysis
python -m venv .venv
# Windows : .venv\Scripts\activate      |  macOS/Linux : source .venv/bin/activate
pip install -r requirements.txt

# Ouvrir (interactif) :
jupyter lab pca_course.ipynb
# ... ou relancer sans Jupyter (réenregistre les graphes) :
python run.py
```

### Régénérer les données depuis la banque TS

Si tu modifies la banque (`web/src/nutrition/foods.ts`) :

```bash
cd web
npx vite-node ../analysis/export_data.ts     # réécrit analysis/data/*.csv
```
