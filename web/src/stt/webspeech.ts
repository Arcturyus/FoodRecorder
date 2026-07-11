/**
 * STT via la reconnaissance vocale native du navigateur (Web Speech API).
 *
 * Contrairement à Whisper (qui tourne en local sur un audio enregistré), ce
 * moteur diffuse le texte en temps réel et s'appuie sur le moteur de dictée du
 * système/navigateur (souvent Google côté Chrome/Android). Résultat nettement
 * plus précis et sans téléchargement de modèle, mais : nécessite une connexion
 * réseau selon le navigateur, et n'est pas disponible partout (Firefox : non).
 */

// La Web Speech API n'est pas (ou mal) typée dans lib.dom selon les versions ;
// on déclare le strict nécessaire ici.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** La reconnaissance vocale native est-elle disponible dans ce navigateur ? */
export function isNativeSttSupported(): boolean {
  return getCtor() !== null;
}

export type NativeSttUpdate = (fullText: string) => void;

/**
 * Session de dictée native. `start` diffuse le texte reconnu (partie finale +
 * partie provisoire) via le callback ; `stop` clôt la session et renvoie le
 * texte final consolidé.
 */
export class NativeRecognizer {
  private rec: SpeechRecognitionLike | null = null;
  private finalText = '';
  private stopped = false;
  private endResolve: ((text: string) => void) | null = null;

  start(onUpdate: NativeSttUpdate): void {
    const Ctor = getCtor();
    if (!Ctor) throw new Error('Reconnaissance vocale native indisponible dans ce navigateur.');
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const chunk = res[0]?.transcript ?? '';
        if (res.isFinal) this.finalText += chunk;
        else interim += chunk;
      }
      onUpdate((this.finalText + interim).trim());
    };
    rec.onend = () => {
      // Certains navigateurs coupent la session après un silence : on relance
      // tant que l'utilisateur n'a pas explicitement arrêté.
      if (!this.stopped) {
        try {
          rec.start();
          return;
        } catch {
          /* ignore : session déjà relancée */
        }
      }
      this.endResolve?.(this.finalText.trim());
      this.endResolve = null;
    };

    this.finalText = '';
    this.stopped = false;
    this.rec = rec;
    rec.start();
  }

  /** Arrête la dictée et renvoie le texte final une fois la session close. */
  stop(): Promise<string> {
    if (!this.rec) return Promise.resolve(this.finalText.trim());
    this.stopped = true;
    return new Promise<string>((resolve) => {
      this.endResolve = resolve;
      this.rec?.stop();
    });
  }
}
