// 自動再生用のハンドクラップ音。音声ファイルなしでWebAudioで合成する。

export interface ClapAudio {
  ctx: AudioContext;
  buf: AudioBuffer;
  // 出力先。iOSの画面収録はWebAudio直出しをキャプチャしないため、
  // MediaStreamDestination → <audio>要素経由で鳴らす (メディア再生として録画に乗る)
  out: AudioNode;
  el: HTMLAudioElement | null;
}

function buildClap(ctx: AudioContext): ClapAudio {
  const len = Math.floor(ctx.sampleRate * 0.09);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    // 減衰するノイズ + 立ち上がりの複数バーストで拍手っぽく
    const burst = t < 0.02 || (t > 0.03 && t < 0.045) ? 1.6 : 1;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * burst * 0.9;
  }

  let out: AudioNode = ctx.destination;
  let el: HTMLAudioElement | null = null;
  try {
    const dest = ctx.createMediaStreamDestination();
    el = new Audio();
    el.srcObject = dest.stream;
    el.setAttribute("playsinline", "");
    out = dest;
  } catch {
    el = null;
    out = ctx.destination;
  }
  return { ctx, buf, out, el };
}

export function ensureClapAudio(ref: { current: ClapAudio | null }): ClapAudio | null {
  if (typeof window === "undefined") return null;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;

  // iOS 16.4+ Audio Session API: ページの音声を「メディア再生」として
  // 扱わせる。これがないと画面収録開始時にセッションが中断されて
  // クラップ音が録画に乗らない (マナーモードでも消音される)
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // 未対応ブラウザは無視
  }

  // iOSは画面収録・経路変更でオーディオセッションが変わり、既存の
  // AudioContextが中断されたりレートが変わったりする。再生開始 (ユーザー
  // 操作) のたびに現在のハードウェア状態と一致しているか確認し、
  // ずれていたら作り直す。
  if (ref.current) {
    const cur = ref.current.ctx;
    let stale = cur.state === "closed";
    if (!stale) {
      try {
        const probe = new Ctx();
        stale = probe.sampleRate !== cur.sampleRate;
        void probe.close();
      } catch {
        stale = false;
      }
    }
    if (stale) {
      try {
        if (ref.current.el) {
          ref.current.el.pause();
          ref.current.el.srcObject = null;
        }
        void cur.close();
      } catch {
        // closed済みなら無視
      }
      ref.current = null;
    }
  }

  if (!ref.current) {
    try {
      ref.current = buildClap(new Ctx());
    } catch {
      return null;
    }
  }
  void ref.current.ctx.resume();
  if (ref.current.el) void ref.current.el.play().catch(() => {});
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
  gain.connect(audio.out);
  src.start(Math.max(time, audio.ctx.currentTime));
}
