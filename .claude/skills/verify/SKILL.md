---
name: verify
description: Lancer FoodRecorder et le piloter dans un vrai navigateur pour observer un changement (UI React/Vite, données en localStorage). À utiliser pour vérifier une modif de l'app avant de la considérer comme faite.
---

# Vérifier FoodRecorder en le faisant tourner

## Quand s'en passer

La vérif navigateur a un coût (lancer Vite, piloter Chrome) : **elle n'est pas
toujours nécessaire**. Pour un petit changement dont la correction est déjà
établie autrement — logique pure couverte par un test (`npx vitest run`),
recalibrage d'une constante, typecheck (`npx tsc --noEmit`) qui suffit à prouver
la cohérence, ou modif triviale sans rendu à observer — ne pas lancer le
navigateur : signaler que c'est vérifié par test/typecheck et s'arrêter là.
Réserver le navigateur aux changements dont **le rendu ou l'interaction** est ce
qu'on veut réellement constater (nouveau composant, mise en page, flux UI).

## Faire tourner

App React + Vite, 100 % navigateur : **la surface est la page**. Pas de backend
propre (Supabase et le pont Claude Code sont optionnels). Tout l'état vit dans
`localStorage`, clé **`foodrecorder-v1`**, au format zustand-persist :
`{"state": {...}, "version": 0}`.

## Lancer

```bash
cd web && npm run dev        # en tâche de fond
```

⚠️ **Le port n'est pas toujours 5173** : l'utilisateur a souvent déjà un serveur
dessus, Vite bascule alors sur 5174. **Lire le log de démarrage** pour connaître
le port réel avant de piloter.

## Piloter

Pas de Playwright dans le projet, et inutile d'en installer un dans `web/` :
installer `playwright-core` dans un dossier temporaire et **réutiliser le Chrome
du système** (pas de téléchargement de navigateur) :

```bash
npm install playwright-core
```

```js
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
```

## Les trois pièges (rencontrés, coûteux)

1. **Couper Supabase.** Si `web/.env.local` est configuré, `runSyncTick()` part au
   démarrage, rapatrie les **vraies entrées de l'utilisateur** et les data du jour :
   le jeu de test est pollué par des aliments qu'on n'a jamais injectés. Avant le
   `goto` :
   ```js
   await page.route('**://*.supabase.co/**', (route) => route.abort());
   ```
   (Ça provoque des `ERR_FAILED` en console et un `PAGEERROR: Failed to fetch` —
   attendus, voir plus bas.)

2. **L'unité de l'ajout manuel.** Choisir un aliment pré-sélectionne « pièce »
   quand il a un `pieceGrams` (200 → 200 *pièces* de steak = 60 000 kcal).
   Toujours `await panel.locator('select').selectOption('g')` avant de saisir.

3. **Deux boutons « Ajouter »** dans l'onglet Jour (dictée + ajout manuel) :
   scoper le locator au panneau,
   `page.locator('.panel', { hasText: 'Ajout manuel rapide' })`.

## Injecter un jeu de test

`mergePersisted` complète les nutriments manquants à 0 : des `nutrients` partiels
suffisent (et reproduisent fidèlement un état d'avant migration).

```js
await page.evaluate((entries) => {
  localStorage.setItem('foodrecorder-v1', JSON.stringify({ state: { entries }, version: 0 }));
}, seed());
await page.reload({ waitUntil: 'networkidle' });
```

Un `JournalItem` minimal : `{ id, foodId, nomAffiche, quantite, unite, grams,
nutrients: { kcal, proteines }, estimation: false, douteux: false }`.
Une `JournalEntry` : `{ id, date: 'YYYY-MM-DD', createdAt, transcript, source, items }`.

## Sélecteurs utiles

| Cible | Locator |
|---|---|
| Carte d'un nutriment (bilan du jour) | `.stat` avec `hasText: /Collagène/i` → `"COLLAGÈNE \| 3,2 g \| 32% · AJR 10"` |
| Ligne de couverture (Stats) | `.panel` `{hasText:'Couverture moyenne'}` → `.cov-row` `{hasText:'Créatine'}` |
| Onglets | `getByRole('button', { name: /^Stats$/ })` |

⚠️ `.cov-row` est utilisé par **deux** panneaux de Stats (couverture ET aliments
les plus mangés) : toujours scoper au `.panel` voulu.

Les labels des cartes sont en capitales par CSS (`text-transform`) : `innerText`
renvoie `COLLAGÈNE`, la source dit `Collagène`. Matcher en insensible à la casse.

## Bruit console attendu

- `ERR_FAILED` ×N → les requêtes Supabase coupées volontairement.
- `PAGEERROR: TypeError: Failed to fetch` → `runSyncTick()` ne capture pas les
  erreurs réseau ; se produit aussi hors ligne en vrai. Pré-existant, pas causé
  par le changement testé.
