# FoodRecorder — version web (v1, ordinateur)

Journal nutritionnel où l'on **dicte ou tape** ce qu'on a mangé. Tout tourne dans le navigateur,
**aucune donnée ne sort de la machine**. C'est la première étape avant le portage mobile (React Native),
volontairement sur PC pour tester des modèles un peu plus gros.

## Démarrer

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # tests du matching, du parseur et des calculs
npm run build    # build de production
```

## Comment ça marche

1. **Saisie** : bouton micro (Whisper via transformers.js) ou champ texte.
2. **Extraction** : par défaut un **parseur à règles** en français (rapide, hors-ligne). Optionnellement
   un **LLM on-device** (WebLLM / WebGPU) activable dans Réglages, avec choix du modèle selon la machine.
   Si le LLM échoue, on retombe automatiquement sur le parseur.
3. **Matching** : chaque aliment est rapproché de la base curée (`src/nutrition/foods.ts`, ~110 aliments)
   par recherche floue (trigrammes + tokens + alias).
4. **Calcul** : conversion en grammes (poids par pièce / unités ménagères), puis kcal, macros et
   micronutriments. Un aliment mal reconnu est marqué « à vérifier », une quantité devinée « estimé ».
5. **Auto-validation** : l'entrée est **enregistrée automatiquement**, puis reste modifiable
   (changer l'aliment parmi les alternatives, la quantité, l'unité, ajouter/supprimer un item).

## Micronutriments suivis

Macros (protéines, glucides, lipides, fibres, AG saturés) + fer, magnésium, potassium, calcium, zinc,
sodium, **sélénium**, **iode**, vitamines A, C, D, E, **K1**, **K2**, B9, B12, et **créatine**.
K2 et créatine sont absents des tables officielles (CIQUAL) : valeurs saisies manuellement pour les
viandes, poissons, œufs, fromages et beurre.

## Aliments personnalisés

Onglet « Mes aliments » : ajout rapide d'un aliment avec ses propres calories/macros (micros optionnels)
et un poids par pièce. Il devient ensuite reconnaissable dans la saisie comme les autres.

## Structure

```
src/
  nutrition/   base d'aliments, normalisation, matching, calculs, AJR  (pur TS, testé)
  extraction/  parseur à règles FR + wrapper LLM WebLLM + schéma zod
  stt/         enregistreur micro + Whisper (transformers.js)
  store/       Zustand + persistance localStorage
  ui/          composants React
tests/         Vitest (matching, parseur, calculs)
```

## Limites connues

- Le parseur à règles couvre les formulations courantes ; les phrases très tordues sont mieux gérées
  par le LLM (à activer dans Réglages, nécessite WebGPU — Chrome/Edge récent).
- Les valeurs nutritionnelles sont des approximations (CIQUAL/USDA) destinées au suivi, pas à un usage clinique.
- Le portage mobile et le pipeline CIQUAL complet restent décrits dans `../plan.md`.
```
