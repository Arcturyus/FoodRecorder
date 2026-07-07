# PLAN.md — App de tracking nutritionnel vocal, 100% on-device

> Ce fichier est le plan d'exécution pour Claude Code. Suivre les phases dans l'ordre.
> Chaque phase a des critères d'acceptation : ne pas passer à la suivante tant qu'ils ne sont pas verts.

## RÉVISION 2026-07-07 (demande utilisateur)

1. **V1 web sur ordinateur d'abord** : avant le mobile React Native, une version web (Vite + React + TS)
   qui tourne dans le navigateur sur PC. STT et LLM restent on-device : Whisper via `@huggingface/transformers`
   (WebGPU/WASM) et LLM via `@mlc-ai/web-llm`. **Choix de modèles** dans l'UI (petit/moyen) selon la machine ;
   le mobile viendra ensuite avec des modèles plus petits.
2. **Micronutriments ajoutés** : sélénium, iode, vitamines A, E, K1, K2, + créatine (pas dans CIQUAL →
   valeurs ajoutées manuellement pour viandes/poissons ; K2 pour fromages, œufs, volaille, beurre).
3. **Base d'aliments** : priorité à une couverture large des aliments courants — tous les fruits usuels
   (banane, abricot, pêche, orange, cerise, mangue, kiwi…), œufs, toutes viandes courantes (steak haché,
   filet/cuisse/aile de poulet…), avocat, tomate, haricots verts, pommes de terre, pâtes, riz, chocolat
   (au lait, noir 85 %), fromage blanc, lait, biscuits… Chaque aliment « à la pièce » a un **poids moyen
   par pièce** (ex. 1 mangue ≈ 300 g de chair) utilisé quand l'utilisateur ne donne pas le poids ;
   sinon le poids donné par l'utilisateur prime.
4. **Aliments personnalisés** : l'utilisateur peut ajouter rapidement un aliment avec ses propres
   calories/macros (micros optionnels), utilisable ensuite dans le matching comme les autres.
5. La v1 web utilise une base d'aliments **curée en TypeScript** (valeurs CIQUAL/USDA approximatives,
   ~110 aliments) plutôt que le pipeline CIQUAL complet — le pipeline `build_ciqual.py` reste prévu
   pour la phase mobile. Un **parseur à règles** (regex FR) sert d'extracteur par défaut et de fallback
   si le LLM n'est pas chargé.

## 1. Vision produit (1 paragraphe)

L'utilisateur dicte ce qu'il a mangé ("j'ai mangé un bol de riz avec 150 g de poulet et un yaourt nature").
L'app transcrit l'audio **sur le téléphone** (whisper.cpp), un petit LLM **sur le téléphone** (llama.cpp)
extrait une liste structurée `{aliment, quantité, unité}`, chaque aliment est matché contre la base
CIQUAL (ANSES) embarquée, et l'app calcule kcal, macros et micronutriments clés. **Validation automatique** :
l'entrée est enregistrée directement, mais reste éditable après coup. Aucune donnée ne quitte le téléphone.

## 2. Décisions techniques (figées — ne pas remettre en question sans raison forte)

| Sujet | Choix | Pourquoi |
|---|---|---|
| Framework | **React Native (bare workflow / Expo prebuild) + TypeScript** | Écosystème on-device inference le plus mature : `whisper.rn` et `llama.rn` (même mainteneur, wrappers officieux de whisper.cpp / llama.cpp). L'utilisateur connaît React. |
| STT | **whisper.cpp via `whisper.rn`**, modèle `ggml-small-q5_1` (~190 Mo), langue forcée `fr` | `base` fait trop d'erreurs sur les noms d'aliments FR ; `small` quantisé = bon compromis taille/qualité. |
| LLM extraction | **llama.cpp via `llama.rn`**, modèle **Qwen2.5-1.5B-Instruct GGUF Q4_K_M** (~1,0 Go) | Assez bon pour de l'extraction contrainte, tourne sur un téléphone récent (~2 Go RAM libres requis). |
| Sortie LLM | **Décodage contraint par grammaire GBNF** (JSON strict) | Élimine le JSON malformé. Le LLM ne fait QUE de l'extraction, JAMAIS de valeurs nutritionnelles. |
| Base nutrition | **CIQUAL 2020 (ANSES)** convertie en SQLite, embarquée dans l'app | Table française officielle, macros + micros. Extension future : Open Food Facts (code-barres). |
| Stockage | SQLite (`react-native-quick-sqlite` ou `expo-sqlite`) | Journal, portions apprises, tout en local. |
| Distribution des modèles | Téléchargés au premier lancement (pas bundlés dans l'APK/IPA) | ~1,2 Go de modèles : trop lourd pour le binaire. Écran de setup avec barre de progression + reprise. |
| État UI | Zustand | Simple, suffisant. |

**Interdits :** aucun appel réseau hors téléchargement initial des modèles ; aucune API cloud ;
le LLM ne génère jamais de kcal/macros/micros lui-même.

## 3. Schéma JSON d'extraction (contrat central)

```json
{
  "items": [
    {
      "aliment": "riz blanc cuit",
      "quantite": 150,
      "unite": "g",
      "estimation": false
    }
  ]
}
```

- `unite` ∈ `["g", "ml", "piece", "portion", "cas", "cac", "bol", "verre", "assiette", "tranche", "poignee"]`
- Si l'utilisateur ne donne pas de quantité, le LLM met une quantité par défaut plausible et `estimation: true`.
- Les unités ménagères sont converties en grammes via la table `portion_defaults` (pas par le LLM).

Grammaire GBNF correspondante à écrire dans `assets/grammars/extraction.gbnf` (objet racine, array items,
champs typés, enum d'unités). Tester la grammaire avec llama.cpp desktop avant intégration mobile.

## 4. Architecture du repo

```
/app                    # React Native
  /src
    /audio              # enregistrement micro (react-native-audio-record ou expo-av)
    /stt                # wrapper whisper.rn
    /extraction         # wrapper llama.rn + prompt + grammaire
    /nutrition          # matching CIQUAL + calculs (PUR TypeScript, zéro dépendance native → testable en Jest)
    /db                 # schéma SQLite, migrations, DAO
    /store              # Zustand
    /screens            # UI
    /models             # gestionnaire de téléchargement des modèles (progress, reprise, checksum)
/data-pipeline          # Python : CIQUAL xls → ciqual.sqlite (exécuté en dev, résultat commité en asset)
  build_ciqual.py
  aliases.csv           # synonymes manuels ("pâtes" → "pâtes alimentaires cuites", etc.)
  portions.csv          # unités ménagères → grammes par catégorie d'aliment
/tests
  corpus_fr.jsonl       # phrases de test réalistes + extraction attendue
```

## 5. Phases

### Phase 0 — Setup (petite)
- Init React Native + TS, lint, Jest. Vérifier build Android (priorité) puis iOS.
- Gestionnaire de téléchargement des modèles : URL Hugging Face des GGUF/ggml, progression, checksum SHA256, reprise.
- **Critères :** l'app démarre, télécharge les deux modèles, les checksums passent.

### Phase 1 — Données nutrition (AVANT les modèles : testable sans eux)
- `build_ciqual.py` : télécharger la table CIQUAL (xls sur le site ANSES), nettoyer, produire `ciqual.sqlite` avec :
  - `foods(id, nom, nom_normalise, groupe)`
  - `nutrients(food_id, kcal, proteines, glucides, lipides, fibres, ag_satures, fer, magnesium, potassium, calcium, zinc, sodium, vit_b9, vit_b12, vit_c, vit_d)` — valeurs pour 100 g
  - table FTS5 sur `nom_normalise`
- Module `/nutrition` en pur TS :
  - `normalize(texte)` : minuscules, accents, singulier naïf
  - `matchFood(nom) → {food, score, alternatives[]}` : FTS + score fuzzy (trigrammes). Si score < seuil → flag `douteux`, garder top 3 alternatives pour l'UI d'édition.
  - `computeNutrition(items[]) → totaux` avec conversion unités ménagères via `portions.csv`.
- **Critères :** suite Jest sur ≥ 40 aliments FR courants (dont pièges : "yaourt", "pâtes", "steak haché 5%", "pain complet") avec ≥ 90% de bons matchs top-1.

### Phase 2 — STT
- Intégrer `whisper.rn`, modèle small-q5_1, langue `fr`, enregistrement 16 kHz mono.
- Écran minimal : bouton push-to-talk → texte affiché.
- **Critères :** 10 phrases test dictées transcrites avec les noms d'aliments corrects ; latence < ~5 s pour 15 s d'audio sur un téléphone milieu de gamme.

### Phase 3 — Extraction LLM
- Intégrer `llama.rn` + Qwen2.5-1.5B Q4_K_M + grammaire GBNF.
- Prompt système court (français, few-shot 3 exemples), température 0.
- Valider la sortie avec zod ; si parse KO (ne devrait pas arriver avec la grammaire) → retry 1 fois puis fallback "édition manuelle".
- **Critères :** sur `corpus_fr.jsonl` (≥ 30 phrases : quantités explicites, implicites, plusieurs aliments, formulations orales "euh j'ai pris genre") : ≥ 85% d'extractions correctes (aliments + quantités). Latence < ~8 s.

### Phase 4 — Pipeline complet + auto-validation
- Chaîner : audio → texte → extraction → matching → calcul → **enregistrement automatique** de l'entrée.
- Après enregistrement : carte récap de l'entrée avec bouton "Modifier". L'édition permet : changer l'aliment (proposer les `alternatives` du matching), la quantité, supprimer un item, en ajouter un.
- Les items `douteux` ou `estimation: true` sont visuellement marqués (à vérifier d'un coup d'œil).
- **Critères :** parcours complet dicter → entrée enregistrée sans aucune interaction ; correction d'un item en ≤ 3 taps.

### Phase 5 — Journal & totaux
- Écran du jour : kcal, protéines/glucides/lipides, fibres, + micros clés (fer, magnésium, potassium, calcium, zinc, B9, B12, C, D, sodium) avec % des apports de référence.
- Historique par jour, moyennes 7 jours.
- **Critères :** totaux exacts vs calcul manuel sur une journée de test.

### Phase 6 — Affinage (backlog, pas bloquant)
- Portions apprises par utilisateur ("mon bol de riz" → moyenne de mes corrections passées).
- Alias enrichis au fil des corrections (l'aliment corrigé alimente `aliases`).
- Scan code-barres → Open Food Facts (dump local ou en ligne, à décider plus tard).
- Objectifs personnalisés, export CSV.

## 6. Risques & mitigations

- **RAM téléphone** : Qwen 1.5B Q4 + Whisper small ≈ 1,5–2 Go. Ne jamais charger les deux en même temps : libérer Whisper avant de charger le LLM (ou l'inverse). Si crash sur devices modestes → fallback Qwen2.5-0.5B.
- **Quantités ambiguës** : c'est LE point faible connu. Mitigé par `estimation: true` + marquage visuel + portions apprises. Ne pas chercher la perfection du modèle ici.
- **Matching CIQUAL** : la qualité vient de `aliases.csv` et de la normalisation, pas du LLM. Investir là.
- **iOS** : builds natifs plus pénibles ; valider Android d'abord, iOS en fin de phase 4.

## 7. Conventions pour Claude Code

- TypeScript strict, zod aux frontières (sortie LLM, lecture DB).
- `/nutrition` et `/extraction` (hors appel natif) doivent rester testables en Jest sans device.
- Commits par phase, petits. Chaque phase se termine par ses tests verts.
- Ne pas ajouter de dépendances lourdes sans justification dans le commit.