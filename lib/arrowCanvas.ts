// Shared arrow artwork for chart images and embedded video frames.
import {
  ARROW_CRYSTAL_LOWER,
  ARROW_CRYSTAL_UPPER,
  ARROW_INNER_PATH,
  ARROW_PATH,
  RECEPTOR_COLORS,
  arrowPalette,
} from "./arrowShape";
import { FOOT_COLORS, type Foot } from "./chart";
const INK = "#17181c";

// 64x64ビューボックスのパスを (cx, cy) 中心・size幅・rotation度で描く準備
function withArrowTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  draw: () => void
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  const s = size / 64;
  ctx.scale(s, s);
  ctx.translate(-32, -32);
  draw();
  ctx.restore();
}

export function drawArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  color: string
) {
  const body = new Path2D(ARROW_PATH);
  const inner = new Path2D(ARROW_INNER_PATH);
  const cu = new Path2D(ARROW_CRYSTAL_UPPER);
  const cl = new Path2D(ARROW_CRYSTAL_LOWER);
  const pal = arrowPalette(color);
  withArrowTransform(ctx, cx, cy, size, rotation, () => {
    ctx.lineJoin = "miter";
    // 暗い縁
    ctx.strokeStyle = "#07080d";
    ctx.lineWidth = 5;
    ctx.stroke(body);
    // 本体 (ノーツ色。細い同色ストロークで角を丸める)
    const bodyGrad = ctx.createLinearGradient(0, 0, 0, 64);
    bodyGrad.addColorStop(0, pal.bodyTop);
    bodyGrad.addColorStop(1, pal.bodyBottom);
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = bodyGrad;
    ctx.lineWidth = 2;
    ctx.fill(body);
    ctx.stroke(body);
    // 矢頭の内側の帯
    ctx.fillStyle = pal.inner;
    ctx.strokeStyle = pal.inner;
    ctx.lineWidth = 1;
    ctx.fill(inner);
    ctx.stroke(inner);
    // 軸クリスタル
    const cGrad = ctx.createLinearGradient(0, 0, 0, 64);
    cGrad.addColorStop(0.3, pal.crystalTop);
    cGrad.addColorStop(1, pal.crystalBottom);
    ctx.fillStyle = cGrad;
    ctx.fill(cu);
    ctx.fill(cl);
  });
}

/** 受け皿 (ステップゾーン)。踏んだ瞬間は足の色で塗って白縁にする */
export function drawReceptorArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  hitColor: string | null,
  hit: boolean
) {
  const body = new Path2D(ARROW_PATH);
  const parts = [ARROW_INNER_PATH, ARROW_CRYSTAL_UPPER, ARROW_CRYSTAL_LOWER].map(
    (d) => new Path2D(d)
  );
  withArrowTransform(ctx, cx, cy, size, rotation, () => {
    ctx.lineJoin = "miter";
    ctx.fillStyle = hitColor ?? RECEPTOR_COLORS.fill;
    ctx.fill(body);
    ctx.strokeStyle = hit ? "#ffffff" : RECEPTOR_COLORS.stroke;
    ctx.lineWidth = 3;
    ctx.stroke(body);
    if (!hitColor) {
      ctx.fillStyle = RECEPTOR_COLORS.innerFill;
      ctx.strokeStyle = hit ? "#ffffff" : RECEPTOR_COLORS.innerStroke;
      ctx.lineWidth = 1.4;
      for (const part of parts) {
        ctx.fill(part);
        ctx.stroke(part);
      }
    }
  });
}

export function drawGhostArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  rotation: number,
  color = "#7ce8a9",
  fill = "rgba(46, 204, 113, 0.15)"
) {
  const body = new Path2D(ARROW_PATH);
  withArrowTransform(ctx, cx, cy, size, rotation, () => {
    ctx.lineJoin = "round";
    ctx.fillStyle = fill;
    ctx.fill(body);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.setLineDash([7, 5]);
    ctx.stroke(body);
    ctx.setLineDash([]);
  });
}

export function drawFootBadge(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  foot: Foot,
  pinned: boolean
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = FOOT_COLORS[foot];
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = pinned ? "#ffffff" : INK;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(foot, x, y + 0.5);
  ctx.restore();
}

