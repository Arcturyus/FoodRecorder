import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import { FOODS } from './nutrition/foods';
import './styles.css';

/**
 * Pont de développement pour le harness vidéo (`video/`).
 *
 * Construire un jeu de démonstration en fabriquant le JSON du localStorage à la
 * main obligerait à réimplémenter le matching, les conversions d'unités et le
 * calcul des apports — donc à produire des chiffres qui divergeraient
 * silencieusement de ceux de l'app. On expose plutôt le store lui-même, et le
 * script de seed rejoue les VRAIES actions (`adoptCatalogFood`, `addEntry`…).
 *
 * Éliminé du build de production : `import.meta.env.DEV` est remplacé par
 * `false` à la compilation, et tout le bloc disparaît au tree-shaking.
 */
if (import.meta.env.DEV) {
  (window as unknown as { __fr: unknown }).__fr = { store: useStore, FOODS, ready: true };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
