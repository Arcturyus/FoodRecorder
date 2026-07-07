import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { extractWithLlm } from '../extraction/llm';
import { extractWithAnthropic } from '../extraction/anthropic';
import { parseTranscript } from '../extraction/ruleParser';

/**
 * Bloc de saisie : dicter (Whisper) ou taper une phrase, puis extraction
 * (LLM si activé, sinon parseur à règles) et enregistrement AUTOMATIQUE.
 */
export function Capture() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const addEntry = useStore((s) => s.addEntry);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const sttModel = useStore((s) => s.sttModel);

  async function handleRecord() {
    if (!recording) {
      try {
        const rec = new MicRecorder();
        await rec.start();
        recorderRef.current = rec;
        setRecording(true);
        setStatus('Enregistrement… (reparlez, puis cliquez pour arrêter)');
      } catch {
        setStatus('Micro inaccessible. Vérifiez les autorisations du navigateur.');
      }
      return;
    }

    // arrêt + transcription
    setRecording(false);
    setBusy(true);
    try {
      const { audio } = await recorderRef.current!.stop();
      if (audio.length === 0) {
        setStatus('Aucun son capté.');
        return;
      }
      if (!isSttLoaded()) {
        setStatus('Chargement du modèle de transcription…');
        await loadStt(sttModel, (s, p) => setStatus(`Modèle STT : ${s} ${Math.round(p * 100)}%`));
      }
      setStatus('Transcription…');
      const transcript = await transcribe(audio);
      setText(transcript);
      await processAndSave(transcript);
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function processAndSave(transcript: string) {
    const clean = transcript.trim();
    if (!clean) {
      setStatus('Rien à enregistrer.');
      return;
    }
    let items;
    let source: 'llm' | 'anthropic' | 'rules';
    if (extractionMode === 'cloud') {
      setStatus('Extraction (API Claude)…');
      try {
        const res = await extractWithAnthropic(clean, cloudApiKey, cloudModel);
        items = res.items;
        source = res.source;
      } catch (e) {
        setStatus(`${(e as Error).message}. Repli sur le parseur.`);
        items = parseTranscript(clean);
        source = 'rules';
      }
    } else if (extractionMode === 'local') {
      setStatus('Extraction (IA locale)…');
      const res = await extractWithLlm(clean);
      items = res.items;
      source = res.source;
    } else {
      items = parseTranscript(clean);
      source = 'rules';
    }
    if (items.length === 0) {
      setStatus('Aucun aliment détecté. Reformulez ou ajoutez à la main.');
      return;
    }
    addEntry(clean, items, source);
    setText('');
    const fallbackNote = source === 'rules' && extractionMode !== 'rules' ? ' (parseur, IA indisponible)' : '';
    setStatus(`Enregistré : ${items.length} aliment(s)${fallbackNote}.`);
  }

  async function handleTextSubmit() {
    setBusy(true);
    try {
      await processAndSave(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Qu'avez-vous mangé ?</h2>
      <div className="mic-row">
        <button
          className={`record-btn ${recording ? 'rec' : 'primary'}`}
          onClick={handleRecord}
          disabled={busy && !recording}
        >
          {recording ? '⏹ Arrêter' : '🎙 Dicter'}
        </button>
        <textarea
          placeholder="…ou tapez : « un bol de riz, 150 g de poulet et un yaourt nature »"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTextSubmit();
          }}
        />
        <button onClick={handleTextSubmit} disabled={busy || !text.trim()}>
          Ajouter
        </button>
      </div>
      {status && <div className="status">{status}</div>}
      <div className="hint">
        L'entrée est enregistrée automatiquement puis reste modifiable. Ctrl/⌘ + Entrée pour valider le texte.
        {extractionMode === 'cloud'
          ? ' Extraction par API Claude (clé requise).'
          : extractionMode === 'local'
            ? ' Extraction par IA locale.'
            : ' Extraction par règles (rapide, hors-ligne).'}
      </div>
    </div>
  );
}
