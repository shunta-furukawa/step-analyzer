"use client";

// Three.js版の足ステージ。シーン本体はlib/footScene.tsに共有化されており、
// 動画書き出しでも同じレンダラを使う。この層はReactへの接続だけを担う。

import { useEffect, useRef, useState } from "react";
import {
  CAMERA_PITCH_DEFAULT,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  createFootScene,
  type FootScene,
  type FootSceneProps,
} from "@/lib/footScene";

// 上下ドラッグ1pxあたりのカメラ仰角の変化 (度)
const PITCH_PER_PX = 0.5;
const clampPitch = (v: number) => Math.max(CAMERA_PITCH_MIN, Math.min(CAMERA_PITCH_MAX, v));

export default function FootStage3D({
  trail = false,
  ...props
}: FootSceneProps & { trail?: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FootScene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const trailRef = useRef(trail);
  trailRef.current = trail;
  // カメラの仰角 (保存しない。リロードで既定に戻る)
  const [pitch, setPitch] = useState(CAMERA_PITCH_DEFAULT);
  const pitchRef = useRef(pitch);
  pitchRef.current = pitch;
  const dragRef = useRef<{ id: number; y: number; pitch: number } | null>(null);

  // シーン構築 (マウント時に1回)
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const fs = createFootScene();
    if (!fs) return; // WebGL不可 (呼び出し側でフォールバック済みの想定)
    sceneRef.current = fs;
    holder.appendChild(fs.canvas);
    fs.canvas.style.width = "100%";
    fs.canvas.style.height = "100%";
    fs.canvas.style.display = "block";
    fs.setProps(propsRef.current); // 初期ポーズを即時反映
    fs.setTrail(trailRef.current);
    fs.setCameraPitch(pitchRef.current);

    const resize = () => {
      fs.setSize(
        holder.clientWidth,
        holder.clientHeight,
        Math.min(2, window.devicePixelRatio || 1)
      );
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(holder);

    // 描画ループ (小さなシーンなので常時回して単純にする)
    let raf = 0;
    const tick = () => {
      fs.frame();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fs.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ポーズの反映はprops変更のコミット時に行う。
  // CSS版のtransitionと同じく「スタイル適用の瞬間に移動開始」となり、
  // 再生中の0.25秒先読みと合わせてジャストのタイミングに着地する
  useEffect(() => {
    sceneRef.current?.setProps(props);
  }, [props]);

  useEffect(() => {
    sceneRef.current?.setTrail(trail);
  }, [trail]);

  useEffect(() => {
    sceneRef.current?.setCameraPitch(pitch);
  }, [pitch]);

  return (
    <div className="stage3d stage3d-gl">
      {/* 上下ドラッグでカメラの高さを変える (下へドラッグ=真上寄り) */}
      <div
        className="scene"
        ref={holderRef}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          dragRef.current = { id: e.pointerId, y: e.clientY, pitch: pitchRef.current };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d || d.id !== e.pointerId) return;
          setPitch(Math.round(clampPitch(d.pitch + (e.clientY - d.y) * PITCH_PER_PX)));
        }}
        onPointerUp={() => (dragRef.current = null)}
        onPointerCancel={() => (dragRef.current = null)}
      />
      <div className="stage-cam">
        <input
          type="number"
          aria-label="camera angle"
          min={CAMERA_PITCH_MIN}
          max={CAMERA_PITCH_MAX}
          step={1}
          value={Math.round(pitch)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(v)) setPitch(clampPitch(v));
          }}
        />
        <span>°</span>
        <button
          type="button"
          aria-label="reset camera"
          disabled={pitch === CAMERA_PITCH_DEFAULT}
          onClick={() => setPitch(CAMERA_PITCH_DEFAULT)}
        >
          ↺
        </button>
      </div>
    </div>
  );
}
