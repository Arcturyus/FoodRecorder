import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { NativeRecognizer } from '../stt/webspeech';
import { extractWeight } from '../extraction/weight';
import type { WeightPatch } from '../extraction/weight';
import { WEIGHT_METRICS } from '../weight/types';

/** Résumé court des champs compris (pour vérification rapide). */
function summarize(patch: WeightPatch): string {
  const parts: string[] = [];
  if (patch.date) {
    parts.push(
      new Date(`${patch.date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }),
    );
  }
  if (patch.heure) parts.push(patch.heure);
  for (const m of WEIGHT_METRICS) {
    const v = patch[m.key];
    if (v != null) parts.push(`${m.label} ${v}${m.unit}`);
  }
  if (patch.remarque) parts.push(`« ${patch.remarque} »`);
  return parts.join(' · ');
}

/**
 * Dictée/saisie d'une pesée : mêmes moteurs STT et d'extraction que
 * l'alimentation, mais le résultat pré-remplit le formulaire de pesée
 * (via `onExtract`) plutôt que d'enregistrer directement.
 */
export function WeightCapture({ onExtract }: { onExtract: (patch: WeightPatch) => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const nativeRef = useRef<NativeRecognizer | null>(null);

  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);

  const reviewHint = 'Vérifiez / corrigez le texte, puis cliquez « Analyser ».';

  async function handleRecord() {
    return sttEngine === 'native' ? handleRecordNative() : handleRecordWhisper();
  }

  async function handleRecordNative() {
    if (!recording) {
      try {
        const rec = new NativeRecognizer();
        rec.start((live) => setText(live), text);
        nativeRef.current = rec;
        setRecording(true);
        setStatus('Dictée en cours… (parlez, puis cliquez pour arrêter)');
      } catch (e) {
        setStatus(`Reconnaissance vocale indisponible : ${(e as Error).message}`);
      }
      return;
    }
    setRecording(false);
    setBusy(true);
    try {
      const transcript = await nativeRef.current!.stop();
      if (transcript) setText(transcript);
      setStatus(transcript ? reviewHint : 'Aucune parole reconnue.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      nativeRef.current = null;
      setBusy(false);
    }
  }

  async function handleRecordWhisper() {
    if (!recording) {
      try {
        const rec = new MicRecorder();
        await rec.start();
        recorderRef.current = rec;
        setRecording(true);
        setStatus('Enregistrement… (parlez, puis cliquez pour arrêter)');
      } catch {
        setStatus('Micro inaccessible. Vérifiez les autorisations du navigateur.');
      }
      return;
    }
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
      setStatus(transcript ? reviewHint : 'Aucune parole reconnue.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    const clean = text.trim();
    if (!clean) {
      setStatus('Rien à analyser.');
      return;
    }
    setBusy(true);
    setStatus('Extraction…');
    try {
      const { patch, source } = await extractWeight(clean, extractionMode, cloudApiKey, cloudModel);
      if (Object.keys(patch).length === 0) {
        setStatus('Aucune mesure détectée. Reformulez ou saisissez à la main ci-dessous.');
        return;
      }
      onExtract(patch);
      const via = source === 'rules' && extractionMode !== 'rules' ? ' [règles, IA indisponible]' : '';
      setStatus(`✓ Compris${via} : ${summarize(patch)}`);
      setText('');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Dicter une pesée</h2>
      <div className="mic-row">
        <button
          className={`record-btn ${recording ? 'rec' : 'primary'}`}
          onClick={handleRecord}
          disabled={busy && !recording}
        >
          {recording ? '⏹ Arrêter' : '🎙 Dicter'}
        </button>
        <textarea
          placeholder="…ou tapez : « hier matin 68,5 kg, masse grasse 18, eau 53, muscle 55, à jeun » (la date dictée est comprise)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze();
          }}
        />
        <button onClick={analyze} disabled={busy || !text.trim()}>
          Analyser
        </button>
      </div>
      {status && <div className="status">{status}</div>}
      <div className="hint">
        La dictée remplit le champ : relisez, puis « Analyser » pré-remplit le formulaire ci-dessous (à valider).
        Utilise le même moteur d'extraction que l'alimentation (réglable dans « Réglages »).
      </div>
    </div>
  );
}
