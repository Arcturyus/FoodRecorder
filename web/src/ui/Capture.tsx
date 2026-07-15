import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { NativeRecognizer } from '../stt/webspeech';
import { extractWithLlm } from '../extraction/llm';
import { extractWithAnthropic, extractImageWithAnthropic } from '../extraction/anthropic';
import { extractWithClaudeCode, extractImageWithClaudeCode } from '../extraction/claudeCode';
import { parseTranscript } from '../extraction/ruleParser';
import { isSyncConfigured, pushTranscript } from '../sync/supabase';
import { normalizeForMatch, trigramSimilarity } from '../nutrition/normalize';
import type { ExtractedItem } from '../nutrition/types';
import type { FavoriteMeal } from '../store/store';

/**
 * Reconnaît un repas favori dicté par son nom (« petit-déj habituel ») :
 * la phrase entière doit correspondre au nom du favori (pas juste le contenir,
 * pour ne pas court-circuiter une vraie liste d'aliments).
 */
function matchFavorite(transcript: string, favorites: FavoriteMeal[]): FavoriteMeal | null {
  const t = normalizeForMatch(transcript);
  if (!t) return null;
  let best: FavoriteMeal | null = null;
  let bestScore = 0;
  for (const f of favorites) {
    const n = normalizeForMatch(f.nom);
    if (!n) continue;
    const score = t === n ? 1 : trigramSimilarity(t, n);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= 0.75 ? best : null;
}

/**
 * Résumé concis de ce qui a été compris, pour vérification rapide après un
 * enregistrement vocal/photo : aliment tronqué + quantité, séparés par « · ».
 */
function summarize(items: ExtractedItem[]): string {
  return items
    .map((it) => {
      const nom = it.aliment.length > 14 ? `${it.aliment.slice(0, 13)}…` : it.aliment;
      const q = Number.isInteger(it.quantite) ? String(it.quantite) : it.quantite.toFixed(1);
      return `${nom} ${q} ${it.unite}`;
    })
    .join(' · ');
}

/** Lit un fichier image en base64 nu (sans le préfixe data:…) + son type MIME. */
function fileToBase64(file: File): Promise<{ data: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve({ data: result.slice(comma + 1), mediaType: file.type });
    };
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Bloc de saisie : dicter (Whisper) ou taper une phrase, puis extraction
 * (LLM si activé, sinon parseur à règles) et enregistrement AUTOMATIQUE.
 * `date` : jour ciblé (défaut aujourd'hui) — permet de dicter/photographier un
 * repas oublié depuis l'historique.
 */
export function Capture({ date, title }: { date?: string; title?: string } = {}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const nativeRef = useRef<NativeRecognizer | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [recording, setRecording] = useState(false);

  const addEntry = useStore((s) => s.addEntry);
  const favoriteMeals = useStore((s) => s.favoriteMeals);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);
  const deviceId = useStore((s) => s.deviceId);

  const reviewHint = 'Vérifiez / corrigez le texte, puis cliquez « Ajouter ».';

  async function handleRecord() {
    return sttEngine === 'native' ? handleRecordNative() : handleRecordWhisper();
  }

  /** Dictée temps réel via la reconnaissance vocale native du navigateur. */
  async function handleRecordNative() {
    if (!recording) {
      try {
        const rec = new NativeRecognizer();
        rec.start((live) => setText(live));
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
      // On NE traite PAS automatiquement : l'utilisateur relit puis valide.
      setStatus(transcript ? reviewHint : 'Aucune parole reconnue.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      nativeRef.current = null;
      setBusy(false);
    }
  }

  /** Dictée via Whisper (enregistrement audio local puis transcription). */
  async function handleRecordWhisper() {
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
      // On NE traite PAS automatiquement : l'utilisateur relit puis valide.
      setStatus(transcript ? reviewHint : 'Aucune parole reconnue.');
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
    // Repas favori dicté par son nom → ajout direct, sans passer par l'extraction.
    const fav = matchFavorite(clean, favoriteMeals);
    if (fav) {
      applyFavoriteMeal(fav.id, date);
      setText('');
      setStatus(`⭐ Repas favori reconnu : « ${fav.nom} » ajouté (${fav.items.length} aliment(s)).`);
      return;
    }
    let items;
    let source: 'llm' | 'anthropic' | 'claudecode' | 'rules';
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
    } else if (extractionMode === 'claudecode') {
      setStatus('Extraction (Claude Code)…');
      try {
        const res = await extractWithClaudeCode(clean);
        items = res.items;
        source = res.source;
      } catch (e) {
        // Pont indisponible ici (typiquement sur tel) : mise en file d'attente
        // pour traitement différé par l'ordinateur, plutôt que de dégrader
        // silencieusement vers le parseur à règles.
        if (isSyncConfigured()) {
          try {
            await pushTranscript(deviceId, clean, date);
            setText('');
            setStatus('Pont Claude Code indisponible ici : mis en file d’attente, sera traité dès que l’ordinateur sera disponible.');
            return;
          } catch (syncErr) {
            setStatus(`Échec de la mise en file d'attente : ${(syncErr as Error).message}`);
            return;
          }
        }
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
    addEntry(clean, items, source, date);
    setText('');
    const fallbackNote = source === 'rules' && extractionMode !== 'rules' ? ' [parseur, IA indisponible]' : '';
    setStatus(`✓ Compris (${items.length})${fallbackNote} : ${summarize(items)}`);
  }

  async function handleTextSubmit() {
    setBusy(true);
    try {
      await processAndSave(text);
    } finally {
      setBusy(false);
    }
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner la même photo
    if (!file) return;
    setBusy(true);
    setStatus(`Analyse de la photo (${extractionMode === 'claudecode' ? 'Claude Code' : 'API Claude'})…`);
    try {
      const { data, mediaType } = await fileToBase64(file);
      const res =
        extractionMode === 'claudecode'
          ? await extractImageWithClaudeCode(data, mediaType)
          : await extractImageWithAnthropic(data, mediaType, cloudApiKey, cloudModel);
      if (res.items.length === 0) {
        setStatus('Aucun aliment détecté sur la photo. Reprenez la photo ou ajoutez à la main.');
        return;
      }
      addEntry('📷 Photo', res.items, res.source, date);
      setStatus(`✓ Compris (photo, ${res.items.length}) : ${summarize(res.items)}`);
    } catch (err) {
      setStatus(`Erreur photo : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const photoSupported = extractionMode === 'cloud' || extractionMode === 'claudecode';

  return (
    <div className="panel capture">
      <h2>{title ?? "Qu'avez-vous mangé ?"}</h2>
      <textarea
        className="capture-input"
        placeholder="Dictez ou tapez : « un bol de riz, 150 g de poulet et un yaourt nature »"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleTextSubmit();
        }}
      />
      <div className="capture-actions">
        <button
          className={`record-btn ${recording ? 'rec' : 'primary'}`}
          onClick={handleRecord}
          disabled={busy && !recording}
        >
          {recording ? '⏹ Arrêter' : '🎙 Dicter'}
        </button>
        {photoSupported && (
          <button className="photo-btn" onClick={() => photoInputRef.current?.click()} disabled={busy}>
            📷 Photo
          </button>
        )}
        <button className="capture-add" onClick={handleTextSubmit} disabled={busy || !text.trim()}>
          Ajouter
        </button>
      </div>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhoto}
        style={{ display: 'none' }}
      />
      {status && <div className="status">{status}</div>}
      <div className="hint">
        La dictée remplit le champ : relisez, corrigez, puis « Ajouter ».
        {extractionMode === 'cloud'
          ? ' Analyse par API Claude.'
          : extractionMode === 'claudecode'
            ? ' Analyse par Claude Code (ordinateur).'
            : extractionMode === 'local'
              ? ' Analyse par IA locale.'
              : ' Analyse par règles (hors-ligne).'}
      </div>
    </div>
  );
}
