import { useState } from 'react';

const HINT_KEY = 'foodrecorder-agent-hint-seen';

export function AgentLauncher({ onOpen }: { onOpen: () => void }) {
  const [showHint, setShowHint] = useState(() => localStorage.getItem(HINT_KEY) !== '1');

  function dismissHint() {
    localStorage.setItem(HINT_KEY, '1');
    setShowHint(false);
  }

  function openChat() {
    dismissHint();
    onOpen();
  }

  return <div className="agent-launch-zone">
    {showHint && <aside className="agent-sketch-hint" aria-label="Découvrir le Chat IA">
      <button onClick={dismissHint} aria-label="Masquer cette indication">×</button>
      <strong>Tu peux tout lui demander ici</strong>
      <span>repas, nutriments, poids, soleil… l’IA va chercher dans tes vraies données</span>
      <i aria-hidden="true" />
    </aside>}
    <button className="agent-launcher" onClick={openChat} aria-label="Ouvrir le Chat IA">
      <span className="agent-launcher-icon">✦</span>
      <span className="agent-launcher-label">Chat IA</span>
    </button>
  </div>;
}
