// 譜面動画の書き出し。縦型ショート (720x1280・等速) と
// 横長じっくり版 (1920x1080・0.5倍速) の2モード。
// 譜面再生をcanvasに描画し、ハンドクラップ (+任意で音源) と合わせて
// MediaRecorderでリアルタイム録画する。足パッドはアプリと同じ
// Three.jsレンダラ (lib/footScene) を合成するので見た目が完全に一致する。
// すべてクライアントサイドで完結し、サーバーには何も送らない。

import { ARROW_PATH } from "./arrowShape";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  facingColor,
  type Foot,
  type FootStep,
  type ParsedChart,
} from "./chart";
import { drawArrow, drawFootBadge, drawGhostArrow, drawSiteLogo } from "./chartImage";
import { renderClapTrackSamples } from "./clap";
import { DIFF_COLORS, drawDiffFoot } from "./difficulty";
import { createFootScene } from "./footScene";
import { beatAtTime, timeAtBeat, type TimingSeg } from "./timing";

export interface VideoExportOptions {
  chart: ParsedChart;
  footsteps: FootStep[];
  timeline: TimingSeg[];
  title: string;
  subtitle: string; // サブキャプション (アーティスト名など。空なら非表示)
  diff: { cls: number | null; lvl: string } | null; // 難易度 (クラス色+レベル)
  bpmLabel: string; // "175" や "154-308" など表示用
  bgColor: string; // 6桁hex ('#'なし)
  bgColor2?: string | null; // グラデーション右下の色 (なければ単色)
  hispeed: number;
  audio: AudioBuffer | null; // 音源 (なければハンクラのみ)
  jacket: HTMLImageElement | null; // ジャケット (なければアプリアイコン風)
  offsetSec: number; // 譜面1小節目の頭が音源の何秒目か (音源なしなら無視)
  landscape?: boolean; // 横長 (1920x1080) で書き出す
  landscapeSpeed?: number; // 横長の収録速度 (0.5=じっくり既定 / 1=等倍)
  stats?: { label: string; value: number }[]; // 統計カード (横長のみ表示)
  trail?: boolean; // 足の軌跡 (トレイル) を表示する
  // 注目ノーツのコメント (横長のみ)。該当ノーツが判定線に達したら
  // 効果音と共に停止し、字送りでコメントを表示してから再開する
  spotlights?: { beat: number; text: string }[];
  onProgress?: (ratio: number) => void;
  signal?: { cancelled: boolean };
}

const LEAD_IN = 1.5; // 録画開始から1ノーツ目までの助走秒数 (譜面内時間)
const INTRO_SEC = 0.5; // 冒頭のサムネ向けイントロカード表示時間
const TAIL = 1.2;
const FOOT_TRAVEL = 0.25;
// アプリ再生と同じく、パネルが光る瞬間に確実に乗っているよう
// フレーム量子化ぶんだけ早めに着地させる余裕 (実時間)
const FOOT_EARLY = 0.04;

function fgFor(bgHex: string, bgHex2?: string | null): string {
  // グラデーション時は2色の平均輝度で判定する
  const lum = (hex: string) => {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const v = bgHex2 ? (lum(bgHex) + lum(bgHex2)) / 2 : lum(bgHex);
  return v > 0.45 ? "#17181c" : "#ffffff";
}

function pickMime(): { mime: string; ext: string } {
  // H.264+AACを最優先 (投稿先の互換性が最も高い)。非対応環境は順にフォールバック
  const candidates: [string, string][] = [
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "mp4"],
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return { mime: "", ext: "webm" };
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// イントロカード (=サムネ) の描画に必要なメタ情報。
// 動画書き出しとサムネ画像書き出しで共用する
export interface IntroCardOptions {
  title: string;
  subtitle: string;
  diff: { cls: number | null; lvl: string } | null;
  bpmLabel: string;
  bgColor: string;
  bgColor2?: string | null;
  jacket: HTMLImageElement | null;
}

// ページと同じ斜めストライプ背景 (グラデーション対応)
function drawStripedBgOn(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  bg1: string,
  bg2?: string | null
) {
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, `#${bg1}`);
  bgGrad.addColorStop(1, `#${bg2 ?? bg1}`);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.rotate((-25 * Math.PI) / 180);
  const stripeW = 34;
  let stripeI = 0;
  for (let x = -H; x < W + H; x += stripeW, stripeI++) {
    ctx.fillStyle = stripeI % 2 === 0 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.045)";
    ctx.fillRect(x, -W, stripeW, W * 2 + H * 2);
  }
  ctx.restore();
}

// イントロカード (ショートのサムネはほぼ先頭フレームが使われる)。
// ジャケット大 + 難易度チップ + 曲名 + BPM を1枚絵として見せる
function drawIntroCard(
  ctx: CanvasRenderingContext2D,
  o: IntroCardOptions,
  W: number,
  H: number,
  L: boolean,
  titleFont: string,
  fg: string
) {
  drawStripedBgOn(ctx, W, H, o.bgColor, o.bgColor2);
  // サムネの上に大きなサイトロゴ (イントロカードだけの特別配置)
  drawSiteLogo(ctx, W / 2, L ? 84 : 100, L ? 60 : 54, "center");
  // ジャケットは直角 (サイトのカードと同じ様式)。難易度クラス色の枠 +
  // ぼかしなしの黒ハードシャドウで、枠色が背景色と近くても浮かせる
  // 横長はジャケット左+テキスト右の2カラム
  const jSize = L ? 560 : 540;
  const jx = L ? 300 : (W - jSize) / 2;
  const jy = L ? 260 : 215;
  const frameColor = o.diff?.cls != null ? DIFF_COLORS[o.diff.cls] : "#ffffff";
  const frameW = 10;
  ctx.fillStyle = "#17181c";
  ctx.fillRect(jx - frameW + 14, jy - frameW + 14, jSize + frameW * 2, jSize + frameW * 2);
  if (o.jacket) {
    ctx.drawImage(o.jacket, jx, jy, jSize, jSize);
  } else {
    ctx.fillStyle = "#0b0e1a";
    ctx.fillRect(jx, jy, jSize, jSize);
    drawArrow(ctx, jx + jSize / 2, jy + jSize / 2, jSize * 0.72, 90, "#ff5262");
  }
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = frameW;
  ctx.strokeRect(jx - frameW / 2, jy - frameW / 2, jSize + frameW, jSize + frameW);
  // 難易度チップ (白地にハードシャドウ、ジャケット下辺に重ねる)
  const cls = o.diff?.cls ?? null;
  const lvl = o.diff?.lvl ?? "";
  if (cls !== null || lvl) {
    ctx.font = `400 66px ${titleFont}`;
    // actualBoundingBoxは計測時のtextBaseline基準 (Safari)。alphabeticで統一
    ctx.textBaseline = "alphabetic";
    const lm = lvl ? ctx.measureText(lvl) : null;
    const footSize = cls !== null ? 78 : 0;
    const innerW = footSize + (footSize && lm ? 14 : 0) + (lm?.width ?? 0);
    const chipW2 = innerW + 60;
    const chipH = 106;
    const cx0 = jx + (jSize - chipW2) / 2; // ジャケット中央に重ねる
    const cy0 = jy + jSize - chipH / 2;
    // チップも直角 (白 + 黒ハードシャドウ + 黒枠)
    ctx.fillStyle = "#17181c";
    ctx.fillRect(cx0 + 7, cy0 + 7, chipW2, chipH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx0, cy0, chipW2, chipH);
    ctx.strokeStyle = "#17181c";
    ctx.lineWidth = 5;
    ctx.strokeRect(cx0, cy0, chipW2, chipH);
    let dx = cx0 + 30;
    if (cls !== null) {
      drawDiffFoot(ctx, dx, cy0 + (chipH - footSize) / 2, footSize, DIFF_COLORS[cls]);
      dx += footSize + 14;
    }
    if (lm) {
      ctx.fillStyle = "#17181c";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const asc = lm.actualBoundingBoxAscent || 46;
      const desc = lm.actualBoundingBoxDescent || 0;
      ctx.fillText(lvl, dx, cy0 + chipH / 2 + (asc - desc) / 2);
    }
  }
  // 曲名 + アーティスト + BPM (縦=下部中央 / 横=右カラム中央)
  const tcx = L ? (jx + jSize + 80 + (W - 100)) / 2 : W / 2;
  const tMaxW = L ? W - (jx + jSize + 80) - 100 : W - 80;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fg;
  ctx.font = `400 ${L ? 64 : 58}px ${titleFont}`;
  ctx.fillText(o.title, tcx, L ? 460 : 920, tMaxW);
  if (o.subtitle) {
    ctx.globalAlpha = 0.75;
    ctx.font = `400 ${L ? 38 : 34}px ${titleFont}`;
    ctx.fillText(o.subtitle, tcx, L ? 535 : 982, tMaxW);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.8;
  ctx.font = `400 ${L ? 38 : 34}px ${titleFont}`;
  ctx.fillText("BPM", tcx, L ? 690 : 1086);
  ctx.globalAlpha = 1;
  ctx.font = `400 ${L ? 88 : 76}px ${titleFont}`;
  ctx.fillText(o.bpmLabel, tcx, L ? 790 : 1172, tMaxW);
  ctx.textAlign = "left";
}

// 実行時にCSS変数からロゴフォント (Anton) を解決する
function resolveTitleFont(): string {
  const logoFont =
    getComputedStyle(document.documentElement).getPropertyValue("--font-logo").trim() ||
    '"Arial Black"';
  return `${logoFont}, "Arial Black", system-ui, sans-serif`;
}

/**
 * 動画のイントロカードと同じ絵をサムネ画像 (1280x720 JPEG) として書き出す。
 * YouTubeのカスタムサムネは2MB制限があるため、1920x1080で描いてから
 * 1280x720へ縮小しJPEGで出力する
 */
export async function renderVideoThumbnail(o: IntroCardOptions): Promise<Blob> {
  const W = 1920;
  const H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawIntroCard(ctx, o, W, H, true, resolveTitleFont(), fgFor(o.bgColor, o.bgColor2));
  const out = document.createElement("canvas");
  out.width = 1280;
  out.height = 720;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas, 0, 0, 1280, 720);
  return await new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("サムネ画像の生成に失敗しました"))),
      "image/jpeg",
      0.92
    );
  });
}

/** フリーズを保持足ごとの区間に分割 (chartImageと同じ規則) */
function holdSegmentsOf(chart: ParsedChart, footsteps: FootStep[]) {
  const segs: { panel: number; start: number; end: number; foot: Foot | null; roll: boolean }[] =
    [];
  for (const h of chart.holds) {
    const headIdx = chart.events.findIndex(
      (e) => Math.abs(e.row.beat - h.startBeat) < 1e-6 && e.panels.includes(h.panel)
    );
    let foot: Foot | null = headIdx >= 0 ? footsteps[headIdx]?.feet[h.panel] ?? null : null;
    let segStart = h.startBeat;
    chart.events.forEach((e, i) => {
      if (!e.ghostPanels.includes(h.panel)) return;
      const b = e.row.beat;
      if (b <= h.startBeat + 1e-6 || b >= h.endBeat - 1e-6) return;
      segs.push({ panel: h.panel, start: segStart, end: b, foot, roll: h.roll });
      segStart = b;
      foot = footsteps[i]?.feet[h.panel] ?? foot;
    });
    segs.push({ panel: h.panel, start: segStart, end: h.endBeat, foot, roll: h.roll });
  }
  return segs;
}

export async function recordChartVideo(
  o: VideoExportOptions
): Promise<{ blob: Blob; ext: string }> {
  const { chart, footsteps, timeline } = o;

  // モード別レイアウト。縦=ショート向け1カラム、横=左レーン+右情報ペーンの2カラム
  const L = !!o.landscape;
  // 横長はじっくり観察用に0.5倍速が既定 (等倍オプションあり)。縦は常に等倍
  const vSpeed = L ? o.landscapeSpeed ?? 0.5 : 1;
  const W = L ? 1920 : 720;
  const H = L ? 1080 : 1280;
  const HEADER_H = L ? 24 : 160; // レーン上端 (横はヘッダーなし)
  const LANE_W = L ? 176 : 160;
  const NOTE = L ? 150 : 144;
  const LANE_X = L ? 50 : (W - LANE_W * 4) / 2;
  const RECEPTOR_Y = HEADER_H + (L ? 96 : 82);
  const LANE_BOTTOM = L ? H - 24 : H - 362;
  // 右ペーン (横のみ)。足パッドはペーン中央に大きく合成する
  const paneX = LANE_X + LANE_W * 4 + 46;
  const paneCx = (paneX + W - 40) / 2;
  const PAD_W = L ? 1320 : 760;
  const PAD_H = L ? 660 : 380;
  const padX = L ? paneCx - PAD_W / 2 : (W - PAD_W) / 2;
  const padY = H - PAD_H - (L ? 10 : 8);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const segs = holdSegmentsOf(chart, footsteps);
  const pxPerBeat = NOTE * 1.8 * Math.max(0.25, o.hispeed);
  const fg = fgFor(o.bgColor, o.bgColor2);
  // アプリのステップ数などと同じ縦長フォント (next/fontのAnton)。
  // 実フォント名はCSS変数から実行時に解決し、無ければ太字系にフォールバック
  const titleFont = resolveTitleFont();
  const offsetSec = o.audio ? o.offsetSec : LEAD_IN; // 音源なしはハンクラのみで頭から
  const songEnd = offsetSec + timeAtBeat(timeline, chart.totalBeats) + TAIL;
  const recStart = Math.max(0, offsetSec - LEAD_IN);
  const durationSec = songEnd - recStart; // 譜面内時間

  // 注目シーンのリプレイ (横長のみ)。該当小節を通常再生で見せたあと、
  // 音楽を止めてその小節をクラップ音のみでもう一周 (以上) 再生しながら
  // コメントを字送りする。停止時間はリプレイ周回の整数倍に揃える
  const pauses = (L ? o.spotlights ?? [] : [])
    .map((sp) => {
      const mb0 = Math.floor(sp.beat / 4) * 4;
      const mb1 = Math.min(chart.totalBeats, mb0 + 4);
      const rs = offsetSec + timeAtBeat(timeline, mb0); // リプレイ開始 (譜面内時刻)
      const re = offsetSec + timeAtBeat(timeline, mb1); // リプレイ終了
      const replayReal = Math.max(0.5, (re - rs) / vSpeed); // 1周の実時間
      const textDur = Math.min(8, 2.0 + sp.text.length * 0.06);
      const loops = Math.max(1, Math.min(3, Math.ceil(textDur / replayReal)));
      return {
        // 小節を弾き切った瞬間に停止する (直後のノーツは停止後へ回す)
        t: re - 0.02,
        text: sp.text,
        dur: loops * replayReal,
        rs,
        re,
        replayReal,
        loops,
        measureNo: Math.floor(mb0 / 4) + 1, // 表示用 (1始まり)
      };
    })
    .filter((p) => p.t >= recStart && p.rs >= recStart - 1e-6)
    .sort((a, b) => a.t - b.t);
  const pausesTotal = pauses.reduce((s, p) => s + p.dur, 0);
  // オープニング (横のみ): サムネカード2秒 + 見どころ予告3秒 (解説がある場合)。
  // 縦は従来どおり0.5秒のイントロカードが冒頭の譜面再生に重なる
  const INTRO_CARD_SEC = 2.0;
  // 予告は件数に応じて少し長く見せる (最大5秒)
  const PREVIEW_SEC =
    pauses.length > 0 ? Math.min(5, 2.2 + 0.7 * Math.min(4, pauses.length)) : 0;
  const introTotal = L ? INTRO_CARD_SEC + PREVIEW_SEC : 0;
  // エンディング (横のみ): まとめカード4秒。音源はその手前でフェードアウト
  const endingTotal = L ? 4.0 : 0;
  const realDuration = introTotal + durationSec / vSpeed + pausesTotal; // 譜面終了までの実時間
  const totalReal = realDuration + endingTotal;

  // 譜面内時刻 → 実時間 (イントロと停止分を加算)。クラップの発音時刻計算に使う
  const songToReal = (t: number) => {
    let real = introTotal + (t - recStart) / vSpeed;
    for (const p of pauses) if (p.t < t) real += p.dur;
    return real;
  };

  // 実時間 → 譜面内時刻。停止中はその停止イベントと経過秒も返す
  const realToSong = (
    r: number
  ): { t: number; pauseIdx: number; pauseElapsed: number } => {
    const rr = r - introTotal; // イントロを除いた譜面部分の実時間
    if (rr <= 0) return { t: recStart, pauseIdx: -1, pauseElapsed: 0 };
    let rAcc = 0; // 消費済みの実時間
    let sAcc = recStart; // rAccに対応する譜面内時刻
    for (let i = 0; i < pauses.length; i++) {
      const p = pauses[i];
      const rAtPause = rAcc + (p.t - sAcc) / vSpeed;
      if (rr < rAtPause) break;
      if (rr < rAtPause + p.dur)
        return { t: p.t, pauseIdx: i, pauseElapsed: rr - rAtPause };
      rAcc = rAtPause + p.dur;
      sAcc = p.t;
    }
    return { t: sAcc + (rr - rAcc) * vSpeed, pauseIdx: -1, pauseElapsed: 0 };
  };

  // 音声グラフ (スピーカーにも出して進行がわかるように)
  const actx = new AudioContext();
  await actx.resume();
  const dest = actx.createMediaStreamDestination();
  let musicSrc: AudioBufferSourceNode | null = null;
  const musicGain = actx.createGain(); // エンディングのフェードアウト用
  if (o.audio) {
    musicSrc = actx.createBufferSource();
    musicSrc.buffer = o.audio;
    // 0.5倍速はテープ遅回し方式 (ピッチも1オクターブ下がる)
    musicSrc.playbackRate.value = vSpeed;
    musicSrc.connect(musicGain);
    musicGain.connect(dest);
    musicGain.connect(actx.destination);
  }

  // ハンドクラップ (アプリ再生と同じ判定音を録画開始時刻基準で合成)。
  // 時刻は実時間に換算する: 波形はそのまま間隔だけ1/vSpeedに引き伸ばすので、
  // 0.5倍速でもクラップの音色は変わらない
  const judged = chart.events.filter(
    (e) => e.panels.length > 0 && e.ghostPanels.length === 0 && !e.shock
  );
  // 停止分も織り込んだ実時間で発音する (停止中のノーツはない前提)
  const clapTimes = judged.map((e) => songToReal(offsetSec + timeAtBeat(timeline, e.row.beat)));
  const clapAccents = judged.map((e) => e.panels.length >= 2);
  // リプレイ中のノーツはクラップ音のみで鳴らす (音楽は停止したまま)
  for (const p of pauses) {
    const pauseStartReal = songToReal(p.t);
    for (const e of judged) {
      const te = offsetSec + timeAtBeat(timeline, e.row.beat);
      if (te < p.rs - 1e-6 || te >= p.re - 1e-6) continue;
      for (let n = 0; n < p.loops; n++) {
        clapTimes.push(pauseStartReal + n * p.replayReal + (te - p.rs) / vSpeed);
        clapAccents.push(e.panels.length >= 2);
      }
    }
  }
  const ghostTimes = chart.events
    .filter((e, i) => e.ghostPanels.length > 0 || (e.shock && footsteps[i]?.ghost))
    .map((e) => songToReal(offsetSec + timeAtBeat(timeline, e.row.beat)));
  // カウントダウン (横のみ): 最初のノーツの3秒前から1秒刻みのティック音。
  // オープニング明けに間に合う分だけ鳴らす
  const firstNoteReal =
    judged.length > 0
      ? songToReal(offsetSec + timeAtBeat(timeline, judged[0].row.beat))
      : introTotal;
  const countdownTimes: number[] = [];
  if (L) {
    for (let k = 3; k >= 1; k--) {
      const t = firstNoteReal - k;
      if (t >= introTotal - 1e-6) countdownTimes.push(t);
    }
  }
  const { samples: clapSamples, sr: clapSr } = renderClapTrackSamples(
    clapTimes,
    clapAccents,
    totalReal,
    ghostTimes,
    countdownTimes
  );
  // 字送りに合わせたデジタル音 (矩形波の短いブリップ) をトラックへ焼き込む。
  // 文字の出現時刻は事前に確定しているので、波形に直接書けばズレない
  for (const p of pauses) {
    const startReal = songToReal(p.t) + 0.35; // drawSpotlightCardの字送り開始と同期
    const chars = [...p.text];
    for (let k = 0; k < chars.length; k++) {
      if (/\s/.test(chars[k])) continue; // 空白は無音 (セリフ送りらしい間になる)
      const at = startReal + k * 0.05;
      const start = Math.floor(at * clapSr);
      const len = Math.floor(clapSr * 0.028);
      for (let i = 0; i < len && start + i < clapSamples.length; i++) {
        const t = i / clapSr;
        const sq = Math.sign(Math.sin(2 * Math.PI * 1046.5 * t)); // C6の矩形波
        clapSamples[start + i] += sq * 0.1 * Math.exp(-t * 90);
      }
    }
  }

  const clapBuf = actx.createBuffer(1, clapSamples.length, clapSr);
  clapBuf.copyToChannel(clapSamples as Float32Array<ArrayBuffer>, 0);
  const clapSrc = actx.createBufferSource();
  clapSrc.buffer = clapBuf;
  clapSrc.connect(dest);
  clapSrc.connect(actx.destination);

  // 注目シーン開始の合図音 (上昇2音の短いブリップ)
  const pingBuf = (() => {
    const sr = actx.sampleRate;
    const len = Math.floor(sr * 0.28);
    const buf = actx.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let v = 0;
      if (t < 0.12) v += Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 26) * 0.5;
      if (t >= 0.09) {
        const u = t - 0.09;
        v += Math.sin(2 * Math.PI * 1318.5 * u) * Math.exp(-u * 18) * 0.5;
      }
      ch[i] = v;
    }
    return buf;
  })();
  const playPing = () => {
    const src = actx.createBufferSource();
    src.buffer = pingBuf;
    src.connect(dest);
    src.connect(actx.destination);
    src.start();
  };

  // 右ペーンのストリップチャート用データ (横のみ)。
  // 1拍ビンのノーツ密度 (notes/sec) とBPMの時系列を前計算する
  const graph = (() => {
    if (!L) return null;
    const bins = Math.max(1, Math.ceil(chart.totalBeats));
    const rate: number[] = new Array(bins).fill(0);
    for (let b = 0; b < bins; b++) {
      const t0 = timeAtBeat(timeline, b);
      const t1 = timeAtBeat(timeline, Math.min(chart.totalBeats, b + 1));
      const cnt = judged.filter(
        (e) => e.row.beat >= b - 1e-6 && e.row.beat < b + 1 - 1e-6
      ).length;
      rate[b] = t1 > t0 ? cnt / (t1 - t0) : 0;
    }
    // 隣接ビンの移動平均でギザつきを抑える
    const dens = rate.map((v, i) => (v + (rate[i + 1] ?? v)) / 2);
    const bpmOf = (beat: number) => {
      let cur = timeline.find((s) => s.move)?.bpm ?? 120;
      for (const s of timeline) {
        if (!s.move) continue;
        if (s.beat0 <= beat + 1e-9) cur = s.bpm;
        else break;
      }
      return cur;
    };
    const bpm = Array.from({ length: bins + 1 }, (_, b) => bpmOf(b));
    return {
      bins,
      dens,
      maxDens: Math.max(1e-6, ...dens),
      bpm,
      minBpm: Math.min(...bpm),
      maxBpm: Math.max(...bpm),
    };
  })();

  // 足パッド (アプリと同じThree.jsシーン)
  const footScene = createFootScene();
  footScene?.setSize(PAD_W, PAD_H, 1);
  footScene?.setTrail(!!o.trail);
  const evTimes = chart.events.map((e) => timeAtBeat(timeline, e.row.beat));
  let lastCurIdx = -2;
  let lastFootIdx = -2;

  const videoStream = canvas.captureStream(60);
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const { mime, ext } = pickMime();
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: L ? 12_000_000 : 8_000_000,
  });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // 背景 (ページと同じ斜めストライプ: 115deg・18px相当を動画スケールに拡大)
  const drawStripedBg = () => drawStripedBgOn(ctx, W, H, o.bgColor, o.bgColor2);

  // 冒頭のイントロカード (サムネ画像書き出しと共通の1枚絵)
  const drawIntro = () => drawIntroCard(ctx, o, W, H, L, titleFont, fg);

  // 直角ジャケット+難易度色枠+黒ハードシャドウ (縦ヘッダー/横右ペーン共通)
  const drawFramedJacket = (jx: number, jy: number, jSize: number, fw: number) => {
    ctx.fillStyle = "#17181c";
    ctx.fillRect(jx - fw + 8, jy - fw + 8, jSize + fw * 2, jSize + fw * 2);
    if (o.jacket) {
      ctx.drawImage(o.jacket, jx, jy, jSize, jSize);
    } else {
      ctx.fillStyle = "#0b0e1a";
      ctx.fillRect(jx, jy, jSize, jSize);
      drawArrow(ctx, jx + jSize / 2, jy + jSize / 2, jSize * 0.72, 90, "#ff5262");
    }
    ctx.strokeStyle = o.diff?.cls != null ? DIFF_COLORS[o.diff.cls] : "#ffffff";
    ctx.lineWidth = fw;
    ctx.strokeRect(jx - fw / 2, jy - fw / 2, jSize + fw, jSize + fw);
  };

  // 縦モードの上部ヘッダー
  const drawPortraitHeader = () => {
    // 左右はShortsの縦長画面クロップ (片側最大8%≒60px弱) を避けて配置する
    const SAFE_X = 56;
    // 枠+ハードシャドウがレーン上端 (HEADER_H) に触れない一回り小さめサイズ
    const jSize = 120;
    const jx = SAFE_X;
    const jy = 12;
    drawFramedJacket(jx, jy, jSize, 6);
    // 右側は難易度 (上段) + BPMチップ (下段) の2段組み。
    // 難易度がなければBPMチップだけをジャケット縦中央に置く
    const jMidR = jy + jSize / 2;
    const bpmText = `♩=${o.bpmLabel}`;
    ctx.font = "700 24px ui-monospace, monospace";
    const chipW = ctx.measureText(bpmText).width + 28;
    const chipX = W - SAFE_X - chipW;
    const chipY = (o.diff ? jMidR + 25 : jMidR) - 20;
    roundRectPath(ctx, chipX, chipY, chipW, 40, 8);
    ctx.fillStyle = "rgba(23, 24, 28, 0.85)";
    ctx.fill();
    ctx.fillStyle = "#00e0a0";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(bpmText, chipX + 14, chipY + 21);

    let diffLeft = chipX;
    if (o.diff) {
      const footSize = 40;
      ctx.font = `400 36px ${titleFont}`;
      // 注意: actualBoundingBoxは計測時のtextBaseline基準で返る仕様。
      // 直前のBPMチップがmiddleにしているので、必ずalphabeticに戻してから測る
      // (Safariは仕様通りbaseline依存、Chromiumは常にalphabetic基準のため、
      //  ここを揃えないとiOSだけ数字が上にずれる)
      ctx.textBaseline = "alphabetic";
      const lvlMet = o.diff.lvl ? ctx.measureText(o.diff.lvl) : null;
      const diffW =
        (o.diff.cls !== null ? footSize : 0) +
        (o.diff.cls !== null && o.diff.lvl ? 8 : 0) +
        (lvlMet?.width ?? 0);
      diffLeft = Math.min(chipX, W - SAFE_X - diffW);
      const midY = jMidR - 25;
      let dx = W - SAFE_X - diffW;
      if (o.diff.cls !== null) {
        // 背景色とクラス色が近くても見えるよう白の縁取り付き
        drawDiffFoot(ctx, dx, midY - footSize / 2, footSize, DIFF_COLORS[o.diff.cls], "#ffffff");
        dx += footSize + 8;
      }
      if (o.diff.lvl && lvlMet) {
        // アイコンと数字の視覚的な縦中心を実測グリフ高さで揃える
        ctx.fillStyle = fg;
        ctx.textBaseline = "alphabetic";
        const asc = lvlMet.actualBoundingBoxAscent || 26;
        const desc = lvlMet.actualBoundingBoxDescent || 0;
        ctx.fillText(o.diff.lvl, dx, midY + (asc - desc) / 2);
      }
    }

    // タイトル+サブキャプションのブロックをジャケットの縦中央に揃える。
    // textBaseline="top"はブラウザごとに解釈が異なりiOSで下にずれるため、
    // 実際のグリフ高さを測ってalphabeticベースラインで配置する
    const textX = jx + jSize + 22;
    const textMaxW = diffLeft - textX - 16;
    const jMid = jy + jSize / 2;
    const titleFontDecl = `400 38px ${titleFont}`;
    const subFontDecl = `400 24px ${titleFont}`;
    ctx.textBaseline = "alphabetic";
    ctx.font = titleFontDecl;
    const tMet = ctx.measureText(o.title);
    const tAsc = tMet.actualBoundingBoxAscent || 32;
    const tDesc = tMet.actualBoundingBoxDescent || 6;
    let sAsc = 0;
    let sDesc = 0;
    if (o.subtitle) {
      ctx.font = subFontDecl;
      const sMet = ctx.measureText(o.subtitle);
      sAsc = sMet.actualBoundingBoxAscent || 20;
      sDesc = sMet.actualBoundingBoxDescent || 4;
    }
    const lineGap = o.subtitle ? 22 : 0;
    const blockH = tAsc + tDesc + lineGap + sAsc + sDesc;
    const blockTop = jMid + 4 - blockH / 2; // +4は光学的な微調整
    ctx.fillStyle = fg;
    ctx.font = titleFontDecl;
    ctx.fillText(o.title, textX, blockTop + tAsc, textMaxW);
    if (o.subtitle) {
      ctx.globalAlpha = 0.72;
      ctx.font = subFontDecl;
      ctx.fillText(o.subtitle, textX, blockTop + tAsc + tDesc + lineGap + sAsc, textMaxW);
      ctx.globalAlpha = 1;
    }
  };

  // 横モードの右ペーン: ジャケット+曲名+難易度+BPM / 統計カード。
  // 足パッドはペーン下半分に後段で合成される
  const drawRightPane = (curBeat: number) => {
    const jSize = 170;
    const jx = paneX;
    const jy = 36;
    drawFramedJacket(jx, jy, jSize, 6);
    const textX = jx + jSize + 26;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fg;
    ctx.font = `400 46px ${titleFont}`;
    ctx.fillText(o.title, textX, 82, W - textX - 40);
    if (o.subtitle) {
      ctx.globalAlpha = 0.72;
      ctx.font = `400 27px ${titleFont}`;
      ctx.fillText(o.subtitle, textX, 126, W - textX - 40);
      ctx.globalAlpha = 1;
    }
    // 難易度 + BPMチップを1行に
    const rowY = 178;
    let dx = textX;
    if (o.diff) {
      const footSize = 42;
      ctx.font = `400 38px ${titleFont}`;
      ctx.textBaseline = "alphabetic";
      const lvlMet = o.diff.lvl ? ctx.measureText(o.diff.lvl) : null;
      if (o.diff.cls !== null) {
        drawDiffFoot(ctx, dx, rowY - footSize / 2, footSize, DIFF_COLORS[o.diff.cls], "#ffffff");
        dx += footSize + 8;
      }
      if (o.diff.lvl && lvlMet) {
        ctx.fillStyle = fg;
        const asc = lvlMet.actualBoundingBoxAscent || 27;
        const desc = lvlMet.actualBoundingBoxDescent || 0;
        ctx.fillText(o.diff.lvl, dx, rowY + (asc - desc) / 2);
        dx += lvlMet.width + 24;
      }
    }
    const bpmText = `♩=${o.bpmLabel}`;
    ctx.font = "700 24px ui-monospace, monospace";
    const chipW = ctx.measureText(bpmText).width + 28;
    roundRectPath(ctx, dx, rowY - 20, chipW, 40, 8);
    ctx.fillStyle = "rgba(23, 24, 28, 0.85)";
    ctx.fill();
    ctx.fillStyle = "#00e0a0";
    ctx.textBaseline = "middle";
    ctx.fillText(bpmText, dx + 14, rowY + 1);

    // ステップ数 (BPMチップの隣に小さく)
    const stepsStat = o.stats?.[0];
    if (stepsStat) {
      ctx.font = "700 22px ui-monospace, monospace";
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.8;
      ctx.textBaseline = "middle";
      ctx.fillText(`${stepsStat.value} ${stepsStat.label}`, dx + chipW + 20, rowY + 1);
      ctx.globalAlpha = 1;
    }

    // ストリップチャート: ノーツ密度エリア + BPMステップ線 +
    // 再生カーソル + ★ (解説地点)。譜面全体の緩急がひと目でわかる
    if (graph) {
      const gx = paneX;
      const gw = W - paneX - 40;
      const gy = 240;
      const gh = 118;
      const padB = 8; // 下端の余白
      ctx.fillStyle = "rgba(23, 24, 28, 0.92)";
      ctx.fillRect(gx, gy, gw, gh);
      const xOf = (beat: number) => gx + (beat / chart.totalBeats) * gw;
      // 密度エリア (ミント)
      ctx.beginPath();
      ctx.moveTo(gx, gy + gh - padB);
      for (let b = 0; b < graph.bins; b++) {
        const y = gy + gh - padB - (graph.dens[b] / graph.maxDens) * (gh - 40);
        ctx.lineTo(xOf(b + 0.5), y);
      }
      ctx.lineTo(gx + gw, gy + gh - padB);
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 224, 160, 0.4)";
      ctx.fill();
      ctx.strokeStyle = "#00e0a0";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // BPMステップ線 (黄)。変速なしなら低めの位置に一本線
      ctx.beginPath();
      const bpmY = (v: number) =>
        graph.maxBpm > graph.minBpm
          ? gy + gh - padB - 14 - ((v - graph.minBpm) / (graph.maxBpm - graph.minBpm)) * (gh - 58)
          : gy + gh - padB - (gh - 40) * 0.35;
      for (let b = 0; b <= graph.bins; b++) {
        const y = bpmY(graph.bpm[b]);
        if (b === 0) ctx.moveTo(xOf(b), y);
        else {
          ctx.lineTo(xOf(b), bpmY(graph.bpm[b - 1]));
          ctx.lineTo(xOf(b), y);
        }
      }
      ctx.strokeStyle = "#ffd400";
      ctx.lineWidth = 3;
      ctx.stroke();
      // 凡例 (左上=密度、右上=BPMレンジ)
      ctx.textBaseline = "alphabetic";
      ctx.font = "700 17px system-ui, sans-serif";
      ctx.fillStyle = "rgba(0, 224, 160, 0.95)";
      ctx.textAlign = "left";
      ctx.fillText("密度", gx + 10, gy + 24);
      ctx.fillStyle = "#ffd400";
      ctx.textAlign = "right";
      ctx.fillText(
        graph.maxBpm > graph.minBpm
          ? `BPM ${+graph.minBpm.toFixed(1)}-${+graph.maxBpm.toFixed(1)}`
          : `BPM ${+graph.minBpm.toFixed(1)}`,
        gx + gw - 10,
        gy + 24
      );
      // ★ 解説地点 (リプレイ対象小節の頭)
      ctx.font = "400 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const sp of o.spotlights ?? []) {
        const px = xOf(Math.floor(sp.beat / 4) * 4 + 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#17181c";
        ctx.strokeText("★", px, gy + gh - padB - 4);
        ctx.fillStyle = "#ffd93b";
        ctx.fillText("★", px, gy + gh - padB - 4);
      }
      // 再生カーソル (白の縦線)
      const cx = xOf(Math.max(0, Math.min(chart.totalBeats, curBeat)));
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(cx - 1.5, gy + 4, 3, gh - 8);
      ctx.textAlign = "left";
    }
  };

  // 注目シーンのコメントカード (横のみ)。統計カードと足パッドの間に
  // 白カードを重ね、経過時間ぶんの文字数だけ字送りで表示する
  // リプレイ中のバッジ (レーン上部に重ねる)。点滅で「巻き戻し中」を示す
  const drawReplayBadge = () => {
    const label = "⟲ REPLAY";
    ctx.font = `400 34px ${titleFont}`;
    ctx.textBaseline = "alphabetic";
    const w = ctx.measureText(label).width + 44;
    const h = 54;
    const x = LANE_X + (LANE_W * 4 - w) / 2;
    const y = HEADER_H + 18;
    ctx.fillStyle = "#17181c";
    ctx.fillRect(x + 5, y + 5, w, h);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#17181c";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#17181c";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 22, y + h - 16);
  };

  // テキストを最大幅に収まるよう末尾を省略する
  const ellipsize = (text: string, maxW: number): string => {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  };

  // オープニングの見どころ予告カード (横のみ)
  const drawPreviewCard = () => {
    drawStripedBg();
    drawSiteLogo(ctx, W / 2, 84, 60, "center");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fg;
    ctx.font = `400 60px ${titleFont}`;
    ctx.fillText("今日の見どころ", W / 2, 250);
    const rows = pauses.slice(0, 4);
    const cardW = Math.min(1240, W - 480);
    const cardX = (W - cardW) / 2;
    const cardH = 96;
    const gap = 30;
    const font = '700 31px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    rows.forEach((p, i) => {
      const y = 330 + i * (cardH + gap);
      ctx.fillStyle = "#17181c";
      ctx.fillRect(cardX + 7, y + 7, cardW, cardH);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cardX, y, cardW, cardH);
      ctx.strokeStyle = "#17181c";
      ctx.lineWidth = 4;
      ctx.strokeRect(cardX, y, cardW, cardH);
      // ★ + 小節番号 + 本文 (1行に収まるよう省略)
      ctx.textAlign = "left";
      ctx.font = "400 34px system-ui, sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#17181c";
      ctx.strokeText("★", cardX + 26, y + cardH / 2 + 12);
      ctx.fillStyle = "#ffd93b";
      ctx.fillText("★", cardX + 26, y + cardH / 2 + 12);
      ctx.fillStyle = "#17181c";
      ctx.font = font;
      ctx.fillText(
        ellipsize(`${p.measureNo}小節目：${p.text}`, cardW - 120),
        cardX + 82,
        y + cardH / 2 + 11
      );
      ctx.textAlign = "center";
    });
    if (pauses.length > rows.length) {
      ctx.textAlign = "center";
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.75;
      ctx.font = '700 28px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
      ctx.fillText(
        `…ほか${pauses.length - rows.length}箇所`,
        W / 2,
        330 + rows.length * (cardH + gap) + 24
      );
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  };

  // 再生開始前のカウントダウン (レーン中央に3-2-1)
  const drawCountdown = (r: number) => {
    const remain = firstNoteReal - r;
    if (remain <= 0 || remain > 3) return;
    const n = Math.ceil(remain);
    const frac = 1 - (remain - Math.floor(remain)); // 0→1で次の数字へ
    const cx = LANE_X + LANE_W * 2;
    const cy = (HEADER_H + LANE_BOTTOM) / 2;
    ctx.font = `400 ${Math.round(170 + 40 * (1 - frac))}px ${titleFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 0.9 - 0.5 * frac;
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#17181c";
    ctx.strokeText(String(n), cx, cy);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(n), cx, cy);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  };

  // エンディングのまとめカード (横のみ)。alphaでフェードイン
  const drawEndingCard = (alpha: number) => {
    drawStripedBg();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    drawSiteLogo(ctx, W / 2, 100, 64, "center");
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fg;
    ctx.font = `400 54px ${titleFont}`;
    ctx.fillText(o.title, W / 2, 250, W - 400);
    if (o.subtitle) {
      ctx.globalAlpha *= 0.75;
      ctx.font = `400 32px ${titleFont}`;
      ctx.fillText(o.subtitle, W / 2, 300, W - 400);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    }
    // 統計タイル (エンディングで総括として見せる)
    if (o.stats && o.stats.length > 0) {
      const n = o.stats.length;
      const gap = 16;
      const rowW = Math.min(1300, W - 400);
      const cardW = (rowW - gap * (n - 1)) / n;
      const x0 = (W - rowW) / 2;
      const cardY = 360;
      const cardH = 130;
      for (let i = 0; i < n; i++) {
        const s = o.stats[i];
        const x = x0 + i * (cardW + gap);
        ctx.fillStyle = "rgba(23, 24, 28, 0.92)";
        ctx.fillRect(x, cardY, cardW, cardH);
        ctx.fillStyle = "#00e0a0";
        ctx.font = `400 52px ${titleFont}`;
        ctx.fillText(String(s.value), x + cardW / 2, cardY + 70);
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.font = "700 20px system-ui, sans-serif";
        ctx.fillText(s.label, x + cardW / 2, cardY + 106, cardW - 12);
      }
    }
    // CTA: ブラウザで自分のペースで確認できることを伝える
    ctx.fillStyle = fg;
    ctx.font = '700 34px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.fillText("じっくり確認するならブラウザで、自分のペースで再生できます", W / 2, 610);
    const ctaText = "▶ リンクは概要欄へ";
    ctx.font = '700 38px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    const ctaW = ctx.measureText(ctaText).width + 80;
    const ctaX = (W - ctaW) / 2;
    const ctaY = 660;
    ctx.fillStyle = "#17181c";
    ctx.fillRect(ctaX + 6, ctaY + 6, ctaW, 74);
    ctx.fillStyle = "#ffd400";
    ctx.fillRect(ctaX, ctaY, ctaW, 74);
    ctx.strokeStyle = "#17181c";
    ctx.lineWidth = 4;
    ctx.strokeRect(ctaX, ctaY, ctaW, 74);
    ctx.fillStyle = "#17181c";
    ctx.fillText(ctaText, W / 2, ctaY + 51);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  };

  const drawSpotlightCard = (p: { text: string }, elapsed: number) => {
    const cardX = paneX;
    const cardW = W - paneX - 40;
    const font = '700 30px "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // 全文を折り返してから字送り (行の途中で改行位置が動かないように)
    const maxW = cardW - 132;
    const lines: string[] = [];
    let line = "";
    for (const chr of p.text) {
      if (line && ctx.measureText(line + chr).width > maxW) {
        lines.push(line);
        line = chr;
      } else {
        line += chr;
      }
    }
    if (line) lines.push(line);
    const lineH = 44;
    const cardH = 44 + lines.length * lineH;
    const cardY = 460 - cardH / 2;
    ctx.fillStyle = "#17181c";
    ctx.fillRect(cardX + 8, cardY + 8, cardW, cardH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeStyle = "#17181c";
    ctx.lineWidth = 4;
    ctx.strokeRect(cardX, cardY, cardW, cardH);
    // 注目マーク (アプリの★注目と同じ黄色)
    ctx.font = "36px system-ui, sans-serif";
    ctx.fillStyle = "#ffd93b";
    ctx.strokeStyle = "#17181c";
    ctx.lineWidth = 2.5;
    const starY = cardY + cardH / 2 + 13;
    ctx.strokeText("★", cardX + 30, starY);
    ctx.fillText("★", cardX + 30, starY);
    // 字送り本文
    ctx.font = font;
    ctx.fillStyle = "#17181c";
    let remain = Math.max(0, Math.floor((elapsed - 0.35) / 0.05));
    for (let i = 0; i < lines.length && remain > 0; i++) {
      const seg = lines[i].slice(0, remain);
      ctx.fillText(seg, cardX + 92, cardY + 58 + i * lineH);
      remain -= lines[i].length;
    }
  };

  const drawFrame = (audioTime: number, nowMs: number) => {
    const tSong = audioTime - offsetSec; // 譜面内時刻
    const curBeat = beatAtTime(timeline, Math.max(0, tSong));

    drawStripedBg();

    if (L) {
      drawRightPane(curBeat);
    } else {
      drawPortraitHeader();
    }

    // レーン背景
    ctx.fillStyle = "#17181c";
    ctx.fillRect(LANE_X - 10, HEADER_H, LANE_W * 4 + 20, LANE_BOTTOM - HEADER_H);

    const yOf = (beat: number) => RECEPTOR_Y + (beat - curBeat) * pxPerBeat;
    const clipTop = RECEPTOR_Y - NOTE / 2; // 受け皿上端より上は描かない
    ctx.save();
    ctx.beginPath();
    const clipY = Math.max(HEADER_H, clipTop);
    ctx.rect(LANE_X - 10, clipY, LANE_W * 4 + 20, LANE_BOTTOM - clipY);
    ctx.clip();

    // 体の向きバンド
    chart.events.forEach((ev, i) => {
      const color = facingColor(footsteps[i].facing);
      if (!color) return;
      const bandStart = i > 0 ? chart.events[i - 1].row.beat : 0;
      const y1 = yOf(bandStart);
      const y2 = yOf(ev.row.beat);
      if (y2 < HEADER_H || y1 > LANE_BOTTOM) return;
      ctx.fillStyle = color;
      ctx.fillRect(LANE_X - 10, y1, LANE_W * 4 + 20, y2 - y1);
    });

    // 小節線 + 小節番号
    const beatTop = curBeat + (clipY - RECEPTOR_Y) / pxPerBeat;
    const beatBottom = curBeat + (LANE_BOTTOM - RECEPTOR_Y) / pxPerBeat;
    for (
      let m = Math.max(0, Math.floor(beatTop / 4));
      m * 4 <= beatBottom && m <= chart.measures.length;
      m++
    ) {
      const y = yOf(m * 4);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(LANE_X - 10, y);
      ctx.lineTo(LANE_X + LANE_W * 4 + 10, y);
      ctx.stroke();
      if (m < chart.measures.length) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "700 26px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(String(m + 1), LANE_X - 2, y + 6);
      }
    }

    // フリーズ (保持足の色)。判定線より上は消費済みとして描かない
    for (const s of segs) {
      const a = Math.max(s.start, curBeat);
      const b = s.end;
      if (b <= a || yOf(a) > LANE_BOTTOM) continue;
      ctx.fillStyle = s.roll
        ? "#ff9f43"
        : s.foot === "L"
        ? "rgba(255, 92, 168, 0.72)"
        : s.foot === "R"
        ? "rgba(56, 189, 248, 0.72)"
        : "#2ecc71";
      const x = LANE_X + s.panel * LANE_W + (LANE_W - NOTE) / 2 + 18;
      ctx.fillRect(x, yOf(a), NOTE - 36, yOf(b) - yOf(a));
    }

    // ショックアロー行
    for (const r of chart.shocks) {
      if (r.beat < curBeat - 0.05 || yOf(r.beat) > LANE_BOTTOM + NOTE) continue;
      const y = yOf(r.beat);
      ctx.fillStyle = "rgba(125, 249, 255, 0.16)";
      ctx.fillRect(LANE_X, y - NOTE * 0.3, LANE_W * 4, NOTE * 0.6);
      for (let p = 0; p < 4; p++) {
        drawGhostArrow(
          ctx,
          LANE_X + p * LANE_W + LANE_W / 2,
          y,
          NOTE * 0.5,
          ARROW_ROTATIONS[p],
          "#7df9ff",
          "rgba(125, 249, 255, 0.16)"
        );
      }
    }

    // ノーツ (判定済みは非表示)
    chart.events.forEach((ev, i) => {
      const beat = ev.row.beat;
      if (beat < curBeat - 1e-6) return;
      const y = yOf(beat);
      if (y > LANE_BOTTOM + NOTE) return;
      const step = footsteps[i];
      for (const p of ev.panels) {
        const cx = LANE_X + p * LANE_W + LANE_W / 2;
        if (ev.ghostPanels.includes(p)) {
          drawGhostArrow(ctx, cx, y, NOTE, ARROW_ROTATIONS[p]);
        } else {
          drawArrow(ctx, cx, y, NOTE, ARROW_ROTATIONS[p], QUANT_COLORS[ev.row.quant] ?? "#9aa3b5");
        }
        const foot = step.feet[p];
        if (foot) {
          // バッジはスケールを掛けて描く (chartImage側は9px固定のため)
          const k = NOTE / 58;
          ctx.save();
          ctx.translate(cx + NOTE / 2 - 12, y - NOTE / 2 + 12);
          ctx.scale(k, k);
          drawFootBadge(ctx, 0, 0, foot, false);
          ctx.restore();
        }
      }
    });
    ctx.restore();

    // 受け皿 (直近で踏んだパネルは足の色で光る)
    let curIdx = -1;
    for (let k = 0; k < chart.events.length; k++) {
      if (evTimes[k] <= tSong + 1e-6) curIdx = k;
      else break;
    }
    // フラッシュの実時間は速度によらず一定 (0.18秒)
    const hitEvent =
      curIdx >= 0 && tSong - evTimes[curIdx] < 0.18 * vSpeed ? chart.events[curIdx] : null;
    for (let p = 0; p < 4; p++) {
      const hit = hitEvent?.panels.includes(p) ?? false;
      const foot = hit && curIdx >= 0 ? footsteps[curIdx].feet[p] : null;
      drawReceptor(ctx, LANE_X + p * LANE_W + LANE_W / 2, RECEPTOR_Y, NOTE, p, hit, foot);
    }

    // 足パッド (Three.jsシーンを合成)
    if (footScene) {
      let footIdx = -1;
      // 足の移動アニメーション(実時間0.25秒)ぶんだけ先読みする
      const tLead = tSong + (FOOT_TRAVEL + FOOT_EARLY) * vSpeed;
      for (let k = 0; k < chart.events.length; k++) {
        if (evTimes[k] <= tLead + 1e-6) footIdx = k;
        else break;
      }
      if (footIdx !== lastFootIdx || curIdx !== lastCurIdx) {
        lastFootIdx = footIdx;
        lastCurIdx = curIdx;
        const fstep = footsteps[Math.max(0, footIdx)];
        const cstep = curIdx >= 0 ? footsteps[curIdx] : null;
        const cev = curIdx >= 0 ? chart.events[curIdx] : null;
        if (fstep) {
          footScene.setProps(
            {
              leftPos: fstep.leftPos,
              rightPos: fstep.rightPos,
              stepping: cstep?.shock && cstep.ghost ? [4] : cev?.panels ?? [],
              feet: cstep?.feet ?? [null, null, null, null],
              facing: fstep.facing,
              stepKey: curIdx,
              heldFeet: fstep.heldFeet,
              oneFoot: fstep.stretch,
              liftedFoot: fstep.liftedFoot,
              // 直前ノーツとの等速換算の間隔秒 (収録速度はplaySpeedで渡す)
              trailGapSec:
                footIdx > 0 ? evTimes[footIdx] - evTimes[footIdx - 1] : null,
              playSpeed: vSpeed,
            },
            nowMs
          );
        }
      }
      footScene.frame(nowMs);
      // 幅は領域より広め (左右は空きなのではみ出してOK)。迫力優先で大きく合成
      ctx.drawImage(footScene.canvas, padX, padY, PAD_W, PAD_H);
    }

    // フッター: 進行バー + サイトロゴ風クレジット
    ctx.textAlign = "left";
    drawSiteLogo(ctx, W - 14, H - 32, 22);
    const ratio = Math.max(0, Math.min(1, (audioTime - recStart) / durationSec));
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = "#00e0a0";
    ctx.fillRect(0, H - 8, W * ratio, 8);
    // 注目停止の位置を★で予告する (通過済みは薄く)。急に止まって
    // 驚かないよう、どこで止まるかをタイムライン上で見せておく
    if (pauses.length > 0) {
      ctx.font = "700 24px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      for (const p of pauses) {
        const px = Math.max(16, Math.min(W - 16, (W * (p.t - recStart)) / durationSec));
        ctx.globalAlpha = audioTime > p.t + 1e-6 ? 0.35 : 1;
        ctx.strokeStyle = "#17181c";
        ctx.lineWidth = 3;
        ctx.strokeText("★", px, H - 14);
        ctx.fillStyle = "#ffd93b";
        ctx.fillText("★", px, H - 14);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
  };

  return new Promise<{ blob: Blob; ext: string }>((resolve, reject) => {
    let raf = 0;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      try {
        musicSrc?.stop();
      } catch {
        // 既に停止済みなら無視
      }
      try {
        clapSrc.stop();
      } catch {
        // 既に停止済みなら無視
      }
      footScene?.dispose();
      void actx.close();
    };
    rec.onstop = () => {
      cleanup();
      resolve({ blob: new Blob(chunks, { type: mime || "video/webm" }), ext });
    };
    rec.onerror = () => {
      cleanup();
      reject(new Error("録画に失敗しました"));
    };

    // 録画開始前にイントロカードを描いておく。最初のrAFが来る前に
    // キャプチャされるフレームが真っ黒にならないように (=1フレーム目が
    // そのままサムネになる)
    drawIntro();

    const t0 = actx.currentTime;
    if (musicSrc && o.audio) {
      // オープニングカードの間は待ってから音源を開始する
      musicSrc.start(
        introTotal > 0 ? t0 + introTotal : 0,
        Math.min(recStart, Math.max(0, o.audio.duration - 0.1))
      );
      // エンディング: 譜面終了に合わせてフェードアウト (プツッと切らない)
      if (endingTotal > 0) {
        musicGain.gain.setValueAtTime(1, t0 + realDuration - 0.8);
        musicGain.gain.linearRampToValueAtTime(0, t0 + realDuration + 1.2);
      }
    }
    clapSrc.start(0);
    rec.start(1000);
    let lastPauseIdx = -1;
    const tick = () => {
      if (o.signal?.cancelled) {
        rec.stop();
        return;
      }
      // 実時間 r → 譜面内時刻 (0.5倍速なら半分の速さで進む。注目停止中は凍結)
      const r = actx.currentTime - t0;
      const m = realToSong(r);
      if (m.pauseIdx !== lastPauseIdx) {
        // 停止への出入りで音源を止める/再開する (クラップは停止込みの
        // タイムラインで合成済みなので触らない)
        if (m.pauseIdx >= 0) {
          musicSrc?.playbackRate.setValueAtTime(0.0001, actx.currentTime);
          playPing();
        } else {
          musicSrc?.playbackRate.setValueAtTime(vSpeed, actx.currentTime);
        }
        lastPauseIdx = m.pauseIdx;
      }
      if (L ? r < introTotal : r < INTRO_SEC) {
        // オープニング: サムネカード → 見どころ予告 (解説がある場合)
        if (!L || r < INTRO_CARD_SEC || pauses.length === 0) drawIntro();
        else drawPreviewCard();
      } else if (L && m.t >= songEnd - 1e-6 && r >= realDuration - 1e-6) {
        // エンディング: まとめカード (音源はフェードアウト済み)
        drawEndingCard(Math.min(1, (r - realDuration) / 0.6));
        if (r >= totalReal) {
          rec.stop();
          return;
        }
      } else if (m.pauseIdx >= 0) {
        // リプレイ: 停止中はその小節を頭から周回再生 (クラップ音は合成済み)
        const p = pauses[m.pauseIdx];
        const replayT = Math.min(
          p.re - 1e-3,
          p.rs + (m.pauseElapsed % p.replayReal) * vSpeed
        );
        drawFrame(replayT, performance.now());
        drawReplayBadge();
        drawSpotlightCard(p, m.pauseElapsed);
      } else {
        drawFrame(m.t, performance.now());
        if (L) drawCountdown(r);
      }
      o.onProgress?.(Math.max(0, Math.min(1, r / totalReal)));
      if (!L && m.t >= songEnd) {
        rec.stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
}

// 受け皿の描画 (輪郭のみ、踏んだ瞬間は足色で塗って白枠)
function drawReceptor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  panel: number,
  hit: boolean,
  foot: Foot | null
) {
  const path = new Path2D(ARROW_PATH);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((ARROW_ROTATIONS[panel] * Math.PI) / 180);
  const s = size / 64;
  ctx.scale(s, s);
  ctx.translate(-32, -33);
  ctx.lineJoin = "round";
  ctx.fillStyle = foot ? FOOT_COLORS[foot] : "rgba(255,255,255,0.05)";
  ctx.fill(path);
  ctx.strokeStyle = hit ? "#ffffff" : "#5a6390";
  ctx.lineWidth = 5;
  ctx.stroke(path);
  ctx.restore();
}

/** プロキシ経由で音源を取得してデコードする */
export async function loadAudioFromUrl(url: string): Promise<AudioBuffer> {
  const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `音源の取得に失敗しました (HTTP ${res.status})`);
  }
  const buf = await res.arrayBuffer();
  const actx = new AudioContext();
  try {
    return await actx.decodeAudioData(buf);
  } catch {
    throw new Error(
      "音源をデコードできませんでした (Safariはogg非対応です。mp3/m4aのURLを試してください)"
    );
  } finally {
    void actx.close();
  }
}

/** プロキシ経由でジャケット画像を取得する */
export async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error ?? `画像の取得に失敗しました (HTTP ${res.status})`);
  }
  const blob = await res.blob();
  const img = new Image();
  const objUrl = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.src = objUrl;
    });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
  return img;
}
