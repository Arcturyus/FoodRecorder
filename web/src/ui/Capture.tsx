import { useRef, useState } from 'react';
import { useStore, useEffectiveFoods, recentFoodCounts, todayStr, useCloudConfig } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { NativeRecognizer } from '../stt/webspeech';
import { extractWithLlm } from '../extraction/llm';
import { extractWithCloud, extractImageWithCloud } from '../extraction/cloudExtract';
import { extractWithCli, extractImageWithCli } from '../extraction/cliExtract';
import { currentCliLabel } from '../extraction/bridge';
import { providerInfo, supportsVision } from '../extraction/providers';
import { verifyMatches } from '../extraction/verify';
import { parseTranscript } from '../extraction/ruleParser';
import { isSyncConfigured, pushTranscript, pushImage } from '../sync/supabase';
import { useSyncStore } from '../sync/syncStore';
import { normalizeForMatch, trigramSimilarity } from '../nutrition/normalize';
import type { ExtractedItem } from '../nutrition/types';
import type { FavoriteMeal, JournalEntry } from '../store/store';

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

/** Image réduite prête à envoyer, avec de quoi diagnostiquer un envoi qui rate. */
interface Downscaled {
  data: string;
  mediaType: string;
  /** Dimensions après réduction (px). */
  width: number;
  height: number;
}

/**
 * Réduit une image via un canvas (max `maxDim` px sur le grand côté, JPEG) pour
 * un envoi léger en file d'attente Supabase. Une photo de repas reste largement
 * exploitable à 1024 px, pour un poids ~10× moindre qu'un original de smartphone.
 */
function downscaleImage(file: File, maxDim = 1024, quality = 0.72): Promise<Downscaled> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas indisponible.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const comma = dataUrl.indexOf(',');
      resolve({ data: dataUrl.slice(comma + 1), mediaType: 'image/jpeg', width: w, height: h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Lecture de l’image impossible.'));
    };
    img.src = url;
  });
}

/** Formate un nombre d'octets en Ko/Mo lisible (« 234 Ko », « 3.1 Mo »). */
function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`;
}

/** Poids réel (octets) d'une charge base64 nue (4 caractères ≈ 3 octets). */
function base64Bytes(b64: string): number {
  return Math.round((b64.length * 3) / 4);
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
  const entries = useStore((s) => s.entries);
  const favoriteMeals = useStore((s) => s.favoriteMeals);
  const applyFavoriteMeal = useStore((s) => s.applyFavoriteMeal);
  const extractionMode = useStore((s) => s.extractionMode);
  const cloud = useCloudConfig();
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);
  const deviceId = useStore((s) => s.deviceId);
  const profileId = useSyncStore((s) => s.profileId);
  const foods = useEffectiveFoods();

  const reviewHint = 'Vérifiez / corrigez le texte, puis cliquez « Ajouter ».';

  /**
   * Enregistre un repas extrait, après avoir laissé l'IA forte juger les
   * correspondances incertaines de la base (cf. extraction/verify.ts). Renvoie
   * la note à afficher quand elle a préféré sa propre estimation.
   */
  async function saveVerified(
    transcript: string,
    items: ExtractedItem[],
    source: JournalEntry['source'],
  ): Promise<string> {
    let verified = items;
    if (extractionMode === 'cloud' || extractionMode === 'claudecode') {
      setStatus('Vérification des correspondances…');
      verified = await verifyMatches(
        items,
        foods,
        extractionMode,
        cloud,
        recentFoodCounts(entries),
      );
    }
    addEntry(transcript, verified, source, date);
    const reestimes = verified.filter((v, i) => v.nutriments && !items[i]?.nutriments).length;
    return reestimes > 0 ? ` · ${reestimes} estimé(s) par l'IA (hors base)` : '';
  }

  async function handleRecord() {
    return sttEngine === 'native' ? handleRecordNative() : handleRecordWhisper();
  }

  /** Dictée temps réel via la reconnaissance vocale native du navigateur. */
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
    let source: JournalEntry['source'];
    if (extractionMode === 'cloud') {
      setStatus(`Extraction (${providerInfo(cloud.provider).label})…`);
      try {
        const res = await extractWithCloud(clean, cloud);
        items = res.items;
        source = res.source;
      } catch (e) {
        setStatus(`${(e as Error).message}. Repli sur le parseur.`);
        items = parseTranscript(clean);
        source = 'rules';
      }
    } else if (extractionMode === 'claudecode') {
      setStatus(`Extraction (${currentCliLabel()})…`);
      try {
        const res = await extractWithCli(clean);
        items = res.items;
        source = res.source;
      } catch (e) {
        // Pont indisponible ici (typiquement sur tel) : mise en file d'attente
        // pour traitement différé par l'ordinateur, plutôt que de dégrader
        // silencieusement vers le parseur à règles.
        if (isSyncConfigured() && profileId) {
          try {
            // On estampille ICI le jour local (résolu, pas différé) et l'heure
            // d'envoi : l'ordinateur qui traitera plus tard doit dater le repas
            // de MAINTENANT, pas de son heure de traitement (cf. addEntry).
            await pushTranscript(deviceId, profileId, clean, date ?? todayStr(), Date.now());
            setText('');
            setStatus(`Pont ${currentCliLabel()} indisponible ici : mis en file d’attente, sera traité dès que l’ordinateur sera disponible.`);
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
    const iaNote = await saveVerified(clean, items, source);
    setText('');
    const fallbackNote = source === 'rules' && extractionMode !== 'rules' ? ' [parseur, IA indisponible]' : '';
    setStatus(`✓ Compris (${items.length})${fallbackNote} : ${summarize(items)}${iaNote}`);
  }

  async function handleTextSubmit() {
    setBusy(true);
    try {
      await processAndSave(text);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ouvre le sélecteur de photo. `useCamera` bascule l'attribut `capture` :
   * présent → l'appareil photo s'ouvre directement (mobile) ; absent → le
   * sélecteur de fichiers / la pellicule s'ouvre pour choisir une image
   * existante. Sur ordinateur, l'attribut est ignoré (même boîte de dialogue).
   */
  function openPhoto(useCamera: boolean) {
    const input = photoInputRef.current;
    if (!input) return;
    if (useCamera) input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  }

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner la même photo
    if (!file) return;
    setBusy(true);
    try {
      if (extractionMode === 'claudecode') {
        setStatus(`Analyse de la photo (${currentCliLabel()})…`);
        try {
          const { data, mediaType } = await fileToBase64(file);
          const res = await extractImageWithCli(data, mediaType);
          if (res.items.length === 0) {
            setStatus('Aucun aliment détecté sur la photo. Reprenez la photo ou ajoutez à la main.');
            return;
          }
          const iaNote = await saveVerified('📷 Photo', res.items, res.source);
          setStatus(`✓ Compris (photo, ${res.items.length}) : ${summarize(res.items)}${iaNote}`);
        } catch (bridgeErr) {
          // Pont indisponible ici (tel, ou site déployé) : mise en file d'attente
          // de la photo réduite, pour analyse différée par l'ordinateur.
          if (isSyncConfigured() && profileId) {
            // Résumé affiché à l'écran (diagnostic sans débogueur sur tel) :
            // poids envoyé · dimensions réduites · poids d'origine. Renseigné dès
            // la réduction faite, pour l'inclure aussi dans un éventuel échec.
            let info = '';
            try {
              const img = await downscaleImage(file);
              info = `${formatBytes(base64Bytes(img.data))} · ${img.width}×${img.height} · orig ${formatBytes(file.size)}`;
              console.info(`[photo] mise en file d’attente : ${info}`);
              await pushImage(deviceId, profileId, img.data, img.mediaType, date ?? todayStr(), Date.now());
              setStatus(`✓ Photo en file d’attente (${info}). Analyse dès que l’ordinateur est disponible.`);
            } catch (queueErr) {
              // Échec de l'ENVOI à Supabase (≠ échec d'analyse) : message distinct,
              // avec le poids tenté pour écarter/confirmer la piste « trop lourde ».
              console.error('[photo] échec de la mise en file d’attente', queueErr);
              const detail = info ? ` (${info})` : '';
              setStatus(`Échec de l’envoi de la photo${detail} : ${(queueErr as Error).message}`);
            }
          } else {
            setStatus(`Erreur photo : ${(bridgeErr as Error).message}`);
          }
        }
        return;
      }
      // Mode « clé API » : analyse directe sur cet appareil.
      setStatus(`Analyse de la photo (${providerInfo(cloud.provider).label})…`);
      const { data, mediaType } = await fileToBase64(file);
      const res = await extractImageWithCloud(data, mediaType, cloud);
      if (res.items.length === 0) {
        setStatus('Aucun aliment détecté sur la photo. Reprenez la photo ou ajoutez à la main.');
        return;
      }
      const iaNote = await saveVerified('📷 Photo', res.items, res.source);
      setStatus(`✓ Compris (photo, ${res.items.length}) : ${summarize(res.items)}${iaNote}`);
    } catch (err) {
      setStatus(`Erreur photo : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const photoSupported =
    extractionMode === 'claudecode' || (extractionMode === 'cloud' && supportsVision(cloud.provider, cloud.model));

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
          <div className="photo-group">
            <button className="photo-btn" onClick={() => openPhoto(true)} disabled={busy}>
              📷<span className="photo-lbl">Prendre</span>
            </button>
            <button className="photo-btn" onClick={() => openPhoto(false)} disabled={busy}>
              🖼<span className="photo-lbl">Choisir</span>
            </button>
          </div>
        )}
        <button className="capture-add" onClick={handleTextSubmit} disabled={busy || !text.trim()}>
          Ajouter
        </button>
      </div>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhoto}
        style={{ display: 'none' }}
      />
      {status && <div className="status">{status}</div>}
      <div className="hint">
        La dictée remplit le champ : relisez, corrigez, puis « Ajouter ».
        {extractionMode === 'cloud'
          ? ` Analyse par ${providerInfo(cloud.provider).label}.`
          : extractionMode === 'claudecode'
            ? ` Analyse par ${currentCliLabel()} (ordinateur).`
            : extractionMode === 'local'
              ? ' Analyse par IA locale.'
              : ' Analyse par règles (hors-ligne).'}
      </div>
    </div>
  );
}
