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

/**
 * Sur mobile (Chrome Android en particulier), le mode `continuous` est mal
 * implémenté : le moteur coupe malgré tout après un silence, et relancer la
 * session fait re-capter l'audio qui chevauche → le texte se répète
 * (« 250g 25025050 de skyr »). On désactive donc `continuous` + la relance auto
 * sur mobile : une pression = une phrase, quitte à réappuyer pour continuer.
 */
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Concatène le texte déjà présent et la dictée en cours avec une espace propre. */
function joinText(prefix: string, rest: string): string {
  const p = prefix.trim();
  const r = rest.trim();
  if (!p) return r;
  if (!r) return p;
  return `${p} ${r}`;
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
  private base = '';
  private stopped = false;
  private ended = false;
  private endResolve: ((text: string) => void) | null = null;

  /**
   * @param onUpdate    reçoit le texte complet (initial + dictée) en continu.
   * @param initialText texte déjà présent dans le champ ; la dictée s'y ajoute
   *                    au lieu de l'écraser.
   */
  start(onUpdate: NativeSttUpdate, initialText = ''): void {
    const Ctor = getCtor();
    if (!Ctor) throw new Error('Reconnaissance vocale native indisponible dans ce navigateur.');
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    // Sur mobile, `continuous` provoque des répétitions (cf. isMobile) : on le
    // coupe et la session s'arrête d'elle-même après le silence.
    rec.continuous = !isMobile();
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
      onUpdate(joinText(this.base, this.finalText + interim));
    };
    rec.onend = () => {
      // En mode continu (desktop), certains navigateurs coupent après un silence :
      // on relance tant que l'utilisateur n'a pas explicitement arrêté. En mode
      // non-continu (mobile), on NE relance PAS pour éviter les répétitions.
      if (!this.stopped && rec.continuous) {
        try {
          rec.start();
          return;
        } catch {
          /* ignore : session déjà relancée */
        }
      }
      this.ended = true;
      this.endResolve?.(joinText(this.base, this.finalText));
      this.endResolve = null;
    };

    this.finalText = '';
    this.base = initialText.trim();
    this.stopped = false;
    this.ended = false;
    this.rec = rec;
    rec.start();
  }

  /** Arrête la dictée et renvoie le texte final une fois la session close. */
  stop(): Promise<string> {
    const current = joinText(this.base, this.finalText);
    if (!this.rec || this.ended) return Promise.resolve(current);
    this.stopped = true;
    return new Promise<string>((resolve) => {
      this.endResolve = resolve;
      this.rec?.stop();
    });
  }
}
