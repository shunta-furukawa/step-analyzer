// 自動再生用のハンドクラップ音。音声ファイルなしでWebAudioで合成する。

export interface ClapAudio {
  ctx: AudioContext;
  buf: AudioBuffer;
}

export function ensureClapAudio(ref: { current: ClapAudio | null }): ClapAudio | null {
  if (typeof window === "undefined") return null;
  if (!ref.current) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const len = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 減衰するノイズ + 立ち上がりの複数バーストで拍手っぽく
      const burst = t < 0.02 || (t > 0.03 && t < 0.045) ? 1.6 : 1;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * burst * 0.9;
    }
    ref.current = { ctx, buf };
  }
  void ref.current.ctx.resume();
  return ref.current;
}

export function scheduleClap(audio: ClapAudio, time: number, accent: boolean): void {
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.buf;
  const bp = audio.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1300;
  bp.Q.value = 0.7;
  const gain = audio.ctx.createGain();
  gain.gain.value = accent ? 1.0 : 0.6;
  src.connect(bp);
  bp.connect(gain);
  gain.connect(audio.ctx.destination);
  src.start(Math.max(time, audio.ctx.currentTime));
}
