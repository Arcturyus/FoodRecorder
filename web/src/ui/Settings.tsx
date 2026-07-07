import { useState } from 'react';
import { useStore } from '../store/store';
import type { ExtractionMode } from '../store/store';
import { LLM_MODELS, loadLlm, isLlmLoaded, loadedModel } from '../extraction/llm';
import { CLOUD_MODELS } from '../extraction/anthropic';
import { STT_MODELS } from '../stt/whisper';

/**
 * Réglages : choix du moteur d'extraction (règles / IA locale / API Claude),
 * clé API, et modèles STT/LLM selon la machine.
 */
export function Settings() {
  const sttModel = useStore((s) => s.sttModel);
  const llmModel = useStore((s) => s.llmModel);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const setSttModel = useStore((s) => s.setSttModel);
  const setLlmModel = useStore((s) => s.setLlmModel);
  const setExtractionMode = useStore((s) => s.setExtractionMode);
  const setCloudApiKey = useStore((s) => s.setCloudApiKey);
  const setCloudModel = useStore((s) => s.setCloudModel);

  const [llmStatus, setLlmStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  async function preloadLlm() {
    setLoading(true);
    setLlmStatus('Téléchargement / chargement du modèle (peut prendre du temps la 1re fois)…');
    try {
      await loadLlm(llmModel, (t, p) => setLlmStatus(`${t} — ${Math.round(p * 100)}%`));
      setLlmStatus(`Modèle IA local prêt : ${loadedModel()}`);
    } catch (e) {
      setLlmStatus(`Échec du chargement (WebGPU requis) : ${(e as Error).message}.`);
    } finally {
      setLoading(false);
    }
  }

  const modes: { id: ExtractionMode; label: string; desc: string }[] = [
    { id: 'rules', label: 'Règles (par défaut)', desc: 'rapide, hors-ligne, 100 % local' },
    { id: 'local', label: 'IA locale (open source)', desc: 'WebLLM dans le navigateur, WebGPU' },
    { id: 'cloud', label: 'API Claude (clé)', desc: 'plus précis, envoie le texte à Anthropic' },
  ];

  return (
    <>
      <div className="panel">
        <h2>Moteur d'extraction</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {modes.map((m) => (
            <label
              key={m.id}
              className="row"
              style={{
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${extractionMode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="mode"
                checked={extractionMode === m.id}
                onChange={() => setExtractionMode(m.id)}
                style={{ width: 'auto' }}
              />
              <span>
                <strong>{m.label}</strong>
                <span className="small"> — {m.desc}</span>
              </span>
            </label>
          ))}
        </div>

        {extractionMode === 'local' && (
          <div style={{ marginTop: 14 }}>
            <div className="row wrap-form">
              <label className="field">
                Modèle local (WebLLM)
                <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>
                  {LLM_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.sizeHint}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={preloadLlm} disabled={loading || !webgpu}>
                {isLlmLoaded() ? 'Recharger le modèle local' : 'Charger le modèle local'}
              </button>
            </div>
            {!webgpu && (
              <div className="hint" style={{ color: 'var(--warn)' }}>
                WebGPU non détecté : l'IA locale est indisponible. Essayez Chrome/Edge récent, ou utilisez
                les règles ou l'API Claude.
              </div>
            )}
            {llmStatus && <div className="status">{llmStatus}</div>}
          </div>
        )}

        {extractionMode === 'cloud' && (
          <div style={{ marginTop: 14 }}>
            <div className="row wrap-form">
              <label className="field" style={{ flex: '1 1 260px' }}>
                Clé API Anthropic
                <span className="row" style={{ gap: 6 }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={cloudApiKey}
                    onChange={(e) => setCloudApiKey(e.target.value)}
                    placeholder="sk-ant-…"
                    style={{ flex: 1 }}
                    autoComplete="off"
                  />
                  <button className="ghost small" type="button" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? 'Masquer' : 'Voir'}
                  </button>
                </span>
              </label>
              <label className="field">
                Modèle Claude
                <select value={cloudModel} onChange={(e) => setCloudModel(e.target.value)}>
                  {CLOUD_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="hint" style={{ color: 'var(--warn)' }}>
              Attention : ce mode envoie le texte de vos repas et votre clé à l'API Anthropic — ce n'est plus
              100 % local. La clé est stockée en clair dans ce navigateur (localStorage). N'utilisez ce mode
              que sur un appareil de confiance.
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Transcription vocale (Whisper)</h2>
        <div className="row wrap-form">
          <label className="field">
            Modèle
            <select value={sttModel} onChange={(e) => setSttModel(e.target.value)}>
              {STT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.sizeHint}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hint">
          La transcription tourne dans le navigateur (aucun envoi). Le modèle est téléchargé une fois puis mis
          en cache. Sur un ordinateur puissant, préférez un modèle plus gros.
        </div>
      </div>
    </>
  );
}
