// 自動再生用のハンドクラップ音。
// iOSは画面収録中にrAFをスロットリングするため「その場で単発再生」は
// どうしても音が塊になる。譜面全体のクラップトラックを1本のWAVに
// 事前レンダリングして<audio>で連続再生する方式なら、音楽再生と同じ
// 扱いで録画に確実に乗り、再生クロックも乱れない。

// 決定的な擬似乱数 (毎回同じクラップ波形を生成する)
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x3fffffff - 1;
  };
}

// 拍手っぽい中域ノイズバースト (一次ローパス2本の差分で簡易バンドパス)
function renderClapSamples(gain: number, sr: number): Float32Array {
  const len = Math.floor(sr * 0.09);
  const out = new Float32Array(len);
  const rand = makeRng(20240808);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const burst = t < 0.02 || (t > 0.03 && t < 0.045) ? 1.6 : 1;
    const x = rand() * Math.pow(1 - t, 2.2) * burst;
    lp1 += 0.35 * (x - lp1);
    lp2 += 0.06 * (x - lp2);
    out[i] = (lp1 - lp2) * 2.2 * gain;
  }
  return out;
}

// 空打ち用の低いストンプ音 (床を踏む鈍い音)。クラップより低域・長め
function renderStompSamples(gain: number, sr: number): Float32Array {
  const len = Math.floor(sr * 0.12);
  const out = new Float32Array(len);
  const rand = makeRng(20250809);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const x = rand() * Math.pow(1 - t, 3.2);
    // カットオフを低めに: こもった「ドッ」という踏み音
    lp1 += 0.09 * (x - lp1);
    lp2 += 0.02 * (x - lp2);
    // 立ち上がりに少しだけトーンを足して芯を出す
    const tone = Math.sin((i / sr) * 2 * Math.PI * 110) * Math.pow(1 - t, 6) * 0.35;
    out[i] = ((lp1 - lp2) * 3.4 + tone) * gain;
  }
  return out;
}

/**
 * 譜面全体のクラップトラックをWAVにレンダリングし、Blob URLを返す。
 * eventTimes は各ノーツの発音時刻 (秒、ソフラン・停止込み)。
 * ghostTimes には空打ち (ストンプ音) の発音時刻を渡す。
 * 使い終わったURLは呼び出し側で URL.revokeObjectURL すること。
 */
export function buildClapTrackUrl(
  eventTimes: number[],
  accents: boolean[],
  durationSec: number,
  ghostTimes: number[] = []
): string {
  const sr = 44100;
  const len = Math.max(sr, Math.ceil((durationSec + 0.6) * sr));
  const mix = new Float32Array(len);
  const normal = renderClapSamples(0.6, sr);
  const accent = renderClapSamples(1.0, sr);
  const stomp = renderStompSamples(0.9, sr);

  for (let i = 0; i < eventTimes.length; i++) {
    const off = Math.round(eventTimes[i] * sr);
    if (off < 0 || off >= len) continue;
    const s = accents[i] ? accent : normal;
    const end = Math.min(s.length, len - off);
    for (let j = 0; j < end; j++) mix[off + j] += s[j];
  }
  for (const t of ghostTimes) {
    const off = Math.round(t * sr);
    if (off < 0 || off >= len) continue;
    const end = Math.min(stomp.length, len - off);
    for (let j = 0; j < end; j++) mix[off + j] += stomp[j];
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
  for (let i = 0; i < len; i++) {
    const v = Math.max(-1, Math.min(1, mix[i]));
    dv.setInt16(44 + i * 2, (v * 32767) | 0, true);
  }

  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

// iOS 16.4+: ページ音声をメディア再生として扱わせる (マナーモードでも鳴る)
export function setPlaybackAudioSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    // 未対応ブラウザは無視
  }
}
