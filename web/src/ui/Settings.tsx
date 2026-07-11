import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import type { ExtractionMode, SttEngine } from '../store/store';
import { exportJsonFile, exportJournalCsvFile, exportWeightsCsvFile, importBackup } from '../store/backup';
import { LLM_MODELS, loadLlm, isLlmLoaded, loadedModel } from '../extraction/llm';
import { CLOUD_MODELS } from '../extraction/anthropic';
import { checkClaudeCode } from '../extraction/claudeCode';
import { STT_MODELS } from '../stt/whisper';
import { isNativeSttSupported } from '../stt/webspeech';
import { ACTIVITY_LABELS, OBJECTIVE_LABELS, computeTargets } from '../nutrition/targets';
import type { Activity, Objective, Sex } from '../nutrition/targets';
import { fmt } from './format';

/**
 * Réglages : choix du moteur d'extraction (règles / IA locale / API Claude),
 * clé API, et modèles STT/LLM selon la machine.
 */
export function Settings() {
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);
  const llmModel = useStore((s) => s.llmModel);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const setSttEngine = useStore((s) => s.setSttEngine);
  const setSttModel = useStore((s) => s.setSttModel);
  const setLlmModel = useStore((s) => s.setLlmModel);
  const setExtractionMode = useStore((s) => s.setExtractionMode);
  const setCloudApiKey = useStore((s) => s.setCloudApiKey);
  const setCloudModel = useStore((s) => s.setCloudModel);
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);

  const targets = computeTargets(profile);
  const kcalT = targets.find((t) => t.key === 'kcal')!;
  const protT = targets.find((t) => t.key === 'proteines')!;

  const [llmStatus, setLlmStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [ccStatus, setCcStatus] = useState('');
  const [checking, setChecking] = useState(false);

  async function checkBridge() {
    setChecking(true);
    setCcStatus('');
    const s = await checkClaudeCode();
    setChecking(false);
    setCcStatus(
      s.available
        ? `✓ CLI détecté${s.version ? ` (${s.version})` : ''}. Prêt à l'emploi.`
        : `✗ Indisponible : ${s.error ?? 'CLI introuvable'}. Vérifiez que « claude » est installé et connecté, ` +
            'et que l’app tourne bien via « npm run dev » sur cet ordinateur.',
    );
  }

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

  const nativeSupported = isNativeSttSupported();
  const sttEngines: { id: SttEngine; label: string; desc: string; disabled?: boolean }[] = [
    {
      id: 'native',
      label: 'Reconnaissance native (recommandé)',
      desc: 'moteur du navigateur, temps réel, sans téléchargement',
      disabled: !nativeSupported,
    },
    { id: 'whisper', label: 'Whisper (local)', desc: '100 % hors-ligne dans le navigateur' },
  ];

  const modes: { id: ExtractionMode; label: string; desc: string; desktopOnly?: boolean }[] = [
    { id: 'rules', label: 'Règles (par défaut)', desc: 'rapide, hors-ligne, 100 % local' },
    { id: 'local', label: 'IA locale (open source)', desc: 'WebLLM dans le navigateur, WebGPU', desktopOnly: true },
    { id: 'cloud', label: 'API Claude (clé)', desc: 'plus précis, envoie le texte à Anthropic' },
    { id: 'claudecode', label: 'Pont Claude Code', desc: 'via le CLI « claude » déjà connecté, sans clé API', desktopOnly: true },
  ];

  return (
    <>
      <div className="panel">
        <h2>Profil &amp; objectifs</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Sert à calculer vos cibles quotidiennes (AJR et « optimales »). Par défaut : homme sportif de 70 kg.
        </p>
        <div className="row wrap-form">
          <label className="field">
            Sexe
            <select value={profile.sexe} onChange={(e) => setProfile({ sexe: e.target.value as Sex })}>
              <option value="homme">Homme</option>
              <option value="femme">Femme</option>
            </select>
          </label>
          <label className="field">
            Poids (kg)
            <input
              value={profile.poids}
              onChange={(e) => setProfile({ poids: Math.max(1, parseFloat(e.target.value.replace(',', '.')) || 0) })}
              inputMode="decimal"
            />
          </label>
          <label className="field" style={{ flex: '1 1 200px' }}>
            Niveau d'activité
            <select value={profile.activite} onChange={(e) => setProfile({ activite: e.target.value as Activity })}>
              {(Object.keys(ACTIVITY_LABELS) as Activity[]).map((a) => (
                <option key={a} value={a}>
                  {ACTIVITY_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Objectif
            <select
              value={profile.objectif ?? 'maintien'}
              onChange={(e) => setProfile({ objectif: e.target.value as Objective })}
            >
              {(Object.keys(OBJECTIVE_LABELS) as Objective[]).map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hint">
          Cibles optimales calculées : <strong>{fmt(kcalT.optimal)} kcal</strong> ·{' '}
          <strong>{fmt(protT.optimal)} g de protéines</strong> par jour (soit{' '}
          {fmt(protT.optimal / profile.poids, 1)} g/kg).
          {profile.objectif === 'perte' && ' Déficit ~20 % + protéines relevées pour préserver le muscle.'}
          {profile.objectif === 'muscle' && ' Surplus ~10 % + protéines relevées pour la prise de masse.'}
          {' '}Visibles en détail sur l'onglet « Aujourd'hui ».
        </div>
      </div>

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
                {m.desktopOnly && <span className="small"> · 💻 ordinateur uniquement</span>}
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

        {extractionMode === 'claudecode' && (
          <div style={{ marginTop: 14 }}>
            <div className="row">
              <button onClick={checkBridge} disabled={checking}>
                {checking ? 'Vérification…' : 'Vérifier la disponibilité'}
              </button>
            </div>
            {ccStatus && <div className="status">{ccStatus}</div>}
            <div className="hint">
              Ce mode lance le CLI <strong>Claude Code</strong> installé sur cet ordinateur et réutilise votre
              session <strong>déjà connectée</strong> (abonnement Claude Pro/Max) : <strong>aucune clé API</strong> à
              saisir, rien à reconnecter. Fonctionne <strong>uniquement sur l'ordinateur</strong> qui exécute
              l'application via <code>npm run dev</code> — pas sur mobile. La précision dépend du modèle configuré
              dans votre CLI (réglable avec <code>/model</code>).
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Transcription vocale</h2>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          {sttEngines.map((eng) => (
            <label
              key={eng.id}
              className="row"
              style={{
                gap: 10,
                padding: '10px 12px',
                border: `1px solid ${sttEngine === eng.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 10,
                cursor: eng.disabled ? 'not-allowed' : 'pointer',
                opacity: eng.disabled ? 0.55 : 1,
              }}
            >
              <input
                type="radio"
                name="sttEngine"
                checked={sttEngine === eng.id}
                disabled={eng.disabled}
                onChange={() => setSttEngine(eng.id)}
                style={{ width: 'auto' }}
              />
              <span>
                <strong>{eng.label}</strong>
                <span className="small"> — {eng.desc}</span>
                {eng.disabled && <span className="small"> · indisponible sur ce navigateur</span>}
              </span>
            </label>
          ))}
        </div>

        {sttEngine === 'whisper' && (
          <div style={{ marginTop: 14 }}>
            <div className="row wrap-form">
              <label className="field">
                Modèle Whisper
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
              La transcription tourne dans le navigateur (aucun envoi). Le modèle est téléchargé une fois puis
              mis en cache. Sur un ordinateur puissant, préférez un modèle plus gros.
            </div>
          </div>
        )}

        {sttEngine === 'native' && (
          <div className="hint" style={{ marginTop: 14 }}>
            Utilise le moteur de dictée du navigateur/système (souvent Google sur Chrome et Android) :
            généralement <strong>plus précis</strong> et instantané, sans téléchargement. Selon le navigateur,
            l'audio peut transiter par un service de reconnaissance en ligne — ce mode n'est donc pas garanti
            100 % local. Non disponible sur Firefox.
          </div>
        )}
      </div>

      <BackupPanel />
    </>
  );
}

/**
 * Sauvegarde & restauration : les données vivent dans le localStorage d'un seul
 * navigateur — l'export JSON permet d'en sortir (sauvegarde, migration d'appareil),
 * les CSV d'analyser dans un tableur, et l'import JSON de tout restaurer.
 */
function BackupPanel() {
  const entriesCount = useStore((s) => s.entries.length);
  const weightsCount = useStore((s) => s.weightEntries.length);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState('');

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-choisir le même fichier
    if (!file) return;
    try {
      const text = await file.text();
      const ok = window.confirm(
        'Importer cette sauvegarde REMPLACERA les données actuelles de ce navigateur (journal, pesées, aliments perso, favoris). Continuer ?',
      );
      if (!ok) {
        setStatus('Import annulé.');
        return;
      }
      setStatus(importBackup(text));
    } catch (err) {
      setStatus(`Erreur d'import : ${(err as Error).message}`);
    }
  }

  return (
    <div className="panel">
      <h2>Données &amp; sauvegarde</h2>
      <p className="small" style={{ marginTop: -6 }}>
        Vos données ({entriesCount} entrée(s), {weightsCount} pesée(s)) sont stockées dans ce navigateur uniquement.
        Exportez-les régulièrement pour ne pas en dépendre (changement d'appareil, nettoyage du navigateur…).
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" onClick={() => { exportJsonFile(); setStatus('Sauvegarde JSON téléchargée.'); }}>
          ⬇ Exporter tout (JSON)
        </button>
        <button onClick={() => { exportJournalCsvFile(); setStatus('CSV du journal téléchargé.'); }}>
          ⬇ Journal (CSV)
        </button>
        <button onClick={() => { exportWeightsCsvFile(); setStatus('CSV des pesées téléchargé.'); }}>
          ⬇ Pesées (CSV)
        </button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          ⬆ Importer une sauvegarde JSON…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} style={{ display: 'none' }} />
      </div>
      <div className="hint">
        Le JSON contient tout (journal, pesées, aliments perso, repas favoris, profil, constantes) et se ré-importe
        tel quel — la clé API n'y figure pas. Les CSV s'ouvrent dans un tableur (Excel, LibreOffice) mais ne se
        ré-importent pas.
      </div>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
