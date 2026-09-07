import { useState } from 'react';
import { CLI_LABELS, listBridgeModels, type BridgeModel } from '../extraction/bridge';
import { CLOUD_PROVIDERS, defaultModelFor, providerInfo, type CloudProvider } from '../extraction/providers';
import { useStore, type CliBridge } from '../store/store';

export function AgentCliPicker() {
  const mode = useStore((s) => s.extractionMode);
  const cli = useStore((s) => s.cliBridge);
  const cliModels = useStore((s) => s.cliModels);
  const cloudProvider = useStore((s) => s.cloudProvider);
  const cloudModels = useStore((s) => s.cloudModels);
  const setCliBridge = useStore((s) => s.setCliBridge);
  const setCliModel = useStore((s) => s.setCliModel);
  const setCloudProvider = useStore((s) => s.setCloudProvider);
  const setCloudModel = useStore((s) => s.setCloudModel);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<BridgeModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [customCloudModel, setCustomCloudModel] = useState(false);

  if (mode === 'cloud') {
    const info = providerInfo(cloudProvider);
    const cloudModel = cloudModels[cloudProvider] ?? defaultModelFor(cloudProvider);
    const known = info.models.some((model) => model.id === cloudModel);
    const showCustom = customCloudModel || !known;
    return <div className="agent-cli-picker">
      <button className="ghost small" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Fermer le choix' : `Changer de modèle · ${info.label} · ${cloudModel}`}
      </button>
      {open && <div className="agent-cli-popover">
        <label>Fournisseur Cloud
          <select value={cloudProvider} onChange={(e) => setCloudProvider(e.target.value as CloudProvider)}>
            {CLOUD_PROVIDERS.map((provider) => <option key={provider} value={provider}>{providerInfo(provider).label}</option>)}
          </select>
        </label>
        <label>Modèle
          <select value={showCustom ? '__custom__' : cloudModel} onChange={(e) => {
            if (e.target.value === '__custom__') setCustomCloudModel(true);
            else { setCustomCloudModel(false); setCloudModel(e.target.value); }
          }}>
            {info.models.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.hint}</option>)}
            <option value="__custom__">Autre identifiant…</option>
          </select>
        </label>
        {showCustom && <label>Identifiant exact
          <input value={known ? '' : cloudModel} onChange={(e) => setCloudModel(e.target.value)} placeholder="modèle fourni par l’API" />
        </label>}
        <button className="ghost small" type="button" onClick={() => setCustomCloudModel(true)}>Saisir un autre modèle</button>
        <small className="agent-model-status">Liste intégrée à l’app ; l’identifiant libre permet un modèle plus récent disponible sur votre compte.</small>
      </div>}
    </div>;
  }

  if (mode !== 'claudecode') return <small className="agent-model-summary">Activez Cloud ou Pont CLI dans Réglages</small>;

  async function refresh(nextCli: CliBridge) {
    setLoading(true);
    setStatus('');
    setModels([]);
    try {
      const result = await listBridgeModels(nextCli);
      setModels(result.models);
      setStatus(result.warning ?? `${result.models.length} modèle(s) disponible(s) détecté(s).`);
    } catch (e) {
      setStatus(`Impossible de lire les modèles : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await refresh(cli);
  }

  const selected = cliModels[cli] ?? '';
  const selectedKnown = models.some((model) => model.id === selected);
  return <div className="agent-cli-picker">
    <button className="ghost small" type="button" onClick={toggle} disabled={loading && !open}>
      {open ? 'Fermer le choix' : `Changer de modèle · ${CLI_LABELS[cli]} · ${selected || 'défaut'}`}
    </button>
    {open && <div className="agent-cli-popover">
      <label>CLI
        <select value={cli} disabled={loading} onChange={(e) => {
          const nextCli = e.target.value as CliBridge;
          setCliBridge(nextCli);
          void refresh(nextCli);
        }}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label>Modèle
        <select value={selected} disabled={loading} onChange={(e) => setCliModel(cli, e.target.value)}>
          <option value="">Défaut de la CLI</option>
          {selected && !selectedKnown && <option value={selected}>{selected} — sélection précédente</option>}
          {models.map((model) => <option key={model.id} value={model.id}>
            {model.label}{model.isDefault ? ' — recommandé' : ''}
          </option>)}
        </select>
      </label>
      <button className="ghost small" type="button" onClick={() => void refresh(cli)} disabled={loading}>
        {loading ? 'Recherche…' : 'Actualiser les modèles'}
      </button>
      {status && <small className="agent-model-status">{status}</small>}
    </div>}
  </div>;
}
