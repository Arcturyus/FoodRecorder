/**
 * Enregistrement micro dans le navigateur → Float32Array mono 16 kHz,
 * format attendu par Whisper (transformers.js).
 */

export class MicRecorder {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private recording = false;

  isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    if (this.recording) return;
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.processor.onaudioprocess = (e) => {
      if (!this.recording) return;
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.recording = true;
  }

  /** Arrête et renvoie l'audio capté (mono, à la fréquence du contexte). */
  async stop(): Promise<{ audio: Float32Array; sampleRate: number }> {
    if (!this.recording || !this.audioContext) {
      return { audio: new Float32Array(0), sampleRate: 16000 };
    }
    this.recording = false;
    const sampleRate = this.audioContext.sampleRate;

    this.processor?.disconnect();
    this.source?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    await this.audioContext.close();

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const audio = new Float32Array(total);
    let offset = 0;
    for (const c of this.chunks) {
      audio.set(c, offset);
      offset += c.length;
    }
    this.chunks = [];
    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.mediaStream = null;

    return { audio, sampleRate };
  }
}
