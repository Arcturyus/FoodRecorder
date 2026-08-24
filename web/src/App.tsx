import { useEffect, useState } from 'react';
import { todayStr } from './store/store';
import { isSyncConfigured } from './sync/supabase';
import { runSyncTick } from './sync/poller';
import { runProfileSyncTick, restoreSession } from './sync/profileSync';
import { useSyncStore } from './sync/syncStore';
import { useQueueStatus, pendingTotal } from './sync/queueStatus';
import { initChangeTracker } from './sync/changeTracker';
import { runAutoSaveTick } from './store/autosave';

/** Intervalle entre deux vérifications de la file de synchro (30 s). */
const SYNC_INTERVAL_MS = 30_000;
/**
 * Cadence resserrée tant que la file n'est pas vide : à 30 s, le bandeau d'un appareil
 * sans pont annoncerait pendant une demi-minute une photo déjà analysée.
 */
const SYNC_INTERVAL_BUSY_MS = 8_000;
import { DayView } from './ui/DayView';
import { DaySwitcher, dayLabel } from './ui/DayPicker';
import { Foods } from './ui/Foods';
import { Stats } from './ui/Stats';
import { Weight } from './ui/Weight';
import { Nutrients } from './ui/Nutrients';
import { History } from './ui/History';
import { Settings } from './ui/Settings';

type Tab = 'jour' | 'historique' | 'stats' | 'poids' | 'aliments' | 'nutriments' | 'reglages';

interface TabMeta {
  id: Tab;
  /** Libellé complet (barre du haut, ordinateur). */
  label: string;
  /** Libellé court (barre du bas, mobile). */
  short: string;
  icon: string;
}

/** Onglets principaux : accessibles directement dans la barre du bas (mobile). */
const PRIMARY_TABS: TabMeta[] = [
  { id: 'jour', label: "Aujourd'hui", short: 'Jour', icon: '🍽' },
  { id: 'poids', label: 'Poids', short: 'Poids', icon: '⚖️' },
  { id: 'historique', label: 'Historique', short: 'Historique', icon: '📅' },
  { id: 'stats', label: 'Stats', short: 'Stats', icon: '📊' },
];

/** Onglets secondaires : regroupés derrière « Plus » sur mobile. Réglages au fond. */
const SECONDARY_TABS: TabMeta[] = [
  { id: 'aliments', label: 'Banque d\'aliments', short: 'Banque', icon: '🥗' },
  { id: 'nutriments', label: 'Nutriments', short: 'Nutriments', icon: '🧬' },
  { id: 'reglages', label: 'Réglages', short: 'Réglages', icon: '⚙️' },
];

const ALL_TABS: TabMeta[] = [...PRIMARY_TABS, ...SECONDARY_TABS];

/**
 * Onglets qui reçoivent la largeur étendue (~1200 px au lieu de 820).
 * La largeur étroite reste le bon choix pour la saisie et les formulaires — une
 * ligne de 1 200 px se lit mal. Elle l'était beaucoup moins pour les vues qui
 * font l'intérêt du projet (nuage de points, carte ACP, tendance, comparateur,
 * heatmap), serrées dans 820 px pendant que 620 px d'écran restaient vides.
 * Le CSS n'applique cette classe qu'au-dessus de 1100 px de fenêtre : téléphone
 * et tablette ne voient aucune différence.
 */
const WIDE_TABS = new Set<Tab>(['stats', 'aliments', 'nutriments', 'historique']);

export function App() {
  const [tab, setTab] = useState<Tab>('jour');
  const [showMore, setShowMore] = useState(false);
  /**
   * Jour affiché par l'onglet « Aujourd'hui ». Reste sur aujourd'hui par défaut
   * (le cas de loin le plus fréquent : zéro clic), mais peut basculer sur un
   * jour passé pour rattraper un oubli sans passer par le calendrier.
   */
  const [dayDate, setDayDate] = useState(todayStr());

  /**
   * Sur l'onglet « Aujourd'hui », remplace le libellé par la date (« 2 août »)
   * dès qu'on n'est plus sur le jour courant : sans ça, le seul indice qu'on a
   * changé de jour est le petit bandeau du DaySwitcher.
   */
  const jourIsToday = dayDate === todayStr();
  const jourLabel = jourIsToday ? "Aujourd'hui" : dayLabel(dayDate, true);
  const jourShort = jourIsToday ? 'Jour' : dayLabel(dayDate, true);

  /**
   * Changer d'onglet remet le jour affiché sur aujourd'hui : un jour passé
   * resté sélectionné ferait enregistrer le repas suivant sur la mauvaise date.
   * On ne le garde donc que le temps où l'on travaille dessus.
   */
  function goTab(id: Tab) {
    if (id === 'jour') setDayDate(todayStr());
    setTab(id);
    setShowMore(false);
  }

  // Suit les changements locaux pour la sync par profil (no-op tant qu'aucun profil n'est joint).
  useEffect(() => {
    initChangeTracker();
  }, []);

  // La session Supabase persistée peut avoir expiré pendant que l'app était fermée : on le
  // constate au démarrage pour afficher tout de suite la demande de mot de passe, plutôt que
  // d'attendre qu'un premier appel réseau échoue.
  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    if (!isSyncConfigured()) return;
    const tick = () => {
      const { profileId, sessionExpired } = useSyncStore.getState();
      if (!profileId || sessionExpired) return; // pont vocal/photo et sync d'état exigent une session active
      runSyncTick();
      runProfileSyncTick();
    };
    tick();
    const id = setInterval(tick, SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * Deuxième boucle, active seulement quand la file a du retard : elle ne relance que
   * `runSyncTick` (la synchro d'état garde son rythme de croisière), et sa garde interne
   * de réentrance ignore l'appel si le pont est déjà en train d'analyser.
   */
  const queueBusy = useQueueStatus((s) => pendingTotal(s.pending) > 0);
  useEffect(() => {
    if (!isSyncConfigured() || !queueBusy) return;
    const id = setInterval(() => {
      const { profileId, sessionExpired } = useSyncStore.getState();
      if (profileId && !sessionExpired) runSyncTick();
    }, SYNC_INTERVAL_BUSY_MS);
    return () => clearInterval(id);
  }, [queueBusy]);

  // Filet de sécurité : une sauvegarde JSON par jour sur le disque, à la
  // première ouverture (sous `npm run dev` uniquement — no-op ailleurs).
  useEffect(() => {
    runAutoSaveTick();
  }, []);

  return (
    <div className={`app${WIDE_TABS.has(tab) ? ' wide' : ''}`}>
      <header className="app-head">
        <h1>🍽️ FoodRecorder</h1>
      </header>

      {/* Barre d'onglets du haut : ordinateur (masquée sur mobile via CSS). */}
      <nav className="tabs">
        {ALL_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => goTab(t.id)}>
            {t.id === 'jour' ? jourLabel : t.label}
          </button>
        ))}
      </nav>

      {tab === 'jour' && (
        <>
          <DaySwitcher date={dayDate} onChange={setDayDate} />
          <DayView date={dayDate} />
        </>
      )}

      {tab === 'historique' && <History />}
      {tab === 'stats' && <Stats />}
      {tab === 'poids' && <Weight />}
      {tab === 'aliments' && <Foods />}
      {tab === 'nutriments' && <Nutrients />}
      {tab === 'reglages' && <Settings />}

      {/* Feuille « Plus » (mobile) : onglets secondaires. */}
      {showMore && (
        <>
          <div className="more-backdrop" onClick={() => setShowMore(false)} />
          <div className="more-sheet" role="menu">
            {SECONDARY_TABS.map((t) => (
              <button
                key={t.id}
                className={`more-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => goTab(t.id)}
              >
                <span className="more-icon">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Barre d'onglets du bas : mobile (masquée sur ordinateur via CSS). */}
      <nav className="tabbar">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.id}
            className={`tabbar-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => goTab(t.id)}
          >
            <span className="tabbar-icon">{t.icon}</span>
            <span className="tabbar-label">{t.id === 'jour' ? jourShort : t.short}</span>
          </button>
        ))}
        <button
          className={`tabbar-btn ${showMore || SECONDARY_TABS.some((t) => t.id === tab) ? 'active' : ''}`}
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          <span className="tabbar-icon">⋯</span>
          <span className="tabbar-label">Plus</span>
        </button>
      </nav>
    </div>
  );
}
