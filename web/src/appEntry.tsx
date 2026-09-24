import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import { FOODS } from './nutrition/foods';
import './styles.css';

/** Pont de développement pour le harness vidéo (`video/`). */
if (import.meta.env.DEV) {
  (window as unknown as { __fr: unknown }).__fr = { store: useStore, FOODS, ready: true };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
