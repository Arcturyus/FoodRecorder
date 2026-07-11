/**
 * STT on-device via Whisper (transformers.js).
 * Chargement dynamique du modèle ; langue forcée français.
 */

export interface SttModelOption {
  id: string;
  label: string;
  sizeHint: string;
}

export const STT_MODELS: SttModelOption[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper tiny (rapide)', sizeHint: '~75 Mo' },
  { id: 'Xenova/whisper-base', label: 'Whisper base (recommandé)', sizeHint: '~145 Mo' },
  { id: 'Xenova/whisper-small', label: 'Whisper small (précis)', sizeHint: '~485 Mo' },
];

export const DEFAULT_STT_MODEL = STT_MODELS[1].id;

export type SttProgressCallback = (text: string, progress: number) => void;

type Transcriber = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string }>;

let transcriber: Transcriber | null = null;
let loadedModelId: string | null = null;

export function isSttLoaded(): boolean {
  return transcriber !== null;
}

export async function loadStt(modelId: string, onProgress?: SttProgressCallback): Promise<void> {
  if (transcriber && loadedModelId === modelId) return;
  const { pipeline } = await import('@huggingface/transformers');
  transcriber = (await pipeline('automatic-speech-recognition', modelId, {
    progress_callback: (p: { status: string; progress?: number }) => {
      // transformers.js exprime `progress` en pourcentage (0–100) ; on renvoie une
      // fraction 0–1, cohérente avec le contrat SttProgressCallback (cf. llm.ts).
      onProgress?.(p.status, Math.min(1, (p.progress ?? 0) / 100));
    },
  })) as unknown as Transcriber;
  loadedModelId = modelId;
}

/** Transcrit un signal audio mono. Whisper attend du 16 kHz. */
export async function transcribe(audio: Float32Array): Promise<string> {
  if (!transcriber) throw new Error('Modèle STT non chargé');
  const out = await transcriber(audio, {
    language: 'french',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return out.text.trim();
}
