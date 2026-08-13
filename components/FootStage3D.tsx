"use client";

// Three.js版の足ステージ。シーン本体はlib/footScene.tsに共有化されており、
// 動画書き出しでも同じレンダラを使う。この層はReactへの接続だけを担う。

import { useEffect, useRef } from "react";
import { createFootScene, type FootScene, type FootSceneProps } from "@/lib/footScene";

export default function FootStage3D(props: FootSceneProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FootScene | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

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

  return (
    <div className="stage3d stage3d-gl">
      <div className="scene" ref={holderRef} />
    </div>
  );
}
