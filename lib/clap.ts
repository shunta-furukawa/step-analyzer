// 自動再生用のハンドクラップ音。
// iOSの画面収録はWeb Audio APIの出力をキャプチャせず、MediaStream経由の
// <audio>もスタッターするため、事前生成したWAV (データURI) を通常の
// <audio>要素プールで鳴らす。純粋なメディア再生なので録画に確実に乗り、
// AudioContextの中断やクロック停止の影響を受けない。

export interface ClapAudio {
  pool: HTMLAudioElement[];
  accentPool: HTMLAudioElement[];
  i: number;
  ai: number;
}

// 決定的な擬似乱数 (毎回同じクラップ波形を生成する)
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

function makeClapWav(gain: number): string {
  const sr = 44100;
  const len = Math.floor(sr * 0.09);
  const pcm = new Int16Array(len);
  const rand = makeRng(20240808);
  // 一次ローパス2本の差分で簡易バンドパス (拍手っぽい中域ノイズ)
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const burst = t < 0.02 || (t > 0.03 && t < 0.045) ? 1.6 : 1;
    const x = rand() * Math.pow(1 - t, 2.2) * burst;
    lp1 += 0.35 * (x - lp1);
    lp2 += 0.06 * (x - lp2);
    const v = Math.max(-1, Math.min(1, (lp1 - lp2) * 2.2 * gain));
    pcm[i] = (v * 32767) | 0;
  }

  const bytes = new Uint8Array(44 + len * 2);
  const dv = new DataView(bytes.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i);
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + len * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, len * 2, true);
  bytes.set(new Uint8Array(pcm.buffer), 44);

  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let normalUri: string | null = null;
let accentUri: string | null = null;

function makePool(uri: string, size: number): HTMLAudioElement[] {
  const pool: HTMLAudioElement[] = [];
  for (let i = 0; i < size; i++) {
    const el = new Audio(uri);
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    pool.push(el);
  }
  return pool;
}

export function ensureClapAudio(ref: { current: ClapAudio | null }): ClapAudio | null {
  if (typeof window === "undefined") return null;

  // iOS 16.4+: ページ音声をメディア再生として扱わせる (マナーモードでも鳴る)
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // 未対応ブラウザは無視
  }

  if (!ref.current) {
    try {
      normalUri ??= makeClapWav(0.6);
      accentUri ??= makeClapWav(1.0);
      ref.current = {
        pool: makePool(normalUri, 4),
        accentPool: makePool(accentUri, 2),
        i: 0,
        ai: 0,
      };
    } catch {
      return null;
    }
  }

  // ユーザー操作の文脈で各要素の再生権を取得しておく (ミュート再生→即停止)
  for (const el of [...ref.current.pool, ...ref.current.accentPool]) {
    if (el.dataset.unlocked) continue;
    el.dataset.unlocked = "1";
    el.muted = true;
    el
      .play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      })
      .catch(() => {
        el.muted = false;
        delete el.dataset.unlocked;
      });
  }
  return ref.current;
}

export function scheduleClap(audio: ClapAudio, accent: boolean): void {
  const pool = accent ? audio.accentPool : audio.pool;
  const idx = accent
    ? (audio.ai = (audio.ai + 1) % pool.length)
    : (audio.i = (audio.i + 1) % pool.length);
  const el = pool[idx];
  try {
    el.currentTime = 0;
  } catch {
    // まだメタデータ未ロードなら無視 (play側で先頭から鳴る)
  }
  void el.play().catch(() => {});
}
