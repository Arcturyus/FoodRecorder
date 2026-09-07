import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTurn } from '../extraction/cloud';
import { DEFAULT_AGENT_LIMITS, type AgentActionPlan, type AgentApprovalMode, type AgentLimits, type AgentProgress, type AgentUsage } from '../agent/protocol';
import { runAgent, type AgentRunEvent } from '../agent/loop';
import { useStore } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { NativeRecognizer } from '../stt/webspeech';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { AgentActivity } from './AgentActivity';
import { AgentCliPicker } from './AgentCliPicker';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools?: AgentRunEvent[];
  meta?: string;
  diagnostics?: AgentUsage;
  modelCalls?: AgentUsage[];
}

const CHAT_KEY = 'foodrecorder-agent-chat';
const LIMITS_KEY = 'foodrecorder-agent-limits';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(fallback)) return (Array.isArray(parsed) ? parsed : fallback) as T;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...fallback, ...parsed }
      : fallback;
  } catch {
    return fallback;
  }
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  })}</>;
}

function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    nodes.push(<ul key={`l-${nodes.length}`}>{list.map((x, i) => <li key={i}><Inline text={x} /></li>)}</ul>);
    list = [];
  };
  lines.forEach((line) => {
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (bullet) { list.push(bullet[1]); return; }
    flush();
    if (!line.trim()) return;
    const heading = line.match(/^#{1,3}\s+(.+)/);
    nodes.push(heading
      ? <h4 key={nodes.length}><Inline text={heading[1]} /></h4>
      : <p key={nodes.length}><Inline text={line} /></p>);
  });
  flush();
  return <div className="agent-markdown">{nodes}</div>;
}

function LimitField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <label><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} /></label>;
}

function ChangePreview({ plan }: { plan: AgentActionPlan }) {
  if (!plan.changes?.length) return null;
  return <div className="agent-change-preview">
    {plan.changes.map((group) => <section key={group.id}>
      <strong>{group.label}</strong>
      <div className="agent-change-table-wrap"><table><thead><tr><th>Champ</th><th>Avant</th><th>Après</th></tr></thead><tbody>
        {group.fields.map((field) => <tr key={field.key}><td>{field.label}</td><td>{field.before ?? '—'}{field.unit ? ` ${field.unit}` : ''}</td><td>{field.after ?? '—'}{field.unit ? ` ${field.unit}` : ''}</td></tr>)}
      </tbody></table></div>
    </section>)}
  </div>;
}

function progressLabel(progress: AgentProgress | null, elapsedMs: number, limits: AgentLimits): string {
  if (!progress) return 'Préparation…';
  const tokens = (progress.usage.inputTokens ?? 0) + (progress.usage.outputTokens ?? 0) + (progress.usage.reasoningTokens ?? 0);
  const phase = progress.phase === 'model' ? 'appel du modèle' : progress.phase === 'approval' ? 'confirmation' : 'outils';
  return `${phase} · tour ${progress.turn}/${limits.maxAgentTurns} · ${progress.toolCalls}/${limits.maxToolCallsPerMessage} outils · ${tokens} tokens comptabilisés · ${(elapsedMs / 1000).toFixed(0)} s`;
}

export function AgentChat() {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>(() => loadJson(CHAT_KEY, []));
  const [limits, setLimits] = useState<AgentLimits>(() => loadJson(LIMITS_KEY, DEFAULT_AGENT_LIMITS));
  const [showLimits, setShowLimits] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>('confirm-writes');
  const [pending, setPending] = useState<AgentActionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dictationStatus, setDictationStatus] = useState('');
  const [error, setError] = useState('');
  const [liveProgress, setLiveProgress] = useState<AgentProgress | null>(null);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const nativeRef = useRef<NativeRecognizer | null>(null);
  const approvalRef = useRef<((approved: boolean) => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const runStartedRef = useRef(0);
  const sttEngine = useStore((state) => state.sttEngine);
  const sttModel = useStore((state) => state.sttModel);

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages]);
  useEffect(() => {
    localStorage.setItem(LIMITS_KEY, JSON.stringify(limits));
  }, [limits]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);
  useEffect(() => () => {
    abortRef.current?.abort();
    void nativeRef.current?.stop();
    void recorderRef.current?.stop();
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setLiveElapsedMs(Date.now() - runStartedRef.current), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const conversation = useMemo<ChatTurn[]>(() => messages.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text })), [messages]);

  async function toggleDictation() {
    if (busy || transcribing) return;
    if (sttEngine === 'native') {
      if (!recording) {
        try {
          const recognizer = new NativeRecognizer();
          recognizer.start(setDraft, draft);
          nativeRef.current = recognizer;
          setRecording(true);
          setDictationStatus('Dictée en cours… Parle, puis appuie sur Arrêter.');
        } catch (e) {
          setDictationStatus(`Micro indisponible : ${(e as Error).message}`);
        }
        return;
      }
      setRecording(false);
      setTranscribing(true);
      try {
        const transcript = await nativeRef.current?.stop();
        if (transcript) setDraft(transcript);
        setDictationStatus(transcript ? 'Dictée terminée — relis puis envoie.' : 'Aucune parole reconnue.');
      } catch (e) {
        setDictationStatus(`Erreur de dictée : ${(e as Error).message}`);
      } finally {
        nativeRef.current = null;
        setTranscribing(false);
      }
      return;
    }

    if (!recording) {
      try {
        const recorder = new MicRecorder();
        await recorder.start();
        recorderRef.current = recorder;
        setRecording(true);
        setDictationStatus('Enregistrement en cours… Parle, puis appuie sur Arrêter.');
      } catch {
        setDictationStatus('Micro inaccessible. Vérifie les autorisations du navigateur.');
      }
      return;
    }

    setRecording(false);
    setTranscribing(true);
    try {
      const { audio } = await recorderRef.current!.stop();
      recorderRef.current = null;
      if (audio.length === 0) {
        setDictationStatus('Aucun son capté.');
        return;
      }
      if (!isSttLoaded()) {
        setDictationStatus('Chargement du modèle de transcription…');
        await loadStt(sttModel, (status, progress) => setDictationStatus(`Modèle STT : ${status} ${Math.round(progress * 100)} %`));
      }
      setDictationStatus('Transcription en cours…');
      const transcript = await transcribe(audio);
      setDraft((current) => [current.trim(), transcript].filter(Boolean).join(' '));
      setDictationStatus(transcript ? 'Dictée terminée — relis puis envoie.' : 'Aucune parole reconnue.');
    } catch (e) {
      setDictationStatus(`Erreur de dictée : ${(e as Error).message}`);
    } finally {
      setTranscribing(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const user: UiMessage = { id: crypto.randomUUID(), role: 'user', text };
    const assistantId = crypto.randomUUID();
    setDraft(''); setError(''); setDictationStatus(''); setBusy(true);
    runStartedRef.current = Date.now(); setLiveElapsedMs(0); setLiveProgress(null);
    setMessages((old) => [...old, user, { id: assistantId, role: 'assistant', text: '', tools: [] }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const runApprovalMode = approvalMode;
      const result = await runAgent([...conversation, { role: 'user', content: text }], limits, (event) => {
        setMessages((old) => old.map((m) => m.id === assistantId ? { ...m, tools: [...(m.tools ?? []), event] } : m));
      }, controller.signal, (actionPlan) => new Promise<boolean>((resolve) => { setPending(actionPlan); approvalRef.current = resolve; }), runApprovalMode, (progress) => {
        setLiveProgress(progress); setLiveElapsedMs(Date.now() - runStartedRef.current);
      });
      const estimate = result.usage.estimated ? ' estimés' : ' réels';
      const tokenLabel = `${result.usage.inputTokens ?? '?'} entrée + ${result.usage.outputTokens ?? '?'} sortie${estimate}`;
      setMessages((old) => old.map((m) => m.id === assistantId ? { ...m, text: result.text, diagnostics: result.usage, modelCalls: result.modelCalls, meta: `${result.toolCalls}/${limits.maxToolCallsPerMessage} tools · ${result.turns}/${limits.maxAgentTurns} tours · ${tokenLabel}` } : m));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      setMessages((old) => old.filter((m) => m.id !== assistantId || m.text || m.tools?.length));
    } finally {
      setBusy(false); setPending(null); setLiveProgress(null); approvalRef.current = null; abortRef.current = null;
    }
  }

  return <section className="agent-chat agent-page" aria-label="Chat nutritionnel">
        <header className="agent-head">
          <div><h2>✦ Agent FoodRecorder</h2><small>Lectures automatiques · modifications selon l’autorisation choisie</small></div>
          <div className="agent-head-actions"><AgentCliPicker /><button className="ghost small" onClick={() => setShowActivity((v) => !v)}>Activité</button></div>
        </header>
        {showActivity && <AgentActivity compact />}
        <div className={`agent-permission ${approvalMode === 'auto-accept-writes' ? 'danger-mode' : ''}`}>
          <label>Modifications
            <select value={approvalMode} disabled={busy} onChange={(e) => setApprovalMode(e.target.value as AgentApprovalMode)}>
              <option value="confirm-writes">Confirmer chaque modification</option>
              <option value="approve-task-writes">Confirmer puis autoriser cette tâche</option>
              <option value="auto-accept-writes">Tout accepter pour cette session</option>
            </select>
          </label>
          <small>{approvalMode === 'auto-accept-writes'
            ? 'Attention : ajouts, changements et suppressions seront exécutés sans pause. Ce mode se réinitialise au rechargement.'
            : approvalMode === 'approve-task-writes'
              ? 'La première modification est affichée. Si vous confirmez, les suivantes de ce message sont autorisées ; le message suivant redemandera.'
              : 'Les lectures restent autonomes. Avant chaque écriture, la requête et son impact sont affichés.'}</small>
        </div>
        <div className="agent-budget">
          <button className="ghost small" onClick={() => setShowLimits((v) => !v)}>⚙ Limites : {limits.maxToolCallsPerMessage} tools · {limits.maxAgentTurns} tours · {limits.maxOutputTokens} tokens</button>
          {showLimits && <div className="agent-limit-grid">
            <LimitField label="Tools/message" value={limits.maxToolCallsPerMessage} min={1} max={100} onChange={(v) => setLimits({ ...limits, maxToolCallsPerMessage: v })} />
            <LimitField label="Tours" value={limits.maxAgentTurns} min={1} max={40} onChange={(v) => setLimits({ ...limits, maxAgentTurns: v })} />
            <LimitField label="Tokens sortie/appel" value={limits.maxOutputTokens} min={256} max={32000} onChange={(v) => setLimits({ ...limits, maxOutputTokens: v })} />
            <LimitField label="Résultat tool (car.)" value={limits.maxToolResultChars} min={1000} max={250000} onChange={(v) => setLimits({ ...limits, maxToolResultChars: v })} />
            <button className="ghost small" onClick={() => setLimits(DEFAULT_AGENT_LIMITS)}>Valeurs par défaut</button>
            <small>Tokens sortie = plafond par appel modèle, pas pour toute la tâche. Des limites hautes coûtent plus cher et peuvent dépasser la capacité du fournisseur. Pendant le travail, le compteur est actualisé après chaque appel ; un fournisseur ou une CLI ne donne pas les tokens exacts au milieu d’un appel.</small>
          </div>}
        </div>
        <main className="agent-thread">
          {!messages.length && <div className="agent-empty"><strong>Pose une question sur tes données</strong><p>« Qu’ai-je mangé le 12 juin ? »<br />« Moyenne de protéines sur 30 jours ? »<br />« Détaille mon soleil cette semaine. »</p></div>}
          {messages.filter((message) => message.role === 'user' || !!message.text || !!message.tools?.length).map((message) => <div key={message.id} className={`agent-message ${message.role}`}>
            {message.role === 'user' ? <p>{message.text}</p> : <MiniMarkdown text={message.text} />}
            {!!message.tools?.length && <details className="agent-tools"><summary>🔧 {message.tools.filter((e) => e.type === 'tool-start').length} outil(s) consulté(s)</summary>{message.tools.map((event, i) => <div key={i} className={event.ok === false ? 'tool-error' : ''}><code>{event.call.name}</code>{event.type === 'tool-start' && <small> {JSON.stringify(event.call.args)}</small>}{event.type !== 'tool-start' && <><small> · {event.type === 'action-pending' ? 'confirmation demandée' : event.type === 'action-confirmed' ? 'confirmée' : event.type === 'action-refused' ? 'refusée' : event.ok ? 'résultat reçu' : 'erreur'}</small>{event.summary && <pre>{event.summary}</pre>}</>}</div>)}</details>}
            {message.meta && <small className="agent-meta">{message.meta}</small>}
            {message.diagnostics && <details className="agent-diagnostics"><summary>Diagnostic complet</summary><dl>
              <dt>Provider</dt><dd>{message.diagnostics.provider ?? 'inconnu'}</dd>
              <dt>Modèle</dt><dd>{message.diagnostics.model ?? 'non exposé'}</dd>
              <dt>Transport</dt><dd>{message.diagnostics.transport ?? 'inconnu'}</dd>
              <dt>Latence API cumulée</dt><dd>{message.diagnostics.latencyMs ?? '?'} ms</dd>
              <dt>Tokens entrée</dt><dd>{message.diagnostics.inputTokens ?? 'non exposés'}</dd>
              <dt>Tokens sortie</dt><dd>{message.diagnostics.outputTokens ?? 'non exposés'}</dd>
              <dt>Tokens raisonnement</dt><dd>{message.diagnostics.reasoningTokens ?? 'non exposés'}</dd>
              <dt>Cache lu</dt><dd>{message.diagnostics.cacheReadTokens ?? 'non exposé'}</dd>
              <dt>Cache écrit</dt><dd>{message.diagnostics.cacheWriteTokens ?? 'non exposé'}</dd>
              <dt>Fin</dt><dd>{message.diagnostics.stopReason ?? 'non exposée'}</dd>
              <dt>Mesure</dt><dd>{message.diagnostics.estimated ? 'estimation locale' : 'usage renvoyé par le fournisseur'}</dd>
            </dl>
              {!!message.modelCalls?.length && <div className="agent-model-calls"><strong>Appels modèle ({message.modelCalls.length})</strong>{message.modelCalls.map((call, i) => <details key={i}><summary>Appel {i + 1} · {call.inputTokens ?? '?'} in / {call.outputTokens ?? '?'} out · {call.latencyMs ?? '?'} ms · {call.stopReason ?? '?'}</summary><pre>{JSON.stringify(call, null, 2)}</pre></details>)}</div>}
              {message.diagnostics.raw && <><strong>Usage brut final</strong><pre>{JSON.stringify(message.diagnostics.raw, null, 2)}</pre></>}
            </details>}
          </div>)}
          {pending && <div className="agent-confirm" role="alertdialog" aria-label="Confirmer l’action">
            <strong>Action proposée</strong><p>{pending.preview}</p><p className="small"><strong>Impact :</strong> {pending.impact}</p>
            <ChangePreview plan={pending} />
            {!pending.undoable && <p className="small tool-error">Cette action n’est pas annulable automatiquement.</p>}
            <div className="row"><button onClick={() => { approvalRef.current?.(true); approvalRef.current = null; setPending(null); }}>{approvalMode === 'approve-task-writes' ? 'Confirmer et autoriser la tâche' : 'Confirmer'}</button><button className="ghost" onClick={() => { approvalRef.current?.(false); approvalRef.current = null; setPending(null); }}>Refuser</button></div>
          </div>}
          {busy && !pending && <div className="agent-thinking" role="status"><strong>L’agent travaille…</strong><small>{progressLabel(liveProgress, liveElapsedMs, limits)}</small><small>Le total de tokens avance par appel terminé, pas en streaming.</small></div>}
          {error && <div className="agent-error">{error}</div>}
          <div ref={endRef} />
        </main>
        <footer className="agent-compose">
          <textarea value={draft} disabled={transcribing} onChange={(e) => setDraft(e.target.value)} placeholder="Demande quelque chose sur tes repas, nutriments, poids ou soleil…" rows={2} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !recording) { e.preventDefault(); send(); } }} />
          <div className="agent-compose-actions">
            <button className={`agent-dictate ${recording ? 'rec' : 'ghost'}`} onClick={toggleDictation} disabled={busy || transcribing} aria-pressed={recording} aria-label={recording ? 'Arrêter la dictée' : 'Dicter le message'}>
              {recording ? '⏹ Arrêter' : transcribing ? 'Transcription…' : '🎙 Dicter'}
            </button>
            {busy ? <button className="danger" onClick={() => { approvalRef.current?.(false); abortRef.current?.abort(); }}>Arrêter</button> : <button onClick={send} disabled={!draft.trim() || recording || transcribing}>Envoyer</button>}
            <button className="ghost small" disabled={busy || recording || transcribing} onClick={() => { setMessages([]); setError(''); setDictationStatus(''); }}>Nouveau fil</button>
          </div>
          {dictationStatus && <small className="agent-dictation-status" role="status">{dictationStatus}</small>}
        </footer>
  </section>;
}
