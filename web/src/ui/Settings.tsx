import { useRef, useState } from 'react';
import { useStore, useCloudConfig } from '../store/store';
import type { CliBridge, ExtractionMode, SttEngine } from '../store/store';
import { exportJsonFile, exportJournalCsvFile, exportWeightsCsvFile, importBackup } from '../store/backup';
import { LLM_MODELS, loadLlm, isLlmLoaded, loadedModel } from '../extraction/llm';
import { CLOUD_PROVIDERS, PROVIDERS, providerInfo } from '../extraction/providers';
import type { CloudProvider } from '../extraction/providers';
import { checkBridge, CLI_LABELS } from '../extraction/bridge';
import { STT_MODELS } from '../stt/whisper';
import { isNativeSttSupported } from '../stt/webspeech';
import { ProfileSyncPanel } from './ProfileSync';
import { AgentActivity } from './AgentActivity';

/**
 * Réglages : connexion au compte de synchro, sauvegarde des données, choix du
 * moteur d'extraction (règles / IA locale / clé API / pont CLI), fournisseur, et modèles
 * STT/LLM selon la machine.
 *
 * La synchro est EN TÊTE : c'est ce qu'on vient chercher en premier sur un
 * nouvel appareil, et sans elle les sauvegardes en dessous n'ont pas le même
 * sens. Elle vivait dans l'onglet du profil, où elle n'était pas une donnée
 * corporelle mais un réglage. Le profil (corps, objectif) reste dans « Poids ».
 */
export function Settings() {
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);
  const llmModel = useStore((s) => s.llmModel);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloud = useCloudConfig();
  const cliBridge = useStore((s) => s.cliBridge);
  const cliModels = useStore((s) => s.cliModels);
  const setSttEngine = useStore((s) => s.setSttEngine);
  const setSttModel = useStore((s) => s.setSttModel);
  const setLlmModel = useStore((s) => s.setLlmModel);
  const setExtractionMode = useStore((s) => s.setExtractionMode);
  const setCloudApiKey = useStore((s) => s.setCloudApiKey);
  const setCloudModel = useStore((s) => s.setCloudModel);
  const setCloudProvider = useStore((s) => s.setCloudProvider);
  const setCliBridge = useStore((s) => s.setCliBridge);
  const setCliModel = useStore((s) => s.setCliModel);

  const [llmStatus, setLlmStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [ccStatus, setCcStatus] = useState('');
  const [checking, setChecking] = useState(false);

  async function verifyBridge() {
    setChecking(true);
    setCcStatus('');
    const s = await checkBridge(cliBridge);
    setChecking(false);
    setCcStatus(
      s.available
        ? `✓ CLI détecté${s.version ? ` (${s.version})` : ''}. Prêt à l'emploi.`
        : `✗ Indisponible : ${s.error ?? 'CLI introuvable'}. Vérifiez que « ${cliBridge} » est installé et ` +
            'connecté, et que l’app tourne bien via « npm run dev » sur cet ordinateur.',
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
    { id: 'cloud', label: 'Clé API — recommandé', desc: 'plus précis ; le texte part chez le fournisseur choisi' },
    {
      id: 'claudecode',
      label: 'Pont CLI — recommandé',
      desc: 'via un CLI déjà connecté sur cet ordinateur, sans clé API',
      desktopOnly: true,
    },
  ];

  const bridges: { id: CliBridge; label: string; desc: string }[] = [
    { id: 'codex', label: 'Codex CLI', desc: 'processus local · authentification existante' },
    { id: 'claude', label: 'Claude Code CLI', desc: 'processus local · authentification existante' },
  ];

  const info = providerInfo(cloud.provider);
  // Un modèle absent de la liste du fournisseur a été saisi à la main : on
  // bascule le sélecteur sur « Autre » plutôt que d'écraser ce choix.
  const knownModel = info.models.some((m) => m.id === cloud.model);

  return (
    <>
      <ProfileSyncPanel />
      <BackupPanel />
      <AgentActivity />

      <div className="panel">
        <h2>Moteur d'extraction</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Ce qui transforme « une pomme et 150 g de riz » en aliments et quantités. Les deux modes Claude (API ou
          pont) sont nettement plus fiables sur les phrases réelles ; les règles restent le repli hors-ligne.
        </p>
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
                les règles ou une clé API.
              </div>
            )}
            {llmStatus && <div className="status">{llmStatus}</div>}
          </div>
        )}

        {extractionMode === 'cloud' && (
          <div style={{ marginTop: 14 }}>
            <label className="field">
              Fournisseur
              <select
                value={cloud.provider}
                onChange={(e) => setCloudProvider(e.target.value as CloudProvider)}
              >
                {CLOUD_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDERS[p].label}
                  </option>
                ))}
              </select>
            </label>

            <div className="hint" style={{ marginTop: 8 }}>
              <strong>Sans payer :</strong> {info.freeTier}
              {info.vision === 'non' && ' Ce fournisseur ne sert aucun modèle capable de lire une photo : le bouton photo reste désactivé.'}
              {info.vision === 'selon-modele' && ' La photo ne marchera que si le modèle choisi est multimodal.'}
            </div>

            <div className="row wrap-form" style={{ marginTop: 10 }}>
              <label className="field" style={{ flex: '1 1 260px' }}>
                Clé API {info.label}
                <span className="row" style={{ gap: 6 }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={cloud.apiKey}
                    onChange={(e) => setCloudApiKey(e.target.value)}
                    placeholder={info.keyPlaceholder}
                    style={{ flex: 1 }}
                    autoComplete="off"
                  />
                  <button className="ghost small" type="button" onClick={() => setShowKey((v) => !v)}>
                    {showKey ? 'Masquer' : 'Voir'}
                  </button>
                </span>
              </label>
              <label className="field">
                Modèle
                <select
                  value={knownModel ? cloud.model : '__autre__'}
                  onChange={(e) => setCloudModel(e.target.value === '__autre__' ? '' : e.target.value)}
                >
                  {info.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.hint}
                    </option>
                  ))}
                  <option value="__autre__">Autre (saisir l’identifiant)…</option>
                </select>
              </label>
            </div>

            {!knownModel && (
              <label className="field" style={{ marginTop: 8 }}>
                Identifiant du modèle
                <input
                  value={cloud.model}
                  onChange={(e) => setCloudModel(e.target.value)}
                  placeholder={info.models[0].id}
                  autoComplete="off"
                />
                <span className="small">
                  Tel qu’il apparaît dans la documentation du fournisseur. Utile quand un modèle est retiré ou
                  qu’un nouveau sort — la liste ci-dessus vieillit, pas ce champ.
                </span>
              </label>
            )}

            <div className="hint" style={{ marginTop: 8 }}>
              Créer une clé : <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyUrl}</a>
            </div>

            <div className="hint" style={{ color: 'var(--warn)' }}>
              Attention : ce mode envoie le texte de vos repas et votre clé à {info.label} — ce n’est plus 100 %
              local. La clé est stockée en clair dans ce navigateur (localStorage) et peut être consultée dans ses
              outils de développement. Utilisez uniquement votre propre clé, sur un appareil de confiance, et
              surveillez les limites de facturation de votre fournisseur. Certains fournisseurs proposent un palier
              API gratuit, pratique pour tester, mais les quotas et conditions varient. Chaque fournisseur garde sa
              propre clé : en changer n’efface pas les autres.
            </div>
          </div>
        )}

        {extractionMode === 'claudecode' && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ marginBottom: 4 }}>Fournisseur d’agent</h3>
            <p className="small" style={{ marginTop: 0 }}>
              Utilisé uniquement lorsque les règles déterministes ne suffisent pas.
            </p>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              {bridges.map((bridge) => (
                <label
                  key={bridge.id}
                  className="row"
                  style={{
                    gap: 10,
                    padding: '14px 16px',
                    border: `1px solid ${cliBridge === bridge.id ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="cliBridge"
                    checked={cliBridge === bridge.id}
                    onChange={() => setCliBridge(bridge.id)}
                    style={{ width: 'auto' }}
                  />
                  <span>
                    <strong>{bridge.label}</strong>
                    <span className="small" style={{ display: 'block' }}>{bridge.desc}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="row wrap-form" style={{ marginTop: 14 }}>
              <label className="field" style={{ flex: '1 1 260px' }}>
                Modèle Codex CLI
                <input
                  value={cliModels.codex ?? ''}
                  onChange={(e) => setCliModel('codex', e.target.value)}
                  placeholder="gpt-5.6-terra"
                  autoComplete="off"
                />
                <span className="small">Laisser vide pour utiliser le modèle configuré par Codex.</span>
              </label>
              <label className="field" style={{ flex: '1 1 260px' }}>
                Modèle Claude Code
                <input
                  value={cliModels.claude ?? ''}
                  onChange={(e) => setCliModel('claude', e.target.value)}
                  placeholder="claude-sonnet-5"
                  autoComplete="off"
                />
                <span className="small">Laisser vide pour utiliser le modèle configuré par Claude Code.</span>
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={verifyBridge} disabled={checking}>
                {checking ? 'Vérification…' : 'Vérifier la disponibilité'}
              </button>
            </div>
            {ccStatus && <div className="status">{ccStatus}</div>}
            <div className="hint">
              Ce mode lance le CLI <strong>{CLI_LABELS[cliBridge]}</strong> installé sur cet ordinateur et
              réutilise votre session <strong>déjà connectée</strong> : <strong>aucune clé API</strong> à saisir,
              rien à reconnecter. Fonctionne <strong>uniquement sur l’ordinateur</strong> qui exécute
              l’application via <code>npm run dev</code> — pas sur mobile. Les réglages ci-dessus sont enregistrés
              immédiatement dans ce navigateur.
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
          ⬇ Suivi corps & apports (CSV)
        </button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          ⬆ Importer une sauvegarde JSON…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleImport} style={{ display: 'none' }} />
      </div>
      <div className="hint">
        Le JSON contient tout (journal, pesées et constantes, aliments perso et aliments modifiés, repas favoris,
        profil, expositions au soleil, notes de jour, jours comptés / non comptés, importances de nutriments,
        réglages d'extraction) et se ré-importe tel quel — la clé API n'y figure pas. Les CSV s'ouvrent dans un
        tableur (Excel, LibreOffice) mais ne se ré-importent pas.
      </div>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
