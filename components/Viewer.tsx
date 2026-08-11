"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  QUANT_COLORS,
  assignFeet,
  facingColor,
  parseCompact,
  statsOf,
  tickOf,
  type Foot,
  type FootOverride,
} from "@/lib/chart";
import { buildClapTrackUrl, setPlaybackAudioSession } from "@/lib/clap";
import { computeChartImageLayout, renderChartImage } from "@/lib/chartImage";
import { buildClipData } from "@/lib/clip";
import { compressCompact } from "@/lib/codec";
import {
  parseOverrides,
  placeHoldRange,
  serializeOverrides,
  toggleNote,
  toggleShock,
} from "@/lib/edit";
import {
  beatAtTime,
  bpmAtBeat,
  buildTimeline,
  extractTimingFromSM,
  normalizeParam,
  parseBpmParam,
  parseStopsParam,
  sanitizeTimingInput,
  timeAtBeat,
} from "@/lib/timing";
import { LANGS, STRINGS, type Lang, type Strings } from "@/lib/i18n";
import {
  NAMED_TRANSFORMS,
  applyTransform,
  invertPerm,
  parseTransform,
  randomTransform,
} from "@/lib/transform";
import { listSmCharts, normalizeNotesInput, type SmChartInfo } from "@/lib/url";
import { ARROW_PATH, ARROW_VIEWBOX } from "@/lib/arrowShape";
import Arrow from "./Arrow";

const EDIT_RESOLUTIONS = [4, 8, 12, 16, 24, 32];
const HISPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2, 3];
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1];

// URLパラメータの値を選択肢のうち最も近いものに丸める
function parseChoice(v: string | undefined, options: number[], def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  let best = def;
  let dist = Infinity;
  for (const o of options) {
    const d = Math.abs(o - n);
    if (d < dist) {
      dist = d;
      best = o;
    }
  }
  return best;
}
// フルスクリーンモードのステップゾーン位置 (譜面エリア上端からの中心距離)
const RECEPTOR_Y = 90;

// 足の移動トランジションにかかる実時間 (.foot3d の transition と揃える)
const FOOT_TRAVEL_SEC = 0.25;

// 背景色のデフォルト (DDR WORLDミントグリーン)
const DEFAULT_BG = "29d6a2";

// ツールバーに出す変形オプションの短縮ラベル
function transformShortLabel(tr: string): string {
  if (tr === "mirror") return "MIRROR";
  if (tr === "left") return "LEFT";
  if (tr === "right") return "RIGHT";
  return "RND";
}

export default function Viewer({
  compact: initialCompact,
  title: initialTitle,
  bpm: initialBpm,
  stops: initialStops,
  overrides: initialOverrides,
  hispeed: initialHispeed,
  speed: initialSpeed,
  bg: initialBg,
  lang: initialLang,
  transform: initialTransform,
}: {
  compact: string;
  title?: string;
  bpm?: string;
  stops?: string;
  overrides?: string;
  hispeed?: string;
  speed?: string;
  bg?: string;
  lang?: Lang;
  transform?: string;
}) {
  const [lang, setLang] = useState<Lang>(initialLang ?? "ja");
  const S = STRINGS[lang];
  // 変形オプション (mirror/left/right/ランダムの4桁順列)。表示用のビュー変換
  const [transform, setTransform] = useState(
    initialTransform && parseTransform(initialTransform) ? initialTransform : ""
  );
  const [showOptions, setShowOptions] = useState(false);
  // カスタム並び替えで最初に選んだレーン (2つ目のタップで入れ替える)
  const [swapSel, setSwapSel] = useState<number | null>(null);
  // クリップ共有モーダル
  const [showClip, setShowClip] = useState(false);
  // 入力途中の空欄や桁の途中を許すため文字列で持ち、検証はblur/コピー時のみ
  const [clipStart, setClipStart] = useState("1");
  const [clipEnd, setClipEnd] = useState("1");
  const [clipName, setClipName] = useState("");
  const [clipCopied, setClipCopied] = useState(false);
  const [clipError, setClipError] = useState(false);
  const [clipNameDirty, setClipNameDirty] = useState(false);

  // 範囲に合わせてクリップ名を自動追従させる (ユーザーが名前を編集したら停止)
  const syncClipName = (startStr: string, endStr: string) => {
    if (clipNameDirty || !chart) return;
    const st = Number(startStr);
    const en = Number(endStr);
    const base = title || S.untitled;
    if (
      Number.isInteger(st) &&
      Number.isInteger(en) &&
      st >= 1 &&
      en <= chart.measures.length &&
      st <= en
    ) {
      setClipName(st === 1 && en === chart.measures.length ? base : `${base} (${st}-${en})`);
    }
  };

  // クリップ範囲の検証。無効ならnull (エラー表示はblur/コピー時に行う)
  const parseClipRange = (): { start: number; end: number } | null => {
    if (!chart) return null;
    const total = chart.measures.length;
    const start = Number(clipStart);
    const end = Number(clipEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end > total || start > end) return null;
    return { start, end };
  };

  // 小節番号タップによる範囲選択。共有・画像書き出しのデフォルト範囲になる。
  // aだけの状態=始点選択中、bが入ると確定 (上下逆でも正規化する)
  const [rangeSel, setRangeSel] = useState<{ a: number; b: number | null } | null>(
    null
  );
  const selRange =
    rangeSel && rangeSel.b !== null
      ? {
          start: Math.min(rangeSel.a, rangeSel.b) + 1,
          end: Math.max(rangeSel.a, rangeSel.b) + 1,
        }
      : null;
  const tapMeasureNum = (mi: number) => {
    if (!rangeSel || rangeSel.b !== null) {
      // 未選択、または確定済み → その小節を新しい始点に
      setRangeSel({ a: mi, b: null });
      return;
    }
    if (rangeSel.a === mi) {
      setRangeSel(null);
      return;
    }
    setRangeSel({ a: rangeSel.a, b: mi });
  };

  // 画像書き出しモーダル (クリップと同じ「検証はblur/実行時のみ」方式)
  const [showImage, setShowImage] = useState(false);
  const [imgStart, setImgStart] = useState("1");
  const [imgEnd, setImgEnd] = useState("1");
  // 1列に描く小節数 (長すぎる値は書き出し時にクランプ)
  const [imgPerCol, setImgPerCol] = useState("16");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgDone, setImgDone] = useState(false);
  const [imgError, setImgError] = useState(false);

  const parseImgRange = (): { start: number; end: number } | null => {
    if (!chart) return null;
    const total = chart.measures.length;
    const start = Number(imgStart);
    const end = Number(imgEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 1 || end > total || start > end) return null;
    return { start, end };
  };
  const [compact, setCompact] = useState(initialCompact);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [bpm, setBpm] = useState(() => normalizeParam(initialBpm ?? ""));
  const [stops, setStops] = useState(() => normalizeParam(initialStops ?? ""));
  const [showTiming, setShowTiming] = useState(false);
  const [overrides, setOverrides] = useState<Map<number, FootOverride>>(() =>
    parseOverrides(initialOverrides)
  );
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState(0);
  // 再生中に足の位置だけ先行させるためのインデックス。
  // 移動トランジション (FOOT_TRAVEL_SEC) ぶん早く動き出すことで、
  // 足がジャストのタイミングでパネルに「到着」して見えるようにする。
  const [footIdx, setFootIdx] = useState(0);
  // fs再生でジャスト済みノーツを即非表示にするための「通過済み」インデックス。
  // currentは再生前も先頭ノーツを指すため、通過判定は別に持つ (-1=未通過)
  const [playedIdx, setPlayedIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => parseChoice(initialSpeed, SPEED_OPTIONS, 1));
  const [hispeed, setHispeed] = useState(() =>
    parseChoice(initialHispeed, HISPEED_OPTIONS, 1)
  );
  const [muted, setMuted] = useState(false);
  const [ghostSound, setGhostSound] = useState(true); // 空打ちのストンプ音
  const [bgColor, setBgColor] = useState(() =>
    initialBg && /^[0-9a-fA-F]{6}$/.test(initialBg) ? initialBg.toLowerCase() : DEFAULT_BG
  );
  const [editMode, setEditMode] = useState(false);
  const [editRes, setEditRes] = useState(16);
  const [editShock, setEditShock] = useState(false);
  const [editGhost, setEditGhost] = useState(false);
  const [editFreeze, setEditFreeze] = useState(false);
  // フリーズ配置の始点 (終点タップで確定)
  const [freezeAnchor, setFreezeAnchor] = useState<{
    m: number;
    row: number;
    panel: number;
  } | null>(null);
  const [showText, setShowText] = useState(false);
  const [fs, setFs] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [narrow, setNarrow] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  // fs再生時のサブピクセルスクロール用 (scrollTopは整数に量子化されるため)
  const chartInnerRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef(0);
  const timeRef = useRef(0);
  // 仮想化: 描画するビート範囲 (画面内 + バッファ)
  const [viewBeats, setViewBeats] = useState({ a: 0, b: 120 });
  const clapTrackRef = useRef<{ key: string; el: HTMLAudioElement; url: string } | null>(
    null
  );
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // 背景色をページ全体とブラウザUI (theme-color) に反映
  useEffect(() => {
    document.documentElement.style.setProperty("--page-bg", `#${bgColor}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", `#${bgColor}`);
  }, [bgColor]);

  // 画面幅に応じて譜面の描画サイズを切り替える (スマホ縦持ち最優先)
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 560);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const fsLane =
    typeof window !== "undefined"
      ? Math.min(96, Math.floor((window.innerWidth - 16) / 4))
      : 80;
  const noteSize = fs ? fsLane - 10 : narrow ? 28 : 40;
  // 1拍の高さは矢印サイズの1.8倍 (通常表示・フルスクリーン・画像書き出しで統一)
  const pxPerBeat = (fs ? noteSize * 1.8 : narrow ? 52 : 72) * hispeed;
  const laneW = fs ? fsLane : narrow ? 36 : 52;

  // 変形オプション適用後の譜面 (表示・解析はすべてこちらを使う)。
  // 元データ (compact) はURLにそのまま保存され、変形は tr= として別に持つ
  const perm = useMemo(() => parseTransform(transform), [transform]);
  const viewCompact = useMemo(
    () => (perm ? applyTransform(compact, perm) : compact),
    [compact, perm]
  );

  const parsed = useMemo(() => {
    try {
      return { chart: parseCompact(viewCompact), error: null };
    } catch (e) {
      return { chart: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [viewCompact]);

  const chart = parsed.chart;

  // 譜面の編集や読み込みで小節数が変わったら範囲選択をリセット
  useEffect(() => {
    setRangeSel(null);
  }, [compact]);

  const footsteps = useMemo(
    () => (chart ? assignFeet(chart.events, overrides, chart.holds) : []),
    [chart, overrides]
  );
  const stats = useMemo(
    () => statsOf(footsteps, chart?.shocks.length ?? 0),
    [footsteps, chart]
  );

  // フリーズバーを保持足の色で塗り分けるためのセグメント。
  // 空打ち (持ち替え) のたびに区間を切り、以降は引き継いだ足の色にする
  const holdSegments = useMemo(() => {
    if (!chart) return [];
    const segs: {
      panel: number;
      start: number;
      end: number;
      foot: Foot | null;
      roll: boolean;
    }[] = [];
    for (const h of chart.holds) {
      const headIdx = chart.events.findIndex(
        (e) => Math.abs(e.row.beat - h.startBeat) < 1e-6 && e.panels.includes(h.panel)
      );
      let foot: Foot | null =
        headIdx >= 0 ? footsteps[headIdx]?.feet[h.panel] ?? null : null;
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
  }, [chart, footsteps]);

  // ソフラン・停止のタイミングデータ
  const bpms = useMemo(() => parseBpmParam(bpm), [bpm]);
  const stopList = useMemo(() => parseStopsParam(stops), [stops]);
  const timeline = useMemo(
    () => (chart ? buildTimeline(bpms, stopList, chart.totalBeats) : []),
    [chart, bpms, stopList]
  );
  const hasSofran = bpms.length > 1 || stopList.length > 0;

  // 譜面が長い場合はdeflate圧縮したdパラメータを使い、URLを短くする。
  // "," と ":" はクエリ値として合法なのでエンコードせずそのまま残す
  // (共有経路での二重エンコードによる変速情報の消失を防ぐ)
  const buildUrl = useCallback(async () => {
    const enc = (v: string) =>
      encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
    const parts: string[] = [];
    const encoded = await compressCompact(compact);
    if (encoded && encoded.length < compact.length) parts.push(`d=${encoded}`);
    else parts.push(`n=${compact}`);
    if (title) parts.push(`t=${encodeURIComponent(title)}`);
    if (bpm) parts.push(`b=${enc(bpm)}`);
    if (stops) parts.push(`s=${enc(stops)}`);
    if (overrides.size > 0) parts.push(`f=${serializeOverrides(overrides)}`);
    if (hispeed !== 1) parts.push(`hs=${hispeed}`);
    if (speed !== 1) parts.push(`sp=${speed}`);
    if (bgColor !== DEFAULT_BG) parts.push(`c=${bgColor}`);
    if (lang !== "ja") parts.push(`l=${lang}`);
    if (transform) parts.push(`tr=${transform}`);
    return `/?${parts.join("&")}`;
  }, [compact, title, bpm, stops, overrides, hispeed, speed, bgColor, lang, transform]);

  // 編集・足指定・タイトル変更をURLへ反映 (何か触るまでは書き換えない)。
  // カラーピッカーのドラッグ等で連続変更されるため、書き込みはデバウンスする
  // (iOS SafariはreplaceStateを10秒に100回超呼ぶとSecurityErrorで落ちる)
  useEffect(() => {
    if (!dirty) return;
    let alive = true;
    const timer = setTimeout(() => {
      void buildUrl().then((url) => {
        if (!alive) return;
        try {
          window.history.replaceState(null, "", url);
        } catch {
          // 回数制限に当たっても無視 (次のデバウンス書き込みで反映される)
        }
      });
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [dirty, buildUrl]);

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(footsteps.length - 1, i)),
    [footsteps.length]
  );

  const go = useCallback(
    (i: number) => {
      const idx = clamp(i);
      setCurrent(idx);
      setFootIdx(idx);
      if (chart && chart.events[idx]) beatRef.current = chart.events[idx].row.beat;
    },
    [clamp, chart]
  );

  // クラップトラックの準備 (譜面・タイミング・再生速度が変わったら作り直す)。
  // playbackRateで減速するとクラップ1発ごとの音まで間延びするため、
  // 速度ごとに「間隔だけ引き伸ばし、波形はそのまま」のトラックを生成し
  // 常に等速で再生する。トラック上の時刻 = 曲内時刻 / speed。
  const prepareClapTrack = useCallback(() => {
    if (!chart || timeline.length === 0) return null;
    setPlaybackAudioSession();
    const key = `${compact}|${bpm}|${stops}|${speed}|${ghostSound ? 1 : 0}|${serializeOverrides(overrides)}`;
    if (clapTrackRef.current?.key === key) return clapTrackRef.current.el;
    if (clapTrackRef.current) {
      clapTrackRef.current.el.pause();
      URL.revokeObjectURL(clapTrackRef.current.url);
    }
    // 空打ちはクラップではなく低いストンプ音 (オプションでOFF可)。
    // ショックは無視ならミュート、中央空打ち指定ならストンプ
    const judged = chart.events.filter(
      (e) => e.panels.length > 0 && e.ghostPanels.length === 0 && !e.shock
    );
    const times = judged.map((e) => timeAtBeat(timeline, e.row.beat) / speed);
    const accents = judged.map((e) => e.panels.length >= 2);
    const ghostTimes = ghostSound
      ? chart.events
          .filter((e, i) => e.ghostPanels.length > 0 || (e.shock && footsteps[i]?.ghost))
          .map((e) => timeAtBeat(timeline, e.row.beat) / speed)
      : [];
    const url = buildClapTrackUrl(
      times,
      accents,
      timeAtBeat(timeline, chart.totalBeats) / speed,
      ghostTimes
    );
    const el = new Audio(url);
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    clapTrackRef.current = { key, el, url };
    return el;
  }, [chart, timeline, compact, bpm, stops, speed, ghostSound, overrides, footsteps]);

  // 再生開始 (ユーザー操作の文脈で呼ぶこと: audio.play()の許可が必要)
  const startPlayback = useCallback(() => {
    if (!mutedRef.current) {
      const el = prepareClapTrack();
      if (el) {
        try {
          el.currentTime = timeAtBeat(timeline, beatRef.current) / speed;
        } catch {
          // メタデータ未ロードでも再生側で追従する
        }
        void el.play().catch(() => {});
      }
    }
    setPlaying(true);
  }, [prepareClapTrack, timeline, speed]);

  const togglePlay = useCallback(() => {
    if (playing) setPlaying(false);
    else startPlayback();
  }, [playing, startPlayback]);

  // フルスクリーン (Short撮影) モードの出入り
  const enterFs = useCallback(() => {
    setEditMode(false);
    setShowText(false);
    setShowTiming(false);
    setFs(true);
    startPlayback();
    try {
      void document.documentElement.requestFullscreen?.();
    } catch {
      /* iOS Safariなどは非対応でOK (CSSオーバーレイで代替) */
    }
  }, [startPlayback]);

  const exitFs = useCallback(() => {
    setFs(false);
    setPlaying(false);
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* noop */
    }
  }, []);

  // fs中は背面のスクロールを止める
  useEffect(() => {
    document.body.style.overflow = fs ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fs]);

  // 自動再生中は画面をスリープさせない (Screen Wake Lock、iOS 16.4+)。
  // ロックはタブが隠れると自動解放されるため、復帰時に取り直す
  useEffect(() => {
    if (!playing) return;
    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
        };
        const wl = await nav.wakeLock?.request("screen");
        if (!wl) return;
        if (stopped) {
          void wl.release().catch(() => {});
          return;
        }
        lock = wl;
      } catch {
        // 非対応ブラウザ・低電力モードなどでは黙って諦める
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, [playing]);

  // キーボード操作 (←/→ or J/K、スペースで再生/停止)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.key === "ArrowRight" || e.key === "j") {
        e.preventDefault();
        setPlaying(false);
        go(current + 1);
      } else if (e.key === "ArrowLeft" || e.key === "k") {
        e.preventDefault();
        setPlaying(false);
        go(current - 1);
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Escape") {
        exitFs();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, current, togglePlay, exitFs]);

  // 自動再生: タイムライン (ソフラン・停止込み) に沿って時間基準で進行。
  // 譜面スクロール・足の動き・クラップ音をすべて時刻→拍の変換で同期する。
  useEffect(() => {
    if (!playing || !chart || timeline.length === 0) return;
    // 現在の拍位置から時刻を復元して再開
    timeRef.current = timeAtBeat(timeline, beatRef.current);
    // クラップトラック: 再生中は音声側をマスタークロックにする
    // (iOSの画面収録でrAFがスロットルされても音と同期が保たれる)。
    // トラックは速度込みでレンダリング済みなので常に等速再生
    const track = !mutedRef.current ? prepareClapTrack() : null;
    if (track) {
      if (Math.abs(track.currentTime * speed - timeRef.current) > 0.05) {
        try {
          track.currentTime = timeRef.current / speed;
        } catch {
          // メタデータ未ロード時は無視
        }
      }
      if (track.paused) void track.play().catch(() => {});
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (track && !track.paused && track.readyState >= 2) {
        timeRef.current = track.currentTime * speed;
      } else {
        timeRef.current += dt * speed;
      }
      beatRef.current = beatAtTime(timeline, timeRef.current);
      if (beatRef.current >= chart.totalBeats - 1e-9) {
        beatRef.current = chart.totalBeats;
        setPlaying(false);
      }
      let idx = -1;
      for (let k = 0; k < chart.events.length; k++) {
        if (chart.events[k].row.beat <= beatRef.current + 1e-6) idx = k;
        else break;
      }
      if (idx >= 0) setCurrent((c) => (c !== idx ? idx : c));
      setPlayedIdx((c) => (c !== idx ? idx : c));

      // 足の位置は移動時間ぶん先読み: ジャストの瞬間に次のパネルへ到着させる。
      // timeRefは譜面内時刻なので、実時間の先読みはspeed倍して換算する
      const leadBeat = beatAtTime(timeline, timeRef.current + FOOT_TRAVEL_SEC * speed);
      let fIdx = idx;
      for (let k = Math.max(0, idx); k < chart.events.length; k++) {
        if (chart.events[k].row.beat <= leadBeat + 1e-6) fIdx = k;
        else break;
      }
      if (fIdx >= 0) setFootIdx((c) => (c !== fIdx ? fIdx : c));

      const el = scrollRef.current;
      const inner = chartInnerRef.current;
      if (el) {
        if (fs && inner) {
          // fs時はステップゾーンに現在ビートが重なるよう合わせる。
          // scrollTopは整数pxに量子化されてサブピクセルの滑らかさが出ないため、
          // GPU合成されるtransformで小数px単位の追従をする (目の疲れ対策)
          const offset = beatRef.current * pxPerBeat + noteSize / 2 - RECEPTOR_Y;
          inner.style.transform = `translate3d(0, ${-offset}px, 0)`;
          // フリーズバーを受け皿の中心 (判定線) で消費させるための現在位置
          inner.style.setProperty(
            "--fs-cut",
            `${beatRef.current * pxPerBeat + noteSize / 2}px`
          );
          if (el.scrollTop !== 0) el.scrollTop = 0;
          // transformではscrollイベントが出ないので、仮想化の範囲もここで更新
          const a = offset / pxPerBeat - 8;
          const b2 = (offset + el.clientHeight) / pxPerBeat + 8;
          setViewBeats((v) =>
            Math.abs(v.a - a) > 2 || Math.abs(v.b - b2) > 2 ? { a, b: b2 } : v
          );
        } else {
          el.scrollTop = beatRef.current * pxPerBeat - el.clientHeight * 0.4;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (track) track.pause();
      // transformスクロールを解除し、通常のスクロール位置に引き継ぐ
      const inner = chartInnerRef.current;
      if (inner && inner.style.transform) {
        inner.style.transform = "";
        inner.style.removeProperty("--fs-cut");
        const el = scrollRef.current;
        if (el)
          el.scrollTop = Math.max(
            0,
            beatRef.current * pxPerBeat + noteSize / 2 - RECEPTOR_Y
          );
      }
    };
  }, [playing, chart, timeline, speed, pxPerBeat, fs, noteSize, muted, prepareClapTrack]);

  // 仮想化: スクロール位置から描画対象のビート範囲を更新
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chart) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = el.scrollTop / pxPerBeat - 8;
      const b2 = (el.scrollTop + el.clientHeight) / pxPerBeat + 8;
      setViewBeats((v) =>
        Math.abs(v.a - a) > 2 || Math.abs(v.b - b2) > 2 ? { a, b: b2 } : v
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pxPerBeat, chart]);

  // 手動操作時に現在のイベントが見えるようにスクロール。
  // 編集モード中は譜面の書き換えのたびに発火してスクロール位置が
  // 先頭に飛んでしまうため、自動スクロールしない
  useEffect(() => {
    if (playing || editMode || !chart || !scrollRef.current) return;
    const ev = chart.events[current];
    if (!ev) return;
    const el = scrollRef.current;
    el.scrollTo({
      top: fs
        ? ev.row.beat * pxPerBeat + noteSize / 2 - RECEPTOR_Y
        : ev.row.beat * pxPerBeat - el.clientHeight / 2 + noteSize,
      behavior: "smooth",
    });
  }, [current, chart, playing, editMode, pxPerBeat, noteSize, fs]);

  if (!chart) {
    return (
      <div className="card">
        <h2>{S.loadError}</h2>
        <p className="error">{parsed.error}</p>
        <p style={{ marginTop: 12 }}>
          <a href="/">{S.backToTop}</a>
        </p>
      </div>
    );
  }

  const totalH = chart.totalBeats * pxPerBeat + noteSize;
  const curStep = footsteps[current];
  // 再生中の足の描画位置は先読みインデックスから取る (ジャスト到着)
  const footStep = (playing ? footsteps[footIdx] : curStep) ?? curStep;
  const curEvent = chart.events[current];
  // 2枚抜き・フリーズ保持しながらのつま先拾いでは、
  // 踏み足を2パネルの中間にまたがせて表示する
  const stageOneFoot = footStep?.stretch ?? null;
  const curTick = curEvent ? tickOf(curEvent.row.beat) : null;
  const curOverride = curTick !== null ? overrides.get(curTick) : undefined;
  const facing = curStep?.facing ?? 0;

  const setOverride = (foot: FootOverride | null) => {
    if (curTick === null) return;
    const next = new Map(overrides);
    if (foot === null) next.delete(curTick);
    else next.set(curTick, foot);
    setOverrides(next);
    setDirty(true);
  };

  // 変形ビュー上での編集結果を元データに逆変換して保存する
  const applyViewEdit = (nextView: string) => {
    applyEdit(perm ? applyTransform(nextView, invertPerm(perm)) : nextView);
  };

  const applyEdit = (next: string) => {
    setPlaying(false);
    setCompact(next);
    setDirty(true);
  };

  return (
    <div className={fs ? "viewer-fs" : undefined}>
      <div className="bg-picker-wrap">
        <div className="lang-wrap">
          <span className="lang-badge">
            {LANGS.find((l) => l.value === lang)?.flag}
            {lang.toUpperCase()}
          </span>
          <select
            className="lang-select"
            value={lang}
            onChange={(e) => {
              setLang(e.target.value as Lang);
              setDirty(true);
            }}
            aria-label="Language"
          >
            {LANGS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>
        {bgColor !== DEFAULT_BG && (
          <button
            className="secondary bg-reset"
            onClick={() => {
              setBgColor(DEFAULT_BG);
              setDirty(true);
            }}
            title={S.bgResetTitle}
          >
            ↺
          </button>
        )}
        <input
          type="color"
          className="bg-picker"
          value={`#${bgColor}`}
          onChange={(e) => {
            setBgColor(e.target.value.slice(1).toLowerCase());
            setDirty(true);
          }}
          title={S.bgPickerTitle}
        />
      </div>
      <div className="card head-card">
        <div className="head-row">
          <div style={{ minWidth: 0 }}>
            <div className="chart-title">
              {editingTitle ? (
                <input
                  type="text"
                  className="title-input"
                  value={title}
                  autoFocus
                  placeholder={S.titlePlaceholder}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setDirty(true);
                  }}
                  onBlur={() => setEditingTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setEditingTitle(false);
                  }}
                />
              ) : (
                <button className="title-btn" onClick={() => setEditingTitle(true)}>
                  {title || S.untitled} <span className="edit-pen">✎</span>
                </button>
              )}
              {/* BPMチップ: タップで変速・停止パネルを開閉 (旧・変速ボタンを統合) */}
              <button
                className={`bpm-chip${hasSofran ? " sofran" : ""}${
                  showTiming ? " open" : ""
                }`}
                onClick={() => setShowTiming(!showTiming)}
                title={S.timingPanelTitle}
              >
                ♩=
                {bpms.length > 1
                  ? `${+Math.min(...bpms.map((x) => x.bpm)).toFixed(1)}-${+Math.max(
                      ...bpms.map((x) => x.bpm)
                    ).toFixed(1)}`
                  : `${+bpms[0].bpm.toFixed(1)}`}
                {stopList.length > 0 && " ⏸"}
                <span className="bpm-caret">▾</span>
              </button>
            </div>
            <div className="legend">
              <span className="chip">
                <span className="dot" style={{ background: FOOT_COLORS.L }} /> {S.leftFoot}
              </span>
              <span className="chip">
                <span className="dot" style={{ background: FOOT_COLORS.R }} /> {S.rightFoot}
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[4] }} /> 4{S.quantSuffix}
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[8] }} /> 8{S.quantSuffix}
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[12] }} /> 12{S.quantSuffix}
              </span>
              <span className="chip">
                <span className="dot" style={{ background: QUANT_COLORS[16] }} /> 16{S.quantSuffix}
              </span>
              <span className="chip">
                <span className="facing-legend">
                  <span style={{ background: "rgba(255,92,168,0.5)" }} />
                  <span style={{ background: "rgba(255,92,168,0.2)" }} />
                  <span style={{ background: "rgba(56,189,248,0.2)" }} />
                  <span style={{ background: "rgba(56,189,248,0.5)" }} />
                </span>
                {S.facingLegend}
              </span>
            </div>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="num">{stats.steps}</div>
              <div className="label">{S.steps}</div>
            </div>
            <div className="stat">
              <div className="num">{stats.jumps}</div>
              <div className="label">{S.jumps}</div>
            </div>
            <div className="stat">
              <div className="num">{stats.jacks}</div>
              <div className="label">{S.jacks}</div>
            </div>
            <div className="stat">
              <div className="num">{stats.crossovers}</div>
              <div className="label">{S.crossovers}</div>
            </div>
            <div className="stat">
              <div className="num">{stats.doubleSteps}</div>
              <div className="label">{S.doubleSteps}</div>
            </div>
            {stats.holdSwaps > 0 && (
              <div className="stat">
                <div className="num swap-num">{stats.holdSwaps}</div>
                <div className="label">{S.ghosts}</div>
              </div>
            )}
            {stats.shocks > 0 && (
              <div className="stat">
                <div className="num shock-num">{stats.shocks}</div>
                <div className="label">{S.shocks}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="toolbar">
        <button
          className={editMode ? "" : "secondary"}
          onClick={() => {
            setPlaying(false);
            setEditMode(!editMode);
          }}
        >
          ✎ {editMode ? S.editing : S.edit}
        </button>
        <button className="secondary" onClick={() => setShowText(!showText)}>
          {narrow ? S.textBtnShort : S.textBtn}
        </button>
        <button
          className={transform ? "" : "secondary"}
          onClick={() => setShowOptions(true)}
          title={S.optionsTitle}
        >
          ⚙ {narrow ? `HS${hispeed}×` : S.optionsBtn}
          {transform && ` ${transformShortLabel(transform)}`}
        </button>
        <span className="toolbar-spacer" />
        <button
          className="secondary"
          onClick={() => {
            if (!chart) return;
            // 小節番号タップで選択済みの範囲があればそれをデフォルトに
            const st = selRange ? selRange.start : 1;
            const en = selRange ? selRange.end : chart.measures.length;
            const base = title || S.untitled;
            setClipStart(String(st));
            setClipEnd(String(en));
            setClipName(
              st === 1 && en === chart.measures.length ? base : `${base} (${st}-${en})`
            );
            setClipNameDirty(false);
            setClipCopied(false);
            setClipError(false);
            setShowClip(true);
          }}
        >
          {S.clipBtn}
        </button>
        <button
          className="secondary"
          onClick={() => {
            if (!chart) return;
            setImgStart(String(selRange ? selRange.start : 1));
            setImgEnd(String(selRange ? selRange.end : chart.measures.length));
            setImgDone(false);
            setImgError(false);
            setShowImage(true);
          }}
          title={S.imageBtnTitle}
        >
          📷
        </button>
      </div>

      {editMode && (
        <div className="toolbar edit-toolbar">
          <select
            value={editRes}
            onChange={(e) => {
              setEditRes(Number(e.target.value));
              setFreezeAnchor(null);
            }}
          >
            {EDIT_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {S.placeAt(r)}
              </option>
            ))}
          </select>
          <button
            className={editShock ? "" : "secondary"}
            onClick={() => {
              setEditShock(!editShock);
              setEditGhost(false);
              setEditFreeze(false);
              setFreezeAnchor(null);
            }}
            title={S.shockModeTitle}
          >
            ⚡{editShock ? S.shockModeActive : S.shockMode}
          </button>
          <button
            className={editGhost ? "" : "secondary"}
            onClick={() => {
              setEditGhost(!editGhost);
              setEditShock(false);
              setEditFreeze(false);
              setFreezeAnchor(null);
            }}
            title={S.ghostModeTitle}
          >
            ◇{editGhost ? S.ghostModeActive : S.ghostMode}
          </button>
          <button
            className={editFreeze ? "" : "secondary"}
            onClick={() => {
              setEditFreeze(!editFreeze);
              setEditShock(false);
              setEditGhost(false);
              setFreezeAnchor(null);
            }}
            title={S.freezeModeTitle}
          >
            ▮{editFreeze ? S.freezeModeActive : S.freezeMode}
          </button>
        </div>
      )}

      {showOptions && (
        <div className="modal-backdrop" onClick={() => setShowOptions(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{S.optionsTitle}</h2>
              <button className="secondary modal-close" onClick={() => setShowOptions(false)}>
                ✕
              </button>
            </div>
            <div className="opt-row">
              <span className="opt-label">{S.hispeedLabel}</span>
              <select
                value={hispeed}
                onChange={(e) => {
                  setHispeed(Number(e.target.value));
                  setDirty(true);
                }}
              >
                {HISPEED_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    HS {h}×
                  </option>
                ))}
              </select>
            </div>
            <div className="opt-row">
              <span className="opt-label">{S.transformLabel}</span>
              <div className="opt-btns">
                <button
                  className={!transform ? "" : "secondary"}
                  onClick={() => {
                    setTransform("");
                    setDirty(true);
                  }}
                >
                  {S.transformOff}
                </button>
                {(["mirror", "left", "right"] as const).map((t) => (
                  <button
                    key={t}
                    className={transform === t ? "" : "secondary"}
                    onClick={() => {
                      setTransform(t);
                      setDirty(true);
                    }}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
                <button
                  className={/^[0-3]{4}$/.test(transform) ? "" : "secondary"}
                  onClick={() => {
                    setTransform(randomTransform());
                    setDirty(true);
                  }}
                >
                  RANDOM
                </button>
              </div>
              {/^[0-3]{4}$/.test(transform) && (
                <p className="hint opt-hint">{S.transformRandomReroll}</p>
              )}
              <span className="opt-label perm-label">{S.transformCustom}</span>
              <div className="perm-row">
                {(perm ?? [0, 1, 2, 3]).map((o, i) => (
                  <button
                    key={i}
                    className={`secondary perm-btn${swapSel === i ? " selected" : ""}`}
                    onClick={() => {
                      if (swapSel === null) {
                        setSwapSel(i);
                        return;
                      }
                      if (swapSel === i) {
                        setSwapSel(null);
                        return;
                      }
                      const cur = [...(perm ?? [0, 1, 2, 3])];
                      [cur[swapSel], cur[i]] = [cur[i], cur[swapSel]];
                      const digits = cur.join("");
                      const named = Object.entries(NAMED_TRANSFORMS).find(
                        ([, pm]) => pm.join("") === digits
                      )?.[0];
                      setTransform(digits === "0123" ? "" : named ?? digits);
                      setSwapSel(null);
                      setDirty(true);
                    }}
                  >
                    <span className="perm-lane">{["←", "↓", "↑", "→"][i]}</span>
                    {["←", "↓", "↑", "→"][o]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showClip && chart && (
        <div className="modal-backdrop" onClick={() => setShowClip(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{S.clipTitle}</h2>
              <button className="secondary modal-close" onClick={() => setShowClip(false)}>
                ✕
              </button>
            </div>
            <p className="hint opt-hint">{S.clipDesc}</p>
            <div className="clip-range">
              <label className="timing-label">
                {S.clipStart}
                <input
                  type="number"
                  inputMode="numeric"
                  value={clipStart}
                  onChange={(e) => {
                    setClipStart(e.target.value);
                    syncClipName(e.target.value, clipEnd);
                    setClipCopied(false);
                  }}
                  onBlur={() => setClipError(parseClipRange() === null)}
                />
              </label>
              <label className="timing-label">
                {S.clipEnd}
                <input
                  type="number"
                  inputMode="numeric"
                  value={clipEnd}
                  onChange={(e) => {
                    setClipEnd(e.target.value);
                    syncClipName(clipStart, e.target.value);
                    setClipCopied(false);
                  }}
                  onBlur={() => setClipError(parseClipRange() === null)}
                />
              </label>
              {parseClipRange() && (
                <span className="opt-hint clip-count">
                  {S.clipMeasures(parseClipRange()!.end - parseClipRange()!.start + 1)}
                </span>
              )}
            </div>
            {clipError && <p className="error">{S.clipRangeError(chart.measures.length)}</p>}
            <div className="opt-row">
              <span className="opt-label">{S.clipNameLabel}</span>
              <input
                type="text"
                value={clipName}
                onChange={(e) => {
                  setClipName(e.target.value);
                  setClipNameDirty(true);
                }}
              />
            </div>
            <button
              onClick={async () => {
                const range = parseClipRange();
                if (!range) {
                  setClipError(true);
                  return;
                }
                setClipError(false);
                const clip = buildClipData(
                  compact,
                  bpms,
                  stopList,
                  overrides,
                  range.start,
                  range.end
                );
                const enc = (v: string) =>
                  encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
                const parts: string[] = [];
                const encoded = await compressCompact(clip.compact);
                if (encoded && encoded.length < clip.compact.length)
                  parts.push(`d=${encoded}`);
                else parts.push(`n=${clip.compact}`);
                if (clipName) parts.push(`t=${encodeURIComponent(clipName)}`);
                if (clip.b) parts.push(`b=${enc(clip.b)}`);
                if (clip.s) parts.push(`s=${enc(clip.s)}`);
                if (clip.f) parts.push(`f=${clip.f}`);
                if (hispeed !== 1) parts.push(`hs=${hispeed}`);
                if (speed !== 1) parts.push(`sp=${speed}`);
                if (bgColor !== DEFAULT_BG) parts.push(`c=${bgColor}`);
                if (lang !== "ja") parts.push(`l=${lang}`);
                if (transform) parts.push(`tr=${transform}`);
                try {
                  await navigator.clipboard.writeText(
                    `${location.origin}/?${parts.join("&")}`
                  );
                  setClipCopied(true);
                } catch {
                  // クリップボード不可の環境では諦める
                }
              }}
            >
              {clipCopied ? S.clipCopied : S.clipCopy}
            </button>
          </div>
        </div>
      )}

      {showImage && chart && (
        <div className="modal-backdrop" onClick={() => setShowImage(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{S.imageTitle}</h2>
              <button className="secondary modal-close" onClick={() => setShowImage(false)}>
                ✕
              </button>
            </div>
            <p className="hint opt-hint">{S.imageDesc}</p>
            <div className="clip-range">
              <label className="timing-label">
                {S.clipStart}
                <input
                  type="number"
                  inputMode="numeric"
                  value={imgStart}
                  onChange={(e) => {
                    setImgStart(e.target.value);
                    setImgDone(false);
                  }}
                  onBlur={() => setImgError(parseImgRange() === null)}
                />
              </label>
              <label className="timing-label">
                {S.clipEnd}
                <input
                  type="number"
                  inputMode="numeric"
                  value={imgEnd}
                  onChange={(e) => {
                    setImgEnd(e.target.value);
                    setImgDone(false);
                  }}
                  onBlur={() => setImgError(parseImgRange() === null)}
                />
              </label>
              {parseImgRange() && (
                <span className="opt-hint clip-count">
                  {S.clipMeasures(parseImgRange()!.end - parseImgRange()!.start + 1)}
                </span>
              )}
            </div>
            {imgError && <p className="error">{S.clipRangeError(chart.measures.length)}</p>}
            <div className="opt-row">
              <span className="opt-label">{S.imagePerCol}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={imgPerCol}
                onChange={(e) => {
                  setImgPerCol(e.target.value);
                  setImgDone(false);
                }}
              />
            </div>
            {(() => {
              // 書き出しレイアウトのワイヤーフレームプレビュー。
              // 実際の描画と同じ計算式なので縦横比と段組みがそのままわかる
              const range = parseImgRange();
              if (!range) return null;
              const perColNum = Math.floor(Number(imgPerCol));
              const layout = computeChartImageLayout(
                range.end - range.start + 1,
                Number.isFinite(perColNum) && perColNum >= 1 ? perColNum : 16,
                hispeed
              );
              const sc = Math.min(200 / layout.width, 150 / layout.height, 1);
              const ratio =
                layout.height >= layout.width
                  ? `1 : ${(layout.height / layout.width).toFixed(1)}`
                  : `${(layout.width / layout.height).toFixed(1)} : 1`;
              return (
                <div className="img-preview">
                  <div
                    className="img-preview-frame"
                    style={{
                      width: Math.max(6, layout.width * sc),
                      height: Math.max(6, layout.height * sc),
                      background: `#${bgColor}`,
                    }}
                  >
                    {layout.cols.map((c, i) => (
                      <div
                        key={i}
                        className="img-preview-col"
                        style={{
                          left: c.x * sc,
                          top: c.y * sc,
                          width: c.w * sc,
                          height: c.h * sc,
                        }}
                      />
                    ))}
                  </div>
                  <span className="img-preview-meta">
                    {Math.round(layout.width)}×{Math.round(layout.height)}px
                    <br />
                    {ratio}
                  </span>
                </div>
              );
            })()}
            <button
              disabled={imgBusy}
              onClick={async () => {
                const range = parseImgRange();
                if (!range) {
                  setImgError(true);
                  return;
                }
                setImgError(false);
                setImgBusy(true);
                try {
                  // 空欄や0以下は既定の16小節/列に倒す
                  const perColNum = Math.floor(Number(imgPerCol));
                  const canvas = renderChartImage({
                    chart,
                    footsteps,
                    overrides,
                    startMeasure: range.start,
                    endMeasure: range.end,
                    title: title || S.untitled,
                    bgColor,
                    measuresPerColumn:
                      Number.isFinite(perColNum) && perColNum >= 1 ? perColNum : 16,
                    hispeed,
                  });
                  const blob = await new Promise<Blob | null>((resolve) =>
                    canvas.toBlob(resolve, "image/png")
                  );
                  if (!blob) return;
                  const base = (title || S.untitled).replace(/[\\/:*?"<>|]/g, "_");
                  const file = new File(
                    [blob],
                    `${base}_${range.start}-${range.end}.png`,
                    { type: "image/png" }
                  );
                  // iOSなどでは共有シート、それ以外はダウンロード
                  if (navigator.canShare?.({ files: [file] })) {
                    try {
                      await navigator.share({ files: [file] });
                      setImgDone(true);
                      return;
                    } catch (err) {
                      // ユーザーが共有シートを閉じただけなら何もしない
                      if ((err as DOMException)?.name === "AbortError") return;
                    }
                  }
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = file.name;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  setImgDone(true);
                } finally {
                  setImgBusy(false);
                }
              }}
            >
              {imgBusy ? S.imageSaving : imgDone ? S.imageSaved : S.imageSave}
            </button>
          </div>
        </div>
      )}

      {editMode && (
        <p className="hint edit-hint">
          {editShock
            ? S.hintShock
            : editGhost
            ? S.hintGhost
            : editFreeze
            ? freezeAnchor
              ? S.hintFreezeEnd
              : S.hintFreezeStart
            : S.hintNormal}
        </p>
      )}

      {rangeSel && chart && (
        <p className="range-hint">
          <span>
            {rangeSel.b === null
              ? S.rangePending(rangeSel.a + 1)
              : S.rangeActive(
                  Math.min(rangeSel.a, rangeSel.b) + 1,
                  Math.max(rangeSel.a, rangeSel.b) + 1
                )}
          </span>
          <button className="secondary range-clear" onClick={() => setRangeSel(null)}>
            ✕ {S.rangeClear}
          </button>
        </p>
      )}

      {showTiming && (
        <div className="card text-import">
          <PanelHead title={S.timingPanelTitle} helpTitle={S.helpTitle}>{S.timingPanelDesc}</PanelHead>
          <div className="form-row">
            <label className="timing-label">
              {S.bpmField}
              <input
                type="text"
                value={bpm}
                placeholder="130,32:650,64:130"
                onChange={(e) => {
                  setBpm(sanitizeTimingInput(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
            <label className="timing-label">
              {S.stopsField}
              <input
                type="text"
                value={stops}
                placeholder="48:0.5,52:0.25"
                onChange={(e) => {
                  setStops(sanitizeTimingInput(e.target.value));
                  setDirty(true);
                }}
              />
            </label>
          </div>
        </div>
      )}

      {showText && (
        <TextImport
          compact={compact}
          S={S}
          onApply={(next, timing, smTitle) => {
            applyEdit(next);
            setOverrides(new Map());
            if (timing?.b) setBpm(timing.b);
            if (timing?.s !== undefined) setStops(timing.s);
            if (smTitle) setTitle(smTitle);
            go(0);
            setShowText(false);
          }}
        />
      )}

      <div className="viewer-layout">
        <div className="chart-pane" onClick={fs ? togglePlay : undefined}>
          {fs && (
            <>
              <div
                className="fs-progress"
                style={{
                  width: `${chart.totalBeats > 0 ? Math.min(100, (100 * (chart.events[current]?.row.beat ?? 0)) / chart.totalBeats) : 0}%`,
                }}
              />
              {/* 通過済みノーツを隠す覆い。受け皿の上端より上だけを覆い、
                  判定位置 (受け皿と重なる瞬間) には一切掛からないようにする */}
              <div className="fs-cover" style={{ height: RECEPTOR_Y - noteSize / 2 }}>
                <div className="fs-title">
                  <span className="fs-title-name">{title || "Step Analyzer"}</span>
                  {bpm && <span> · BPM {bpm}</span>}
                </div>
              </div>
              <div
                className="fs-receptors"
                style={{ top: RECEPTOR_Y - noteSize / 2, width: laneW * 4 }}
              >
                {[0, 1, 2, 3].map((p) => {
                  const hit = curEvent?.panels.includes(p) ?? false;
                  const foot = hit ? curStep?.feet[p] : null;
                  return (
                    <div
                      key={`${p}-${hit ? current : "idle"}`}
                      className={`receptor${hit ? " hit" : ""}`}
                      style={{ width: laneW, height: noteSize }}
                    >
                      <svg
                        width={noteSize}
                        height={noteSize}
                        viewBox={ARROW_VIEWBOX}
                        style={{ transform: `rotate(${ARROW_ROTATIONS[p]}deg)` }}
                      >
                        <path
                          d={ARROW_PATH}
                          fill={foot ? FOOT_COLORS[foot] : "rgba(255,255,255,0.05)"}
                          stroke={hit ? "#ffffff" : "#5a6390"}
                          strokeWidth={4}
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  );
                })}
              </div>
              {!playing && <div className="fs-paused">▶</div>}
              <button
                className="fs-exit"
                onClick={(e) => {
                  e.stopPropagation();
                  exitFs();
                }}
              >
                ✕
              </button>
            </>
          )}
          <div
            className="chart-scroll"
            ref={scrollRef}
            // fs時は受け皿の上端から上を切り落とし、通過した要素が
            // ステップゾーンの上に突き抜けて見えないようにする
            style={fs ? { clipPath: `inset(${RECEPTOR_Y - noteSize / 2}px 0 0 0)` } : undefined}
          >
            <div
              className="chart-inner"
              ref={chartInnerRef}
              style={{ width: laneW * 4, height: totalH }}
            >
              {/* 体の向きの背景バンド: ノーツi-1→ノーツi の領域を
                  「ノーツiを踏んだときの向き」の色で塗る (これから来る捻りの予告)。
                  1ノーツ目は譜面先頭 (初期位置=正面) から塗る */}
              {chart.events.map((ev, i) => {
                const startBeat = i > 0 ? chart.events[i - 1].row.beat : 0;
                if (ev.row.beat < viewBeats.a || startBeat > viewBeats.b) return null;
                const color = facingColor(footsteps[i].facing);
                if (!color) return null;
                return (
                  <div
                    key={`fb${i}`}
                    className="facing-band"
                    style={{
                      top: startBeat * pxPerBeat + noteSize / 2,
                      height: Math.max(0, (ev.row.beat - startBeat) * pxPerBeat),
                      background: color,
                    }}
                  />
                );
              })}

              {Array.from({ length: chart.measures.length + 1 }, (_, m) => {
                if ((m + 1) * 4 < viewBeats.a || m * 4 > viewBeats.b) return null;
                return (
                <div key={`m${m}`}>
                  <div
                    className="measure-line"
                    style={{ top: m * 4 * pxPerBeat + noteSize / 2 }}
                  />
                  {m < chart.measures.length && (
                    <span
                      className={`measure-num${
                        rangeSel && rangeSel.b === null && rangeSel.a === m
                          ? " range-anchor"
                          : selRange && m + 1 >= selRange.start && m + 1 <= selRange.end
                          ? " in-range"
                          : ""
                      }`}
                      style={{ top: m * 4 * pxPerBeat + noteSize / 2 + 4 }}
                    >
                      {m + 1}
                    </span>
                  )}
                  {m < chart.measures.length && (
                    // 左端の小節番号ゾーン: タップで範囲選択 (譜面レーンは邪魔しない)
                    <div
                      className="measure-tap"
                      style={{
                        top: m * 4 * pxPerBeat + noteSize / 2,
                        height: 4 * pxPerBeat,
                      }}
                      onClick={() => tapMeasureNum(m)}
                    />
                  )}
                  {m < chart.measures.length &&
                    [1, 2, 3].map((b) => (
                      <div
                        key={b}
                        className="beat-line"
                        style={{ top: (m * 4 + b) * pxPerBeat + noteSize / 2 }}
                      />
                    ))}
                </div>
                );
              })}

              {/* 範囲選択のインジケータ: 左端の縦バー (選択中は薄く表示) */}
              {rangeSel && (
                <div
                  className={`range-bar${rangeSel.b === null ? " pending" : ""}`}
                  style={{
                    top:
                      Math.min(rangeSel.a, rangeSel.b ?? rangeSel.a) * 4 * pxPerBeat +
                      noteSize / 2,
                    height:
                      (Math.abs((rangeSel.b ?? rangeSel.a) - rangeSel.a) + 1) *
                      4 *
                      pxPerBeat,
                  }}
                />
              )}

              {editMode &&
                chart.measures.map((_, mi) => {
                  if ((mi + 1) * 4 < viewBeats.a || mi * 4 > viewBeats.b) return null;
                  return Array.from({ length: editRes }, (_, r) => {
                    const beat = mi * 4 + (r / editRes) * 4;
                    const cellH = Math.min(noteSize, (4 * pxPerBeat) / editRes - 1);
                    return [0, 1, 2, 3].map((p) => (
                      <div
                        key={`e${mi}-${r}-${p}`}
                        className={`edit-cell${
                          freezeAnchor &&
                          freezeAnchor.m === mi &&
                          freezeAnchor.row === r &&
                          freezeAnchor.panel === p
                            ? " freeze-anchor"
                            : ""
                        }`}
                        style={{
                          left: p * laneW + (laneW - noteSize) / 2,
                          top: beat * pxPerBeat + noteSize / 2 - cellH / 2,
                          width: noteSize,
                          height: cellH,
                        }}
                        onClick={() => {
                          // フリーズ配置モード: 始点→終点の2タップで配置
                          if (editFreeze) {
                            if (
                              freezeAnchor &&
                              freezeAnchor.m === mi &&
                              freezeAnchor.row === r &&
                              freezeAnchor.panel === p
                            ) {
                              setFreezeAnchor(null);
                              return;
                            }
                            if (!freezeAnchor || freezeAnchor.panel !== p) {
                              setFreezeAnchor({ m: mi, row: r, panel: p });
                              return;
                            }
                            applyViewEdit(
                              placeHoldRange(
                                viewCompact,
                                freezeAnchor.m,
                                freezeAnchor.row,
                                mi,
                                r,
                                editRes,
                                p
                              )
                            );
                            setFreezeAnchor(null);
                            return;
                          }
                          // 空打ちモード中は常に5。通常モードでも
                          // フリーズ保持中のセルには自動で空打ち (5) を置く
                          const inHold = chart.holds.some(
                            (h) =>
                              h.panel === p &&
                              beat > h.startBeat + 1e-6 &&
                              beat < h.endBeat - 1e-6
                          );
                          applyViewEdit(
                            editShock
                              ? toggleShock(viewCompact, mi, r, editRes)
                              : toggleNote(
                                  viewCompact,
                                  mi,
                                  r,
                                  editRes,
                                  p,
                                  editGhost || inHold ? "5" : "1"
                                )
                          );
                        }}
                      />
                    ));
                  });
                })}

              {/* ソフラン・停止マーカー */}
              {bpms.slice(1).map((e, i) =>
                e.beat < chart.totalBeats ? (
                  <div
                    key={`bc${i}`}
                    className="timing-marker bpm-marker"
                    style={{ top: e.beat * pxPerBeat + noteSize / 2 }}
                  >
                    BPM {+e.bpm.toFixed(1)}
                  </div>
                ) : null
              )}
              {stopList.map((e, i) =>
                e.beat < chart.totalBeats ? (
                  <div
                    key={`st${i}`}
                    className="timing-marker stop-marker"
                    style={{ top: e.beat * pxPerBeat + noteSize / 2 }}
                  >
                    STOP {+e.sec.toFixed(2)}s
                  </div>
                ) : null
              )}

              {holdSegments.map((s, i) => (
                s.end < viewBeats.a || s.start > viewBeats.b ? null :
                <div
                  key={`h${i}`}
                  className="hold-body"
                  style={{
                    left: s.panel * laneW + (laneW - noteSize) / 2 + 6,
                    top: s.start * pxPerBeat + noteSize / 2,
                    width: noteSize - 12,
                    height: (s.end - s.start) * pxPerBeat,
                    // fs再生中は判定線より上を削って「消費されていく」見た目に。
                    // --fs-cut未設定時はcalcが大きな負値になりクリップ無効
                    ...(fs
                      ? {
                          clipPath: `inset(calc(var(--fs-cut, -99999px) - ${
                            s.start * pxPerBeat + noteSize / 2
                          }px) 0 0 0)`,
                        }
                      : {}),
                    // ロールはオレンジ、フリーズは保持足の色 (不明なら緑)
                    background: s.roll
                      ? "#ff9f43"
                      : s.foot === "L"
                      ? "rgba(255, 92, 168, 0.66)"
                      : s.foot === "R"
                      ? "rgba(56, 189, 248, 0.66)"
                      : "#2ecc71",
                  }}
                />
              ))}

              {chart.shocks.map((r, i) => {
                if (r.beat < viewBeats.a || r.beat > viewBeats.b) return null;
                const evIdx = chart.events.findIndex((e) => e.shock && e.row === r);
                const ov = overrides.get(tickOf(r.beat));
                const label =
                  ov === "C" ? S.badgeBoth : ov === "CL" ? "◇L" : ov === "CR" ? "◇R" : null;
                return (
                <div
                  key={`shock${i}`}
                  className={`shock-row${editMode ? " editing" : ""}${
                    evIdx === current && !editMode ? " current" : ""
                  }`}
                  style={{
                    left: 2,
                    top: r.beat * pxPerBeat + noteSize * 0.1,
                    width: laneW * 4 - 4,
                    height: noteSize * 0.8,
                  }}
                  title={S.shockRowTitle}
                  onClick={() => {
                    if (editMode || evIdx < 0) return;
                    setPlaying(false);
                    go(evIdx);
                  }}
                >
                  {[0, 1, 2, 3].map((p) => (
                    <svg
                      key={p}
                      viewBox={ARROW_VIEWBOX}
                      width={noteSize * 0.62}
                      height={noteSize * 0.62}
                      style={{ transform: `rotate(${ARROW_ROTATIONS[p]}deg)` }}
                    >
                      <path
                        d={ARROW_PATH}
                        fill="rgba(125, 249, 255, 0.16)"
                        stroke="#7df9ff"
                        strokeWidth={4}
                        strokeLinejoin="round"
                      />
                    </svg>
                  ))}
                  {label && (
                    <span
                      className="shock-label"
                      style={{
                        color:
                          ov === "CL"
                            ? "var(--foot-l)"
                            : ov === "CR"
                            ? "var(--foot-r)"
                            : "#7df9ff",
                      }}
                    >
                      {label}
                    </span>
                  )}
                </div>
                );
              })}

              {chart.mines.map((m, i) => (
                m.beat < viewBeats.a || m.beat > viewBeats.b ? null :
                <div
                  key={`mine${i}`}
                  className="mine"
                  style={{
                    left: m.panel * laneW + (laneW - noteSize) / 2,
                    top: m.beat * pxPerBeat,
                    width: noteSize,
                    height: noteSize,
                    fontSize: noteSize * 0.6,
                  }}
                  title={S.mineTitle}
                >
                  ✕
                </div>
              ))}

              {chart.events.map((ev, i) => {
                if (ev.row.beat < viewBeats.a || ev.row.beat > viewBeats.b) return null;
                // fs再生中: 受け皿でジャスト表示が出たノーツは実機同様に消す
                if (fs && playing && i <= playedIdx) return null;
                const step = footsteps[i];
                return ev.panels.map((p) => {
                  const foot = step.feet[p];
                  const hasOverride = overrides.has(tickOf(ev.row.beat));
                  const isGhost = ev.ghostPanels.includes(p);
                  return (
                    <div
                      key={`${i}-${p}`}
                      className={`note${i === current && !editMode ? " current" : ""}${isGhost ? " ghost-note" : ""}`}
                      style={{
                        left: p * laneW + (laneW - noteSize) / 2,
                        top: ev.row.beat * pxPerBeat,
                        width: noteSize,
                        height: noteSize,
                      }}
                      onClick={() => {
                        setPlaying(false);
                        if (editMode) {
                          applyViewEdit(toggleNote(viewCompact, ev.row.measure, ev.row.idx, ev.row.total, p));
                        } else {
                          go(i);
                        }
                      }}
                    >
                      {isGhost ? (
                        // 空打ち: 破線の白抜き矢印 (判定のないゴーストノーツ)
                        <svg
                          viewBox={ARROW_VIEWBOX}
                          width={noteSize}
                          height={noteSize}
                          style={{ transform: `rotate(${ARROW_ROTATIONS[p]}deg)` }}
                        >
                          <path
                            d={ARROW_PATH}
                            fill="rgba(46, 204, 113, 0.12)"
                            stroke="#7ce8a9"
                            strokeWidth={3.5}
                            strokeDasharray="7 5"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <Arrow
                          size={noteSize}
                          rotation={ARROW_ROTATIONS[p]}
                          color={QUANT_COLORS[ev.row.quant] ?? "#9aa3b5"}
                        />
                      )}
                      {foot && (
                        <span
                          className={`foot-badge${hasOverride ? " pinned" : ""}`}
                          style={{ background: FOOT_COLORS[foot] }}
                        >
                          {foot}
                        </span>
                      )}
                      {step.crossover && step.feet[p] && !step.jump && (
                        <span className="note-flag flag-cross">{S.flagCross}</span>
                      )}
                      {step.jack && <span className="note-flag flag-jack">{S.flagJack}</span>}
                      {step.doubleStep && (
                        <span className="note-flag flag-ds">{S.flagSwitch}</span>
                      )}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        </div>

        <div className="side-pane">
          <div className="card pad-card">
            <FootStage
              leftPos={footStep?.leftPos ?? 0}
              rightPos={footStep?.rightPos ?? 3}
              stepping={
                curStep?.shock && curStep.ghost ? [4] : curEvent?.panels ?? []
              }
              feet={curStep?.feet ?? [null, null, null, null]}
              facing={footStep?.facing ?? facing}
              stepKey={current}
              heldFeet={footStep?.heldFeet ?? []}
              oneFoot={stageOneFoot}
              liftedFoot={footStep?.liftedFoot ?? null}
            />
            <div className="controls">
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(0);
                  beatRef.current = 0;
                }}
                title={S.toStartTitle}
              >
                {"⏮︎"}
              </button>
              <button
                onClick={() => {
                  if (!playing) {
                    if (current >= footsteps.length - 1) {
                      go(0);
                      beatRef.current = 0;
                    } else if (curEvent) {
                      beatRef.current = curEvent.row.beat;
                    }
                  }
                  togglePlay();
                }}
                title={S.playTitle}
              >
                {playing ? "⏸︎" : "▶︎"}
              </button>
              <select
                value={speed}
                onChange={(e) => {
                  setSpeed(Number(e.target.value));
                  setDirty(true);
                }}
              >
                {SPEED_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <button
                className={muted ? "secondary" : ""}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  if (!next && playing) {
                    // 再生中のミュート解除: ジェスチャ文脈でトラックを開始
                    const el = prepareClapTrack();
                    if (el) {
                      try {
                        el.currentTime = timeRef.current / speed;
                      } catch {
                        /* 未ロードなら再生側で追従 */
                      }
                      void el.play().catch(() => {});
                    }
                  }
                  if (next) clapTrackRef.current?.el.pause();
                }}
                title={S.clapTitle}
              >
                {muted ? "🔇" : "👏"}
              </button>
              {(chart.events.some((e) => e.ghostPanels.length > 0) ||
                footsteps.some((s) => s.shock && s.ghost)) && (
                <button
                  className={ghostSound ? "" : "secondary"}
                  onClick={() => {
                    setGhostSound(!ghostSound);
                    // トラックはキー違いで次回prepare時に作り直される。
                    // 再生中は再生effectがprepareし直して続きから鳴る
                    clapTrackRef.current?.el.pause();
                  }}
                  title={S.stompTitle}
                >
                  ◇{ghostSound ? "♪" : "🔇"}
                </button>
              )}
              <button
                className="secondary"
                onClick={enterFs}
                title={S.fsTitle}
              >
                ⛶
              </button>
            </div>
            <div className="controls nav-controls">
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(current - 1);
                }}
              >
                {S.prev}
              </button>
              <span className="pos">
                {footsteps.length > 0 ? current + 1 : 0} / {footsteps.length}
              </span>
              <button
                className="secondary"
                onClick={() => {
                  setPlaying(false);
                  go(current + 1);
                }}
              >
                {S.next}
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, footsteps.length - 1)}
              value={current}
              onChange={(e) => {
                setPlaying(false);
                go(Number(e.target.value));
              }}
            />
            {curEvent && curStep && (
              <div className="event-info">
                <div>
                  {S.measureLabel(curEvent.row.measure + 1)} —{" "}
                  {curEvent.shock
                    ? S.shockArrow
                    : curEvent.panels
                        .map(
                          (p) =>
                            `${["←", "↓", "↑", "→"][p]}${
                              curStep.feet[p] === "L" ? S.footL : curStep.feet[p] === "R" ? S.footR : ""
                            }`
                        )
                        .join(" ")}
                  {facing !== 0 && (
                    <span className="facing-label">
                      {" "}
                      {S.facingLabel(facing > 0 ? "R" : "L", Math.abs(facing))}
                    </span>
                  )}
                  {hasSofran && (
                    <span className="cur-bpm"> ♩={+bpmAtBeat(bpms, curEvent.row.beat).toFixed(1)}</span>
                  )}
                </div>
                {curEvent.panels.length === 2 && (
                  <div className="override-row">
                    <span className="override-label">{S.stepFootLabel}</span>
                    {(["L", "R"] as const).map((opt) => {
                      const [a, b] = curEvent.panels;
                      const arrows = ["←", "↓", "↑", "→"];
                      return (
                        <button
                          key={opt}
                          className={`ov-btn${curOverride === opt ? " active" : ""}`}
                          onClick={() => setOverride(curOverride === opt ? null : opt)}
                        >
                          {arrows[a]}
                          <span style={{ color: opt === "L" ? "var(--foot-l)" : "var(--foot-r)" }}>
                            {opt}
                          </span>
                          ・{arrows[b]}
                          <span style={{ color: opt === "L" ? "var(--foot-r)" : "var(--foot-l)" }}>
                            {opt === "L" ? "R" : "L"}
                          </span>
                        </button>
                      );
                    })}
                    {/* 2枚抜き: 隣接する2パネル (横+縦) だけ片足でまとめて踏める */}
                    {(curEvent.panels[0] === 0 || curEvent.panels[0] === 3) !==
                      (curEvent.panels[1] === 0 || curEvent.panels[1] === 3) &&
                      (["LL", "RR"] as const).map((opt) => (
                        <button
                          key={opt}
                          className={`ov-btn${curOverride === opt ? " active" : ""}`}
                          onClick={() => setOverride(curOverride === opt ? null : opt)}
                        >
                          <span
                            style={{
                              color: opt === "LL" ? "var(--foot-l)" : "var(--foot-r)",
                            }}
                          >
                            {opt === "LL" ? "L" : "R"}
                          </span>
                          {S.bracketWith(opt === "LL" ? "L" : "R")}
                        </button>
                      ))}
                    {curOverride && (
                      <button className="ov-btn" onClick={() => setOverride(null)}>
                        {S.resetAuto}
                      </button>
                    )}
                  </div>
                )}
                {curEvent.shock && (
                  <div className="override-row">
                    <span className="override-label">{S.handlingLabel}</span>
                    {(
                      [
                        ["C", S.centerBoth],
                        ["CL", S.centerL],
                        ["CR", S.centerR],
                      ] as [FootOverride, string][]
                    ).map(([opt, label]) => (
                      <button
                        key={opt}
                        className={`ov-btn${curOverride === opt ? " active" : ""}`}
                        onClick={() => setOverride(curOverride === opt ? null : opt)}
                      >
                        ◇{label}
                      </button>
                    ))}
                    {curOverride && (
                      <button className="ov-btn" onClick={() => setOverride(null)}>
                        {S.resetIgnore}
                      </button>
                    )}
                  </div>
                )}
                {curEvent.panels.length === 1 && (
                  <div className="override-row">
                    <span className="override-label">{S.stepFootLabel}</span>
                    <button
                      className={`ov-btn foot-l${curOverride === "L" ? " active-l" : ""}`}
                      onClick={() => setOverride(curOverride === "L" ? null : "L")}
                    >
                      {S.footLBtn}
                    </button>
                    <button
                      className={`ov-btn foot-r${curOverride === "R" ? " active-r" : ""}`}
                      onClick={() => setOverride(curOverride === "R" ? null : "R")}
                    >
                      {S.footRBtn}
                    </button>
                    {curOverride && (
                      <button className="ov-btn" onClick={() => setOverride(null)}>
                        {S.resetAuto}
                      </button>
                    )}
                  </div>
                )}
                <div className="tags">
                  {curStep.shock && (
                    <span className="tag shocktag">
                      {curStep.ghost ? S.tagShockGhost : S.tagShockIgnore}
                    </span>
                  )}
                  {curStep.ghost && !curStep.shock && (
                    <span className="tag ghostswap">
                      {chart.holds.some(
                        (h) =>
                          curEvent.ghostPanels.includes(h.panel) &&
                          curEvent.row.beat > h.startBeat + 1e-6 &&
                          curEvent.row.beat <= h.endBeat + 1e-6
                      )
                        ? S.tagGhostSwap
                        : S.tagGhostReposition}
                    </span>
                  )}
                  {curStep.stretch && <span className="tag onefoot">{S.tagBracket}</span>}
                  {curStep.jump && !curStep.oneFootJump && <span className="tag jump">{S.tagJump}</span>}
                  {curStep.jack && <span className="tag jack">{S.tagJack}</span>}
                  {curStep.crossover && (
                    <span className="tag crossover">{S.tagCrossover}</span>
                  )}
                  {curStep.doubleStep && (
                    <span className="tag ds">{S.tagFootswitch}</span>
                  )}
                  {curStep.heldFeet.length > 0 && (
                    <span className="tag hold">
                      {S.holding}{" "}
                      {curStep.heldFeet.map((f) => (f === "L" ? S.footL : S.footR)).join("・")}
                    </span>
                  )}
                </div>
              </div>
            )}
            {overrides.size > 0 && (
              <div className="override-summary">
                {S.overrideCount(overrides.size)}
                <button className="ov-btn" onClick={() => { setOverrides(new Map()); setDirty(true); }}>
                  {S.clearAll}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== パネル見出し (?アイコンで説明をトグル表示) =====

function PanelHead({
  title,
  helpTitle,
  children,
}: {
  title: string;
  helpTitle?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      <button
        className={`help-btn${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-label={helpTitle ?? "Help"}
        type="button"
      >
        ?
      </button>
      {open && <p className="hint panel-help-text">{children}</p>}
    </div>
  );
}

// ===== テキスト入力パネル =====

function TextImport({
  compact,
  S,
  onApply,
}: {
  compact: string;
  S: Strings;
  onApply: (next: string, timing?: { b?: string; s?: string }, smTitle?: string) => void;
}) {
  const [text, setText] = useState(() =>
    compact
      .split("-")
      .map((m) => (m.match(/.{4}/g) ?? []).join("\n"))
      .join("\n,\n")
  );
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [choices, setChoices] = useState<SmChartInfo[] | null>(null);
  const [excluded, setExcluded] = useState(0);

  // 選んだ譜面 (またはテキスト全体) を読み込む。
  // タイミングはSSCの譜面別定義があればそれを優先し、なければファイル全体から。
  // タイトルは常にファイル全体から
  const applyChart = (noteText: string, full: string, timingText?: string) => {
    try {
      const result = normalizeNotesInput(noteText);
      if (result.warning) setWarning(result.warning);
      const globalTiming = extractTimingFromSM(full);
      const chartTiming = timingText ? extractTimingFromSM(timingText) : {};
      // SM/SSCファイル全体の取り込みなら曲が変わったとみなし、
      // 停止がファイルに無ければ前の曲の停止を残さずクリアする ("" = クリア)。
      // ノーツ断片だけの貼り付けではタイミングに触らない
      const isFullFile = /#NOTES\s*:/i.test(full);
      const timing = {
        b: chartTiming.b ?? globalTiming.b,
        s: chartTiming.s ?? globalTiming.s ?? (isFullFile ? "" : undefined),
      };
      const tm = full.match(/#TITLE\s*:\s*([^;]*);/i);
      const smTitle = tm ? tm[1].trim() : undefined;
      onApply(result.compact, timing, smTitle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const apply = (src?: string) => {
    const body = src ?? text;
    setError(null);
    setWarning(null);
    setChoices(null);
    setExcluded(0);
    const charts = listSmCharts(body);
    if (charts.length > 1) {
      // 複数譜面入りのファイル: シングルだけ列挙して選ばせる
      const singles = charts.filter((c) => !/double|couple|routine/i.test(c.type));
      setExcluded(charts.length - singles.length);
      if (singles.length === 0) {
        setError(S.noSingleCharts);
        return;
      }
      if (singles.length === 1) {
        applyChart(singles[0].notes, body, singles[0].timingText);
        return;
      }
      setChoices(singles);
      return;
    }
    applyChart(body, body);
  };

  // WebにホストされたSM/SSCファイルをURLから取得してテキスト欄に流し込む
  const fetchFromUrl = async () => {
    const u = url.trim();
    if (!u) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setChoices(null);
    try {
      const res = await fetch(`/api/sm?url=${encodeURIComponent(u)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? `取得に失敗しました (HTTP ${res.status})`);
        return;
      }
      setText(data.text);
      apply(data.text);
    } catch {
      setError(S.fetchFailed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card text-import">
      <PanelHead title={S.textPanelTitle} helpTitle={S.helpTitle}>{S.textPanelDesc}</PanelHead>
      <div className="form-row url-import-row">
        <input
          type="url"
          className="url-input"
          value={url}
          placeholder={S.urlPlaceholder}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") fetchFromUrl();
          }}
          spellCheck={false}
        />
        <button className="secondary" onClick={fetchFromUrl} disabled={loading || !url.trim()}>
          {loading ? S.loading : S.loadFromUrl}
        </button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <div className="form-row">
        <button onClick={() => apply()}>{S.loadText}</button>
      </div>
      {choices && (
        <div className="chart-choices">
          <p className="hint" style={{ flexBasis: "100%" }}>
            {S.multiCharts(excluded)}
          </p>
          {choices.map((c, i) => (
            <button
              key={i}
              className="secondary"
              onClick={() => applyChart(c.notes, text, c.timingText)}
            >
              {c.difficulty || S.chartFallback(i + 1)}
              {c.meter && ` (${c.meter})`}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
    </div>
  );
}

// ===== 3Dフットステージ =====

// 3x3グリッド上のパネル中心座標 (単位: セル)
const STAGE_CENTERS = [
  { x: 0.5, y: 1.5 },
  { x: 1.5, y: 2.5 },
  { x: 1.5, y: 0.5 },
  { x: 2.5, y: 1.5 },
  { x: 1.5, y: 1.5 }, // 4 = 中央 (ショックの中央空打ち)
];

const STAGE_LAYOUT: (number | null)[][] = [
  [null, 2, null],
  [0, null, 3],
  [null, 1, null],
];

function FootStage({
  leftPos,
  rightPos,
  stepping,
  feet,
  facing,
  stepKey,
  heldFeet,
  oneFoot,
  liftedFoot,
}: {
  leftPos: number;
  rightPos: number;
  stepping: number[];
  feet: (Foot | null)[];
  facing: number;
  stepKey: number;
  heldFeet: Foot[];
  oneFoot: { foot: Foot; panels: number[] } | null;
  liftedFoot: Foot | null;
}) {
  const same = leftPos === rightPos && !liftedFoot;
  // facing はアルゴリズムが追跡している連続回転角なのでそのまま使える
  const rot = facing;
  const lc = STAGE_CENTERS[leftPos];
  const rc = STAGE_CENTERS[rightPos];
  let lx = lc.x + (same ? -0.22 : 0);
  let ly = lc.y;
  let rx = rc.x + (same ? 0.22 : 0);
  let ry = rc.y;
  // 2枚抜き: 踏んでいる足は2パネルの中間 (角) に置き、
  // 2パネルを結ぶ対角線に沿った絶対角度 (±45°) で表示する。
  // パネルの組み合わせで足の向きは物理的に決まるため、体の向きは合成しない
  let lRot = rot;
  let rRot = rot;
  if (oneFoot) {
    const c1 = STAGE_CENTERS[oneFoot.panels[0]];
    const c2 = STAGE_CENTERS[oneFoot.panels[1]];
    const mx = (c1.x + c2.x) / 2;
    const my = (c1.y + c2.y) / 2;
    // 対角線の向き (0°=上向き)。つま先が上半分を向く側に正規化
    let tilt = (Math.atan2(c2.x - c1.x, c1.y - c2.y) * 180) / Math.PI;
    if (tilt > 90) tilt -= 180;
    if (tilt < -90) tilt += 180;
    if (oneFoot.foot === "L") {
      lx = mx;
      ly = my;
      lRot = tilt;
    } else {
      rx = mx;
      ry = my;
      rRot = tilt;
    }
  }

  // 持ち替えで解放された足は、次に踏むまで中央 (ニュートラル位置) に浮かせる
  if (liftedFoot === "L") {
    lx = 1.5 - 0.28;
    ly = 1.5;
  } else if (liftedFoot === "R") {
    rx = 1.5 + 0.28;
    ry = 1.5;
  }
  const midX = (STAGE_CENTERS[leftPos].x + STAGE_CENTERS[rightPos].x) / 2;
  const midY = (STAGE_CENTERS[leftPos].y + STAGE_CENTERS[rightPos].y) / 2;
  const lStepping =
    (stepping.includes(leftPos) && (leftPos === 4 || feet[leftPos] === "L")) ||
    oneFoot?.foot === "L";
  const rStepping =
    (stepping.includes(rightPos) && (rightPos === 4 || feet[rightPos] === "R")) ||
    oneFoot?.foot === "R";

  return (
    <div className="stage3d">
      <div className="scene">
        <div className="floor">
          {STAGE_LAYOUT.flat().map((panel, i) => {
            if (panel === null) return <div key={i} className="floor-cell" />;
            const isStepping = stepping.includes(panel);
            const f = feet[panel];
            const cls = isStepping
              ? f === "L"
                ? " active-L"
                : f === "R"
                ? " active-R"
                : " active-LR"
              : "";
            return (
              <div key={i} className={`floor-cell floor-panel${cls}`}>
                <span className="pad-arrow">
                  <Arrow size={30} rotation={ARROW_ROTATIONS[panel]} color="#5a6390" detail={false} />
                </span>
              </div>
            );
          })}

          {/* 体の向きインジケータ (両足の中間に表示) */}
          <div
            className="facing-marker"
            style={{
              left: `${(midX / 3) * 100}%`,
              top: `${(midY / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            }}
          >
            ▲
          </div>

          {/* 足 */}
          <div
            className={`foot3d${liftedFoot === "L" ? " lifted" : ""}`}
            style={{
              left: `${(lx / 3) * 100}%`,
              top: `${(ly / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${lRot}deg)`,
            }}
          >
            <div className="foot3d-shadow" />
            <div
              key={lStepping ? `s${stepKey}` : "idle"}
              className={`foot3d-body${lStepping ? " hop" : ""}${heldFeet.includes("L") ? " held" : ""}`}
              style={{ background: FOOT_COLORS.L }}
            >
              L
            </div>
          </div>
          <div
            className={`foot3d${liftedFoot === "R" ? " lifted" : ""}`}
            style={{
              left: `${(rx / 3) * 100}%`,
              top: `${(ry / 3) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${rRot}deg)`,
            }}
          >
            <div className="foot3d-shadow" />
            <div
              key={rStepping ? `s${stepKey}` : "idle"}
              className={`foot3d-body${rStepping ? " hop" : ""}${heldFeet.includes("R") ? " held" : ""}`}
              style={{ background: FOOT_COLORS.R }}
            >
              R
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
