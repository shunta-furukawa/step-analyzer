// 縦型ショート動画 (720x1280) の書き出し。
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
  hispeed: number;
  audio: AudioBuffer | null; // 音源 (なければハンクラのみ)
  jacket: HTMLImageElement | null; // ジャケット (なければアプリアイコン風)
  offsetSec: number; // 譜面1小節目の頭が音源の何秒目か (音源なしなら無視)
  onProgress?: (ratio: number) => void;
  signal?: { cancelled: boolean };
}

const W = 720;
const H = 1280;
const HEADER_H = 160;
const PAD_H = 380; // 下部の足パッド領域 (幅はキャンバスいっぱい)
const PAD_W = 760;
// ノーツサイズはそのまま列間を詰める。レーンが細くなる分だけ左右に
// 余白が生まれ、Shorts系アプリの縦長画面での左右クロップからも逃げられる
const LANE_W = 160;
const NOTE = 144;
const LANE_X = (W - LANE_W * 4) / 2;
const RECEPTOR_Y = HEADER_H + 82;
const LANE_BOTTOM = H - 362;
const LEAD_IN = 1.5; // 録画開始から1ノーツ目までの助走秒数
const INTRO_SEC = 0.5; // 冒頭のサムネ向けイントロカード表示時間
const TAIL = 1.2;
const FOOT_TRAVEL = 0.25;

function fgFor(bgHex: string): string {
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.45 ? "#17181c" : "#ffffff";
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

// ジャケットがないときのアプリアイコン風タイル (ダークネイビー + 赤矢印)
function drawAppIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  roundRectPath(ctx, x, y, size, size, size * 0.16);
  ctx.fillStyle = "#0b0e1a";
  ctx.fill();
  drawArrow(ctx, x + size / 2, y + size / 2, size * 0.72, 90, "#ff5262");
}

export async function recordChartVideo(
  o: VideoExportOptions
): Promise<{ blob: Blob; ext: string }> {
  const { chart, footsteps, timeline } = o;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const segs = holdSegmentsOf(chart, footsteps);
  const pxPerBeat = NOTE * 1.8 * Math.max(0.25, o.hispeed);
  const fg = fgFor(o.bgColor);
  // アプリのステップ数などと同じ縦長フォント (next/fontのAnton)。
  // 実フォント名はCSS変数から実行時に解決し、無ければ太字系にフォールバック
  const logoFont =
    getComputedStyle(document.documentElement).getPropertyValue("--font-logo").trim() ||
    '"Arial Black"';
  const titleFont = `${logoFont}, "Arial Black", system-ui, sans-serif`;
  const offsetSec = o.audio ? o.offsetSec : LEAD_IN; // 音源なしはハンクラのみで頭から
  const songEnd = offsetSec + timeAtBeat(timeline, chart.totalBeats) + TAIL;
  const recStart = Math.max(0, offsetSec - LEAD_IN);
  const durationSec = songEnd - recStart;

  // 音声グラフ (スピーカーにも出して進行がわかるように)
  const actx = new AudioContext();
  await actx.resume();
  const dest = actx.createMediaStreamDestination();
  let musicSrc: AudioBufferSourceNode | null = null;
  if (o.audio) {
    musicSrc = actx.createBufferSource();
    musicSrc.buffer = o.audio;
    musicSrc.connect(dest);
    musicSrc.connect(actx.destination);
  }

  // ハンドクラップ (アプリ再生と同じ判定音を録画開始時刻基準で合成)
  const judged = chart.events.filter(
    (e) => e.panels.length > 0 && e.ghostPanels.length === 0 && !e.shock
  );
  const clapTimes = judged.map((e) => offsetSec + timeAtBeat(timeline, e.row.beat) - recStart);
  const clapAccents = judged.map((e) => e.panels.length >= 2);
  const ghostTimes = chart.events
    .filter((e, i) => e.ghostPanels.length > 0 || (e.shock && footsteps[i]?.ghost))
    .map((e) => offsetSec + timeAtBeat(timeline, e.row.beat) - recStart);
  const { samples: clapSamples, sr: clapSr } = renderClapTrackSamples(
    clapTimes,
    clapAccents,
    durationSec,
    ghostTimes
  );
  const clapBuf = actx.createBuffer(1, clapSamples.length, clapSr);
  clapBuf.copyToChannel(clapSamples as Float32Array<ArrayBuffer>, 0);
  const clapSrc = actx.createBufferSource();
  clapSrc.buffer = clapBuf;
  clapSrc.connect(dest);
  clapSrc.connect(actx.destination);

  // 足パッド (アプリと同じThree.jsシーン)
  const footScene = createFootScene();
  footScene?.setSize(PAD_W, PAD_H, 1);
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
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  // 背景 (ページと同じ斜めストライプ: 115deg・18px相当を動画スケールに拡大)
  const drawStripedBg = () => {
    ctx.fillStyle = `#${o.bgColor}`;
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
  };

  // 冒頭のイントロカード (ショートのサムネはほぼ先頭フレームが使われる)。
  // ジャケット大 + 難易度チップ + 曲名 + BPM を1枚絵として見せる
  const drawIntro = () => {
    drawStripedBg();
    const jSize = 540;
    const jx = (W - jSize) / 2;
    const jy = 150;
    // 枠線は難易度クラスが設定されていればその色に (未設定は白)
    const frameColor = o.diff?.cls != null ? DIFF_COLORS[o.diff.cls] : "#ffffff";
    if (o.jacket) {
      ctx.save();
      roundRectPath(ctx, jx, jy, jSize, jSize, 28);
      ctx.clip();
      ctx.drawImage(o.jacket, jx, jy, jSize, jSize);
      ctx.restore();
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 8;
      roundRectPath(ctx, jx, jy, jSize, jSize, 28);
      ctx.stroke();
    } else {
      drawAppIcon(ctx, jx, jy, jSize);
      ctx.strokeStyle = frameColor;
      ctx.lineWidth = 8;
      roundRectPath(ctx, jx, jy, jSize, jSize, jSize * 0.16);
      ctx.stroke();
    }
    // 難易度チップ (白地にハードシャドウ、ジャケット下辺に重ねる)
    const cls = o.diff?.cls ?? null;
    const lvl = o.diff?.lvl ?? "";
    if (cls !== null || lvl) {
      ctx.font = `400 66px ${titleFont}`;
      const lm = lvl ? ctx.measureText(lvl) : null;
      const footSize = cls !== null ? 78 : 0;
      const innerW = footSize + (footSize && lm ? 14 : 0) + (lm?.width ?? 0);
      const chipW2 = innerW + 60;
      const chipH = 106;
      const cx0 = (W - chipW2) / 2;
      const cy0 = jy + jSize - chipH / 2;
      ctx.fillStyle = "#17181c";
      roundRectPath(ctx, cx0 + 7, cy0 + 7, chipW2, chipH, 14);
      ctx.fill();
      roundRectPath(ctx, cx0, cy0, chipW2, chipH, 14);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "#17181c";
      ctx.lineWidth = 5;
      ctx.stroke();
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
    // 曲名 + アーティスト + BPM (中央揃え)
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fg;
    ctx.font = `400 58px ${titleFont}`;
    ctx.fillText(o.title, W / 2, 856, W - 80);
    if (o.subtitle) {
      ctx.globalAlpha = 0.75;
      ctx.font = `400 34px ${titleFont}`;
      ctx.fillText(o.subtitle, W / 2, 918, W - 80);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 0.8;
    ctx.font = `400 40px ${titleFont}`;
    ctx.fillText("BPM", W / 2, 1032);
    ctx.globalAlpha = 1;
    ctx.font = `400 92px ${titleFont}`;
    ctx.fillText(o.bpmLabel, W / 2, 1134, W - 80);
    ctx.textAlign = "left";
    drawSiteLogo(ctx, W - 14, H - 32, 22);
  };

  const drawFrame = (audioTime: number, nowMs: number) => {
    const tSong = audioTime - offsetSec; // 譜面内時刻
    const curBeat = beatAtTime(timeline, Math.max(0, tSong));

    drawStripedBg();

    // ヘッダ: ジャケット (またはアイコン) + タイトル + BPMチップ
    const jSize = 140;
    const jx = 24; // 端ギリギリはShortsの左右クロップで切れるため少し内側に
    const jy = 10;
    if (o.jacket) {
      ctx.save();
      roundRectPath(ctx, jx, jy, jSize, jSize, 18);
      ctx.clip();
      ctx.drawImage(o.jacket, jx, jy, jSize, jSize);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 4;
      roundRectPath(ctx, jx, jy, jSize, jSize, 18);
      ctx.stroke();
    } else {
      drawAppIcon(ctx, jx, jy, jSize);
    }
    // 右側は難易度 (上段) + BPMチップ (下段) の2段組み。
    // 難易度がなければBPMチップだけをジャケット縦中央に置く
    const jMidR = jy + jSize / 2;
    const bpmText = `♩=${o.bpmLabel}`;
    ctx.font = "700 24px ui-monospace, monospace";
    const chipW = ctx.measureText(bpmText).width + 28;
    const chipX = W - 24 - chipW;
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
      const lvlMet = o.diff.lvl ? ctx.measureText(o.diff.lvl) : null;
      const diffW =
        (o.diff.cls !== null ? footSize : 0) +
        (o.diff.cls !== null && o.diff.lvl ? 8 : 0) +
        (lvlMet?.width ?? 0);
      diffLeft = Math.min(chipX, W - 24 - diffW);
      const midY = jMidR - 25;
      let dx = W - 24 - diffW;
      if (o.diff.cls !== null) {
        // 背景色とクラス色が近くても見えるよう白の縁取り付き
        drawDiffFoot(
          ctx,
          dx,
          midY - footSize / 2,
          footSize,
          DIFF_COLORS[o.diff.cls],
          "#ffffff"
        );
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
    const titleFontDecl = `400 44px ${titleFont}`;
    const subFontDecl = `400 28px ${titleFont}`;
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
    const hitEvent =
      curIdx >= 0 && tSong - evTimes[curIdx] < 0.18 ? chart.events[curIdx] : null;
    for (let p = 0; p < 4; p++) {
      const hit = hitEvent?.panels.includes(p) ?? false;
      const foot = hit && curIdx >= 0 ? footsteps[curIdx].feet[p] : null;
      drawReceptor(ctx, LANE_X + p * LANE_W + LANE_W / 2, RECEPTOR_Y, NOTE, p, hit, foot);
    }

    // 足パッド (Three.jsシーンを合成)
    if (footScene) {
      let footIdx = -1;
      const tLead = tSong + FOOT_TRAVEL;
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
            },
            nowMs
          );
        }
      }
      footScene.frame(nowMs);
      // 幅はキャンバスより広め (左右は空きなのではみ出してOK)。迫力優先で大きく合成
      ctx.drawImage(footScene.canvas, (W - PAD_W) / 2, H - PAD_H - 8, PAD_W, PAD_H);
    }

    // フッター: 進行バー + サイトロゴ風クレジット
    ctx.textAlign = "left";
    drawSiteLogo(ctx, W - 14, H - 32, 22);
    const ratio = Math.max(0, Math.min(1, (audioTime - recStart) / durationSec));
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = "#00e0a0";
    ctx.fillRect(0, H - 8, W * ratio, 8);
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

    const t0 = actx.currentTime;
    if (musicSrc && o.audio) {
      musicSrc.start(0, Math.min(recStart, Math.max(0, o.audio.duration - 0.1)));
    }
    clapSrc.start(0);
    rec.start(1000);
    const tick = () => {
      if (o.signal?.cancelled) {
        rec.stop();
        return;
      }
      const audioTime = recStart + (actx.currentTime - t0);
      if (audioTime - recStart < INTRO_SEC) drawIntro();
      else drawFrame(audioTime, performance.now());
      o.onProgress?.(Math.max(0, Math.min(1, (audioTime - recStart) / durationSec)));
      if (audioTime >= songEnd) {
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
