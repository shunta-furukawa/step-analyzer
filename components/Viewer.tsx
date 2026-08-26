"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_ROTATIONS,
  FOOT_COLORS,
  MAX_MEASURES,
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
import {
  JudgeSession,
  buildJudgeTargets,
  type Judgment,
  type JudgeResult,
} from "@/lib/judge";
import {
  computeChartImageLayout,
  filterCommentsForRange,
  measureChartComments,
  renderChartImage,
} from "@/lib/chartImage";
import {
  loadAudioFromUrl,
  loadImageFromUrl,
  recordChartVideo,
  renderVideoThumbnail,
} from "@/lib/videoExport";

// Three.js版の足ステージ (WebGL)。バンドルを分けるため遅延読み込みし、
// ロード中と非対応環境はCSS版FootStageで表示する
const FootStage3D = dynamic(() => import("./FootStage3D"), { ssr: false });
import { buildClipData } from "@/lib/clip";
import { compressCompact } from "@/lib/codec";
import {
  appendMeasures,
  clearBeats,
  copyBeats,
  parseComments,
  parseHighlights,
  parseOverrides,
  pasteBeats,
  placeHoldRange,
  serializeComments,
  serializeHighlights,
  serializeOverrides,
  toggleNote,
  toggleShock,
  type BeatClip,
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
import { detectSpotlights } from "@/lib/spotlight";
import { listSmCharts, normalizeNotesInput, type SmChartInfo } from "@/lib/url";
import {
  DIFF_COLORS,
  FOOT_BLOBS,
  diffClassFromSm,
  diffLevelFromSm,
  isFootCircle,
  parseDiffParam,
  serializeDiff,
} from "@/lib/difficulty";
import { ARROW_PATH, ARROW_VIEWBOX } from "@/lib/arrowShape";
import Arrow from "./Arrow";

const EDIT_RESOLUTIONS = [4, 8, 12, 16, 24, 32];
// ハイスピは0.05刻みの自由値 (0.25〜6)。URL値も丸めて取り込む
const HS_MIN = 0.25;
const HS_MAX = 6;
function clampHs(n: number): number {
  return Math.min(HS_MAX, Math.max(HS_MIN, Math.round(n * 20) / 20));
}
const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1];

// プレイモードの判定表示文字 (言語によらずDDR風の英語表記)
const PM_JUDGE_TEXT: Record<Judgment, string> = {
  marvelous: "MARVELOUS!!",
  perfect: "PERFECT!",
  great: "GREAT",
  good: "GOOD",
  miss: "MISS…",
};

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
// ジャスト到着狙いだとReactの状態反映ラグ (1〜2フレーム) ぶん着地が
// 遅れて「パネルが光ったのにまだ乗っていない」ように見えるため、
// ラグ相当だけ早めに着地させる余裕 (実時間)。大きくしすぎると
// 「移動してから音が鳴る」ように見えるので、ラグの打ち消しに留める
const FOOT_EARLY_SEC = 0.04;

// 背景色のデフォルト (DDR WORLDミントグリーン)
const DEFAULT_BG = "29d6a2";

// 難易度クラスの足あとアイコン (色のみで区分を表現)
function DiffFootIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {FOOT_BLOBS.map((b, i) =>
        isFootCircle(b) ? (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={color} />
        ) : (
          <ellipse
            key={i}
            cx={b.cx}
            cy={b.cy}
            rx={b.rx}
            ry={b.ry}
            transform={`rotate(${(b.rot * 180) / Math.PI} ${b.cx} ${b.cy})`}
            fill={color}
          />
        )
      )}
    </svg>
  );
}

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
  subtitle: initialSubtitle,
  difficulty: initialDifficulty,
  bpm: initialBpm,
  stops: initialStops,
  overrides: initialOverrides,
  highlights: initialHighlights,
  comments: initialComments,
  hispeed: initialHispeed,
  speed: initialSpeed,
  bg: initialBg,
  lang: initialLang,
  transform: initialTransform,
}: {
  compact: string;
  title?: string;
  subtitle?: string;
  difficulty?: string;
  bpm?: string;
  stops?: string;
  overrides?: string;
  highlights?: string;
  comments?: string;
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

  // 左端ゾーンのタップによる範囲選択 (4分=1拍単位)。
  // aだけの状態=始点選択中、bが入ると確定 (上下逆でも正規化する)
  const [rangeSel, setRangeSel] = useState<{ a: number; b: number | null } | null>(
    null
  );
  // 拍単位の確定範囲 (両端inclusive)。編集の範囲操作に使う
  const selBeats =
    rangeSel && rangeSel.b !== null
      ? {
          start: Math.min(rangeSel.a, rangeSel.b),
          end: Math.max(rangeSel.a, rangeSel.b),
        }
      : null;
  // 小節単位へ丸めた範囲 (共有クリップ・画像書き出しのデフォルト)
  const selRange = selBeats
    ? {
        start: Math.floor(selBeats.start / 4) + 1,
        end: Math.floor(selBeats.end / 4) + 1,
      }
    : null;
  const tapBeatZone = (beat: number) => {
    if (!rangeSel || rangeSel.b !== null) {
      // 未選択、または確定済み → その拍を新しい始点に
      setRangeSel({ a: beat, b: null });
      return;
    }
    if (rangeSel.a === beat) {
      setRangeSel(null);
      return;
    }
    setRangeSel({ a: rangeSel.a, b: beat });
  };
  // 「小節目.拍目」の表示ラベル
  const fmtBeat = (beat: number) => `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;

  // 範囲編集用のコピーバッファ (セッション内のみ)
  const [beatClip, setBeatClip] = useState<BeatClip | null>(null);

  // 画像書き出しモーダル (クリップと同じ「検証はblur/実行時のみ」方式)
  const [showImage, setShowImage] = useState(false);
  const [imgStart, setImgStart] = useState("1");
  const [imgEnd, setImgEnd] = useState("1");
  // 1列に描く小節数 (長すぎる値は書き出し時にクランプ)
  const [imgPerCol, setImgPerCol] = useState("16");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgDone, setImgDone] = useState(false);
  const [imgError, setImgError] = useState(false);

  // 動画書き出しモーダル
  const [showVideo, setShowVideo] = useState(false);
  const [vTplCopied, setVTplCopied] = useState(false);
  // 動画の向き: 縦=ショート (等速) / 横=じっくり観察用 (0.5倍速が既定)
  const [vMode, setVMode] = useState<"portrait" | "landscape">("portrait");
  // 横長の収録速度 (0.5=じっくり / 1=等倍)
  const [vLandSpeed, setVLandSpeed] = useState<0.5 | 1>(0.5);
  // 番組構成 (OP予告・解説リプレイ・EDまとめ)。OFFで素の横動画
  const [vProgram, setVProgram] = useState(true);
  // 自動解説の量 (検出スコアの閾値を変える)
  const [vSpotAmount, setVSpotAmount] = useState<"few" | "normal" | "many">("normal");
  const [vUseMedia, setVUseMedia] = useState(false);
  const [vOgg, setVOgg] = useState("");
  const [vJacket, setVJacket] = useState("");
  const [vOffset, setVOffset] = useState("0");
  const [vBusy, setVBusy] = useState(false);
  const [vProgress, setVProgress] = useState(0);
  const [vError, setVError] = useState<string | null>(null);
  const [vDone, setVDone] = useState(false);
  // サムネ画像書き出し (横動画用。YouTubeのカスタムサムネは別画像が必要)
  const [vThumbBusy, setVThumbBusy] = useState(false);
  const [vThumbDone, setVThumbDone] = useState(false);
  const vSignal = useRef({ cancelled: false });

  // WebGLが使えるかどうか (不可ならCSS版FootStageにフォールバック)
  const [webglOk] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return false;
    }
  });

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
  // サブキャプション (アーティスト名など)。SM取り込みで#ARTISTから自動設定される
  const [subtitle, setSubtitle] = useState(initialSubtitle ?? "");
  // 難易度 (5段階クラス + 1-20レベル)。SM取り込みで自動設定される
  const initDiff = parseDiffParam(initialDifficulty);
  const [diffCls, setDiffCls] = useState<number | null>(initDiff.cls);
  const [diffLvl, setDiffLvl] = useState(initDiff.lvl);
  const [bpm, setBpm] = useState(() => normalizeParam(initialBpm ?? ""));
  const [stops, setStops] = useState(() => normalizeParam(initialStops ?? ""));
  const [showTiming, setShowTiming] = useState(false);
  const [overrides, setOverrides] = useState<Map<number, FootOverride>>(() =>
    parseOverrides(initialOverrides)
  );
  // 注目ノーツ (hl=)。「ここを見て!」と共有したいノーツのtick集合
  const [highlights, setHighlights] = useState<Set<number>>(() =>
    parseHighlights(initialHighlights)
  );
  // 注目ノーツのコメント (hc=)。横長動画の注目シーンで表示する
  const [noteComments, setNoteComments] = useState<Map<number, string>>(() =>
    parseComments(initialComments)
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
  const [hispeed, setHispeed] = useState(() => {
    const n = Number(initialHispeed);
    return Number.isFinite(n) && n > 0 ? clampHs(n) : 1;
  });
  // 入力途中の "1." などを許すため表示用テキストは別に持つ
  const [hsText, setHsText] = useState(() => String(hispeed));
  const [muted, setMuted] = useState(false);
  const [ghostSound, setGhostSound] = useState(true); // 空打ちのストンプ音
  // 足の軌跡 (トレイル) 表示。密度で濃さが変わり速さが見えるためデフォルトON
  const [footTrail, setFootTrail] = useState(true);
  // テーマカラー。単色 "rrggbb" または2色グラデ "rrggbb-rrggbb" (左上-右下)
  const [bgColor, setBgColor] = useState(() => {
    const m = initialBg?.match(/^([0-9a-fA-F]{6})(?:-[0-9a-fA-F]{6})?$/);
    return m ? m[1].toLowerCase() : DEFAULT_BG;
  });
  const [bgColor2, setBgColor2] = useState<string | null>(() => {
    const m = initialBg?.match(/^[0-9a-fA-F]{6}-([0-9a-fA-F]{6})$/);
    return m ? m[1].toLowerCase() : null;
  });
  // URLに載せる形 (2色目があればハイフン連結)
  const bgParam = bgColor2 ? `${bgColor}-${bgColor2}` : bgColor;
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

  // ===== プレイモード (譜面を指/矢印キーでなぞって判定) =====
  const [pm, setPm] = useState(false); // モードに入っているか
  const [pmStarted, setPmStarted] = useState(false); // カウントイン〜プレイ中
  const [pmResult, setPmResult] = useState<JudgeResult | null>(null);
  const [pmCombo, setPmCombo] = useState(0);
  const [pmPopup, setPmPopup] = useState<{ j: Judgment; k: number } | null>(null);
  const [pmCount, setPmCount] = useState(0); // カウントイン表示 (0=非表示)
  // タップパッドのフラッシュ (キー変更でCSSアニメを再生する)
  const [pmZoneFlash, setPmZoneFlash] = useState<number[]>([0, 0, 0, 0]);
  // タッチ・音声の遅延補正 (ms, 正=入力が遅れて届く端末)。端末ごとに保存
  const [pmOffsetMs, setPmOffsetMs] = useState(() => {
    try {
      const v = Number(localStorage.getItem("sa-pm-offset"));
      return Number.isFinite(v) ? Math.max(-250, Math.min(250, Math.round(v))) : 0;
    } catch {
      return 0;
    }
  });
  const [pmWide, setPmWide] = useState(() => {
    try {
      return localStorage.getItem("sa-pm-wide") === "1";
    } catch {
      return false;
    }
  });
  // 遅延キャリブレーション中 (メトロノームに合わせてタップ)
  const [pmCal, setPmCal] = useState<{ taps: number } | null>(null);
  const judgeRef = useRef<JudgeSession | null>(null);
  const pmLeadRef = useRef(0); // カウントインの長さ (曲内秒)
  const pmFreshRef = useRef(false); // スタート直後: 再生effectで-leadから始める
  const pmRef = useRef(false);
  pmRef.current = pm && pmStarted;
  const pmOffsetRef = useRef(0);
  pmOffsetRef.current = pmOffsetMs;
  const pmCalCtxRef = useRef<{ actx: AudioContext; ticks: number[]; taps: number[] } | null>(
    null
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  // fs再生時のサブピクセルスクロール用 (scrollTopは整数に量子化されるため)
  const chartInnerRef = useRef<HTMLDivElement>(null);
  // 通常表示の再生中に現在位置を示すプレイヘッド線
  const playheadRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef(0);
  const timeRef = useRef(0);
  // 仮想化: 描画するビート範囲 (画面内 + バッファ)
  const [viewBeats, setViewBeats] = useState({ a: 0, b: 120 });
  const clapTrackRef = useRef<{ key: string; el: HTMLAudioElement; url: string } | null>(
    null
  );
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // 背景色をページ全体とブラウザUI (theme-color) に反映。
  // 2色目がないときは同色を入れてグラデを実質単色にする
  useEffect(() => {
    document.documentElement.style.setProperty("--page-bg", `#${bgColor}`);
    document.documentElement.style.setProperty("--page-bg2", `#${bgColor2 ?? bgColor}`);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", `#${bgColor}`);
  }, [bgColor, bgColor2]);

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
  const noteSize = fs || pm ? fsLane - 10 : narrow ? 28 : 40;
  // 1拍の高さは矢印サイズの1.8倍 (通常表示・フルスクリーン・画像書き出しで統一)
  const pxPerBeat = (fs || pm ? noteSize * 1.8 : narrow ? 52 : 72) * hispeed;
  const laneW = fs || pm ? fsLane : narrow ? 36 : 52;

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

  // 注目ノーツの枠: 連続する注目ノーツは1つの角丸枠にまとめる
  const highlightBoxes = useMemo(() => {
    if (!chart || highlights.size === 0) return [];
    const boxes: { start: number; end: number; pMin: number; pMax: number }[] = [];
    let lastMarkedIdx = -2;
    chart.events.forEach((ev, i) => {
      const marked =
        !ev.shock && ev.panels.length > 0 && highlights.has(tickOf(ev.row.beat));
      if (!marked) return;
      const pMin = Math.min(...ev.panels);
      const pMax = Math.max(...ev.panels);
      if (lastMarkedIdx === i - 1 && boxes.length > 0) {
        const b = boxes[boxes.length - 1];
        b.end = ev.row.beat;
        b.pMin = Math.min(b.pMin, pMin);
        b.pMax = Math.max(b.pMax, pMax);
      } else {
        boxes.push({ start: ev.row.beat, end: ev.row.beat, pMin, pMax });
      }
      lastMarkedIdx = i;
    });
    return boxes;
  }, [chart, highlights]);

  // ソフラン・停止のタイミングデータ
  const bpms = useMemo(() => parseBpmParam(bpm), [bpm]);
  const stopList = useMemo(() => parseStopsParam(stops), [stops]);
  const timeline = useMemo(
    () => (chart ? buildTimeline(bpms, stopList, chart.totalBeats) : []),
    [chart, bpms, stopList]
  );
  const hasSofran = bpms.length > 1 || stopList.length > 0;

  // 横動画の自動解説を事前計算 (モーダルに件数・対象小節・追加時間を表示)
  const autoSpots = useMemo(() => {
    if (!chart || footsteps.length === 0 || timeline.length === 0) return [];
    const minScore = vSpotAmount === "few" ? 6 : vSpotAmount === "many" ? 3 : 4;
    return detectSpotlights(chart, footsteps, timeline, Infinity, minScore);
  }, [chart, footsteps, timeline, vSpotAmount]);

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
    if (subtitle) parts.push(`st=${encodeURIComponent(subtitle)}`);
    const df = serializeDiff(diffCls, diffLvl);
    if (df) parts.push(`df=${df}`);
    if (bpm) parts.push(`b=${enc(bpm)}`);
    if (stops) parts.push(`s=${enc(stops)}`);
    if (overrides.size > 0) parts.push(`f=${serializeOverrides(overrides)}`);
    if (highlights.size > 0) parts.push(`hl=${serializeHighlights(highlights)}`);
    const hc = serializeComments(noteComments);
    if (hc) parts.push(`hc=${hc}`);
    if (hispeed !== 1) parts.push(`hs=${hispeed}`);
    if (speed !== 1) parts.push(`sp=${speed}`);
    if (bgParam !== DEFAULT_BG) parts.push(`c=${bgParam}`);
    if (lang !== "ja") parts.push(`l=${lang}`);
    if (transform) parts.push(`tr=${transform}`);
    return `/?${parts.join("&")}`;
  }, [compact, title, subtitle, diffCls, diffLvl, bpm, stops, overrides, highlights, noteComments, hispeed, speed, bgParam, lang, transform]);

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
    // プレイモードはメトロノーム強制ON + 4拍のカウントインを頭に足す
    const metroOn = pm;
    const beat1 = Math.max(0.15, timeAtBeat(timeline, 1) - timeAtBeat(timeline, 0));
    const lead = pm ? beat1 * 4 : 0;
    pmLeadRef.current = lead;
    const key = `${compact}|${bpm}|${stops}|${speed}|${ghostSound ? 1 : 0}|${metroOn ? 1 : 0}|${pm ? "pm" : ""}|${serializeOverrides(overrides)}`;
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
    // リードインぶんトラック上の時刻を後ろへずらす (トラック時刻 = (曲内時刻+lead)/speed)
    const shift = lead / speed;
    const times = judged.map((e) => timeAtBeat(timeline, e.row.beat) / speed + shift);
    const accents = judged.map((e) => e.panels.length >= 2);
    const ghostTimes = ghostSound
      ? chart.events
          .filter((e, i) => e.ghostPanels.length > 0 || (e.shock && footsteps[i]?.ghost))
          .map((e) => timeAtBeat(timeline, e.row.beat) / speed + shift)
      : [];
    // メトロノーム: 4分ごとのティック (小節頭のアクセントなし)
    const metroTimes: number[] = [];
    if (pm) {
      for (let k = 0; k < 4; k++) metroTimes.push((k * beat1) / speed); // カウントイン
    }
    if (metroOn) {
      for (let b = 0; b < chart.totalBeats - 1e-9; b++) {
        metroTimes.push(timeAtBeat(timeline, b) / speed + shift);
      }
    }
    const url = buildClapTrackUrl(
      times,
      accents,
      timeAtBeat(timeline, chart.totalBeats) / speed + shift,
      ghostTimes,
      metroTimes
    );
    const el = new Audio(url);
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    clapTrackRef.current = { key, el, url };
    return el;
  }, [chart, timeline, compact, bpm, stops, speed, ghostSound, pm, overrides, footsteps]);

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

  // ===== プレイモード =====
  // 遅延キャリブレーション: メトロノームに合わせて8回タップ→中央値を補正値に
  const stopPmCal = useCallback(() => {
    const c = pmCalCtxRef.current;
    if (c) {
      void c.actx.close().catch(() => {});
      pmCalCtxRef.current = null;
    }
    setPmCal(null);
  }, []);

  const startPmCal = useCallback(() => {
    stopPmCal();
    try {
      const actx = new AudioContext();
      const ticks: number[] = [];
      const t0 = actx.currentTime + 0.8;
      for (let k = 0; k < 32; k++) {
        const t = t0 + k * 0.5; // 120BPM
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = "square";
        o.frequency.value = 1080;
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        o.connect(g);
        g.connect(actx.destination);
        o.start(t);
        o.stop(t + 0.08);
        ticks.push(t);
      }
      pmCalCtxRef.current = { actx, ticks, taps: [] };
      setPmCal({ taps: 0 });
    } catch {
      // AudioContext非対応環境では手動の±ボタンで調整してもらう
    }
  }, [stopPmCal]);

  const pmCalTap = useCallback(() => {
    const c = pmCalCtxRef.current;
    if (!c) return;
    const now = c.actx.currentTime;
    let best = Infinity;
    for (const t of c.ticks) {
      const d = now - t;
      if (Math.abs(d) < Math.abs(best)) best = d;
    }
    if (!Number.isFinite(best) || Math.abs(best) > 0.25) return; // ティックから遠すぎ
    c.taps.push(best * 1000);
    setPmCal({ taps: c.taps.length });
    if (c.taps.length >= 8) {
      // 最初の1タップはリズムを掴む前なので捨てて中央値を取る
      const arr = [...c.taps.slice(1)].sort((a, b) => a - b);
      const med = Math.round(arr[Math.floor(arr.length / 2)]);
      const v = Math.max(-250, Math.min(250, med));
      setPmOffsetMs(v);
      try {
        localStorage.setItem("sa-pm-offset", String(v));
      } catch {
        /* プライベートモード等では保存しない */
      }
      stopPmCal();
    }
  }, [stopPmCal]);

  const setPmOffsetSaved = useCallback((v: number) => {
    const c = Math.max(-250, Math.min(250, Math.round(v)));
    setPmOffsetMs(c);
    try {
      localStorage.setItem("sa-pm-offset", String(c));
    } catch {
      /* noop */
    }
  }, []);

  const setPmWideSaved = useCallback((v: boolean) => {
    setPmWide(v);
    try {
      localStorage.setItem("sa-pm-wide", v ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const enterPm = useCallback(() => {
    setEditMode(false);
    setShowText(false);
    setShowTiming(false);
    setPlaying(false);
    setPmResult(null);
    setPmCombo(0);
    setPmPopup(null);
    setPmCount(0);
    go(0);
    beatRef.current = 0;
    setPm(true);
    try {
      void document.documentElement.requestFullscreen?.();
    } catch {
      /* iOS Safariなどは非対応でOK */
    }
  }, [go]);

  const exitPm = useCallback(() => {
    stopPmCal();
    setPm(false);
    setPmStarted(false);
    setPmResult(null);
    setPlaying(false);
    judgeRef.current = null;
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* noop */
    }
  }, [stopPmCal]);

  // プレイ開始 (ユーザー操作の文脈で呼ぶ: 音声の再生許可が必要)
  const startPm = useCallback(() => {
    if (!chart || timeline.length === 0) return;
    stopPmCal();
    const { targets, shocks } = buildJudgeTargets(chart, timeline);
    judgeRef.current = new JudgeSession(targets, shocks, speed, pmWide);
    setPmResult(null);
    setPmCombo(0);
    setPmPopup(null);
    go(0);
    beatRef.current = 0;
    pmFreshRef.current = true;
    setPmStarted(true);
    setPlaying(true);
  }, [chart, timeline, speed, pmWide, go, stopPmCal]);

  // タップ/キー入力 → 判定。判定ポップとコンボ表示を更新する
  const pmTap = useCallback(
    (panel: number) => {
      if (!pmRef.current || !judgeRef.current) return;
      setPmZoneFlash((z) => {
        const n = [...z];
        n[panel]++;
        return n;
      });
      const el = clapTrackRef.current?.el;
      const t =
        el && !el.paused && el.readyState >= 2
          ? el.currentTime * speed - pmLeadRef.current
          : timeRef.current;
      if (t < -0.2) return; // カウントイン中はフラッシュのみ
      const adj = t - (pmOffsetRef.current / 1000) * speed;
      const res = judgeRef.current.hit(panel, adj);
      if (res) {
        setPmCombo(judgeRef.current.combo);
        setPmPopup({ j: res.judgment, k: performance.now() });
      }
    },
    [speed]
  );

  // モードを抜けたらキャリブレーションのAudioContextを確実に破棄
  useEffect(() => () => stopPmCal(), [stopPmCal]);

  // プレイモード中の「戻る」対策。iOS/Androidの画面端からの戻るスワイプは
  // touch-actionでは無効化できず、発動すると前のページへ遷移→復帰で
  // 強制リロード (一瞬白画面) になる。モードに入る際に同一URLの履歴を
  // 1枚積んでおくと、戻るスワイプは同一ドキュメント内のpopstateで
  // 受け止められ、ページ遷移が起きない。プレイ中は履歴を積み直して
  // 続行し、開始前/リザルト中の「戻る」はモードを閉じる操作として扱う
  useEffect(() => {
    if (!pm) return;
    try {
      history.pushState({ saPm: 1 }, "");
    } catch {
      /* noop */
    }
    const onPop = () => {
      if (pmRef.current) {
        try {
          history.pushState({ saPm: 1 }, "");
        } catch {
          /* noop */
        }
      } else {
        // イントロ・リザルト画面での戻る = モード終了
        stopPmCal();
        setPm(false);
        setPmStarted(false);
        setPmResult(null);
        setPlaying(false);
        judgeRef.current = null;
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [pm, stopPmCal]);

  // fs/プレイモード中は背面のスクロールを止め、引っ張って更新
  // (pull-to-refresh) やオーバースクロールも無効化する。
  // プレイ中の連打で下方向のドラッグが混ざるとページが再読み込み
  // されてしまうため (iOS Safari 15+/Android Chrome)
  useEffect(() => {
    const on = fs || pm;
    document.body.style.overflow = on ? "hidden" : "";
    document.body.style.overscrollBehavior = on ? "none" : "";
    document.documentElement.style.overscrollBehavior = on ? "none" : "";
    return () => {
      document.body.style.overflow = "";
      document.body.style.overscrollBehavior = "";
      document.documentElement.style.overscrollBehavior = "";
    };
  }, [fs, pm]);

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
      // プレイモード中: 矢印キーが踏み入力になる (通常のイベント送りは無効)
      if (pm) {
        const map: Record<string, number> = {
          ArrowLeft: 0,
          ArrowDown: 1,
          ArrowUp: 2,
          ArrowRight: 3,
        };
        if (e.key in map) {
          e.preventDefault();
          pmTap(map[e.key]);
        } else if (e.key === "Escape") {
          exitPm();
        } else if (e.key === " ") {
          e.preventDefault();
        }
        return;
      }
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
  }, [go, current, togglePlay, exitFs, pm, pmTap, exitPm]);

  // 自動再生: タイムライン (ソフラン・停止込み) に沿って時間基準で進行。
  // 譜面スクロール・足の動き・クラップ音をすべて時刻→拍の変換で同期する。
  useEffect(() => {
    if (!playing || !chart || timeline.length === 0) return;
    // クラップトラック: 再生中は音声側をマスタークロックにする
    // (iOSの画面収録でrAFがスロットルされても音と同期が保たれる)。
    // トラックは速度込みでレンダリング済みなので常に等速再生。
    // プレイモードは判定の基準クロックになるためミュートでも使う。
    // ※prepareClapTrackがpmLeadRefを更新するため、leadより先に呼ぶ
    const track = !mutedRef.current || pm ? prepareClapTrack() : null;
    // 現在の拍位置から時刻を復元して再開。
    // プレイモードのスタート直後はカウントイン (曲内時刻の負領域) から
    const lead = pm ? pmLeadRef.current : 0;
    timeRef.current = timeAtBeat(timeline, beatRef.current);
    if (pmFreshRef.current) {
      timeRef.current = -lead;
      pmFreshRef.current = false;
    }
    if (track) {
      if (Math.abs(track.currentTime * speed - (timeRef.current + lead)) > 0.05) {
        try {
          track.currentTime = (timeRef.current + lead) / speed;
        } catch {
          // メタデータ未ロード時は無視
        }
      }
      if (track.paused) void track.play().catch(() => {});
    }
    let raf = 0;
    let last = performance.now();
    let lastCut = -1; // --fs-cutの前回書き込み値 (量子化済みpx)
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (track && !track.paused && track.readyState >= 2) {
        timeRef.current = track.currentTime * speed - lead;
      } else {
        timeRef.current += dt * speed;
      }
      beatRef.current = beatAtTime(timeline, timeRef.current);
      if (beatRef.current >= chart.totalBeats - 1e-9) {
        beatRef.current = chart.totalBeats;
        // プレイモードは最後のノーツの判定窓が閉じるまで走らせ続ける
        if (!pmRef.current) setPlaying(false);
      }

      // ===== プレイモードの進行 (カウントイン表示・MISS掃き出し・終了) =====
      if (pmRef.current && judgeRef.current) {
        if (timeRef.current < 0) {
          const beat1 = Math.max(0.15, pmLeadRef.current / 4);
          const c = Math.min(4, Math.max(1, Math.ceil(-timeRef.current / beat1)));
          setPmCount((v) => (v !== c ? c : v));
        } else {
          setPmCount((v) => (v !== 0 ? 0 : v));
          const adj = timeRef.current - (pmOffsetRef.current / 1000) * speed;
          if (judgeRef.current.sweep(adj) > 0) {
            setPmCombo(0);
            setPmPopup({ j: "miss", k: now });
          }
        }
        const endT = timeAtBeat(timeline, chart.totalBeats) + 0.5 * speed;
        if (timeRef.current >= endT) {
          const r = judgeRef.current.results();
          judgeRef.current = null;
          setPmResult(r);
          setPmStarted(false);
          setPlaying(false);
        }
      }
      let idx = -1;
      for (let k = 0; k < chart.events.length; k++) {
        if (chart.events[k].row.beat <= beatRef.current + 1e-6) idx = k;
        else break;
      }
      if (idx >= 0) setCurrent((c) => (c !== idx ? idx : c));
      // カウントイン中 (曲内時刻が負) はまだ何も通過していない
      const pIdx = timeRef.current < 0 ? -1 : idx;
      setPlayedIdx((c) => (c !== pIdx ? pIdx : c));

      // 足の位置は移動時間ぶん先読み: ジャストの瞬間に次のパネルへ到着させる。
      // timeRefは譜面内時刻なので、実時間の先読みはspeed倍して換算する
      const leadBeat = beatAtTime(
        timeline,
        timeRef.current + (FOOT_TRAVEL_SEC + FOOT_EARLY_SEC) * speed
      );
      let fIdx = idx;
      for (let k = Math.max(0, idx); k < chart.events.length; k++) {
        if (chart.events[k].row.beat <= leadBeat + 1e-6) fIdx = k;
        else break;
      }
      if (fIdx >= 0) setFootIdx((c) => (c !== fIdx ? fIdx : c));

      const el = scrollRef.current;
      const inner = chartInnerRef.current;
      if (el) {
        if ((fs || pm) && inner) {
          // fs時はステップゾーンに現在ビートが重なるよう合わせる。
          // scrollTopは整数pxに量子化されてサブピクセルの滑らかさが出ないため、
          // GPU合成されるtransformで小数px単位の追従をする (目の疲れ対策)
          const offset = beatRef.current * pxPerBeat + noteSize / 2 - RECEPTOR_Y;
          inner.style.transform = `translate3d(0, ${-offset}px, 0)`;
          // フリーズバーを受け皿の中心 (判定線) で消費させるための現在位置。
          // CSS変数の毎フレーム更新は依存する全フリーズバーの再描画を
          // 誘発するため、16px単位に量子化して書き込み頻度を下げる
          // (毎フレーム更新し続けるとiOS SafariのGPUメモリを圧迫してタブが落ちる)
          const cut = Math.floor((beatRef.current * pxPerBeat + noteSize / 2) / 16) * 16;
          if (cut !== lastCut) {
            lastCut = cut;
            inner.style.setProperty("--fs-cut", `${cut}px`);
          }
          if (el.scrollTop !== 0) el.scrollTop = 0;
          // transformではscrollイベントが出ないので、仮想化の範囲もここで更新
          const a = offset / pxPerBeat - 8;
          const b2 = (offset + el.clientHeight) / pxPerBeat + 8;
          setViewBeats((v) =>
            Math.abs(v.a - a) > 2 || Math.abs(v.b - b2) > 2 ? { a, b: b2 } : v
          );
        } else {
          el.scrollTop = beatRef.current * pxPerBeat - el.clientHeight * 0.4;
          // 現在位置の横線 (通常表示にはステップゾーンがないため)。
          // topではなくtransformで動かす: topの毎フレーム変更は
          // 巨大な譜面DOMのレイアウト再計算を誘発してカクつく
          if (playheadRef.current) {
            playheadRef.current.style.transform = `translate3d(0, ${
              beatRef.current * pxPerBeat + noteSize / 2
            }px, 0)`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (track) track.pause();
      // fs/プレイモード中の一時停止ではtransformを保持する (heightが
      // ないためscrollTopでは位置を表せない)。モードを抜けるときの
      // 通常スクロールへの引き継ぎは下の専用effectで行う
    };
  }, [playing, chart, timeline, speed, pxPerBeat, fs, pm, noteSize, muted, prepareClapTrack]);

  // fs/プレイモードを抜けたらtransform追従を解除し、通常スクロールへ引き継ぐ
  useEffect(() => {
    if (fs || pm) return;
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
  }, [fs, pm, pxPerBeat, noteSize]);

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
    if (fs || pm) {
      // fs/プレイモードはtransform追従 (innerに明示heightがなく
      // scrollTopで位置を表せないため)。仮想化ウィンドウも合わせる
      const inner = chartInnerRef.current;
      const offset = ev.row.beat * pxPerBeat + noteSize / 2 - RECEPTOR_Y;
      if (inner) {
        inner.style.transform = `translate3d(0, ${-offset}px, 0)`;
        inner.style.setProperty(
          "--fs-cut",
          `${ev.row.beat * pxPerBeat + noteSize / 2}px`
        );
      }
      const a = offset / pxPerBeat - 8;
      const b2 = (offset + el.clientHeight) / pxPerBeat + 8;
      setViewBeats((v) =>
        Math.abs(v.a - a) > 2 || Math.abs(v.b - b2) > 2 ? { a, b: b2 } : v
      );
      return;
    }
    el.scrollTo({
      top: ev.row.beat * pxPerBeat - el.clientHeight / 2 + noteSize,
      behavior: "smooth",
    });
  }, [current, chart, playing, editMode, pxPerBeat, noteSize, fs, pm]);

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
  // このステップと直前ノーツの等速換算の間隔秒。トレイルの濃さは
  // 再生速度に関係なく譜面本来の速さで決め、減衰時間・足の移動速度の
  // 実時間換算はfootScene側でplaySpeedから行う
  const trailIdx = playing ? footIdx : current;
  const trailGapSec =
    trailIdx > 0 && chart.events[trailIdx]
      ? timeAtBeat(timeline, chart.events[trailIdx].row.beat) -
        timeAtBeat(timeline, chart.events[trailIdx - 1].row.beat)
      : null;
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
    <div className={fs || pm ? `viewer-fs${pm ? " viewer-pm" : ""}` : undefined}>
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
        {(bgColor !== DEFAULT_BG || bgColor2) && (
          <button
            className="secondary bg-reset"
            onClick={() => {
              setBgColor(DEFAULT_BG);
              setBgColor2(null);
              setDirty(true);
            }}
            title={S.bgResetTitle}
          >
            ↺
          </button>
        )}
        {/* グラデーション切り替え: ONで2色目 (右下) のピッカーが出る */}
        <button
          className={`secondary bg-grad-toggle${bgColor2 ? " active" : ""}`}
          onClick={() => {
            setBgColor2(bgColor2 ? null : bgColor);
            setDirty(true);
          }}
          title={S.bgGradTitle}
        >
          ◧
        </button>
        <input
          type="color"
          className={`bg-picker${bgColor2 ? " round" : ""}`}
          value={`#${bgColor}`}
          onChange={(e) => {
            setBgColor(e.target.value.slice(1).toLowerCase());
            setDirty(true);
          }}
          title={bgColor2 ? S.bgPickerTitleGrad1 : S.bgPickerTitle}
        />
        {bgColor2 && (
          <input
            type="color"
            className="bg-picker round"
            value={`#${bgColor2}`}
            onChange={(e) => {
              setBgColor2(e.target.value.slice(1).toLowerCase());
              setDirty(true);
            }}
            title={S.bgPickerTitleGrad2}
          />
        )}
      </div>
      <div className="card head-card">
        <div className="head-row">
          <div style={{ minWidth: 0 }}>
            <div className="chart-title">
              {editingTitle ? (
                // タイトルとサブキャプションをまとめて編集。
                // 2つの入力間のフォーカス移動では閉じないようrelatedTargetを見る
                <span
                  className="title-edit"
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setEditingTitle(false);
                  }}
                >
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingTitle(false);
                    }}
                  />
                  <input
                    type="text"
                    className="title-input subtitle-input"
                    value={subtitle}
                    placeholder={S.subtitlePlaceholder}
                    onChange={(e) => {
                      setSubtitle(e.target.value);
                      setDirty(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingTitle(false);
                    }}
                  />
                  {/* 難易度: 5クラスの色足あと + 1-20レベル */}
                  <span className="diff-edit">
                    {DIFF_COLORS.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`diff-foot-btn${diffCls === i ? " sel" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setDiffCls(diffCls === i ? null : i);
                          setDirty(true);
                        }}
                      >
                        <DiffFootIcon color={c} size={18} />
                      </button>
                    ))}
                    <input
                      type="text"
                      inputMode="numeric"
                      className="diff-lvl-input"
                      value={diffLvl}
                      placeholder="Lv"
                      onChange={(e) => {
                        setDiffLvl(e.target.value.replace(/\D/g, "").slice(0, 2));
                        setDirty(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setEditingTitle(false);
                      }}
                    />
                  </span>
                </span>
              ) : (
                <button className="title-btn" onClick={() => setEditingTitle(true)}>
                  <span className="title-lines">
                    <span>
                      {title || S.untitled} <span className="edit-pen">✎</span>
                    </span>
                    {subtitle && <span className="chart-subtitle">{subtitle}</span>}
                  </span>
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
              {!editingTitle && (diffCls !== null || diffLvl) && (
                <button
                  className="diff-chip"
                  onClick={() => setEditingTitle(true)}
                  title={S.titlePlaceholder}
                >
                  {diffCls !== null && (
                    <DiffFootIcon color={DIFF_COLORS[diffCls]} size={16} />
                  )}
                  {diffLvl && <span className="diff-num">{diffLvl}</span>}
                </button>
              )}
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
        <button
          className="secondary"
          onClick={() => {
            if (!chart) return;
            setVDone(false);
            setVThumbDone(false);
            setVError(null);
            setVTplCopied(false);
            setShowVideo(true);
          }}
          title={S.videoBtnTitle}
        >
          🎥
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
          <button
            className="secondary"
            disabled={chart ? chart.measures.length >= MAX_MEASURES : true}
            onClick={() => applyEdit(appendMeasures(compact, 1, MAX_MEASURES))}
            title={S.addMeasureTitle}
          >
            ＋{S.addMeasure}
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
              <div className="hs-edit">
                <input
                  type="range"
                  min={HS_MIN}
                  max={HS_MAX}
                  step={0.05}
                  value={hispeed}
                  onChange={(e) => {
                    const v = clampHs(Number(e.target.value));
                    setHispeed(v);
                    setHsText(String(v));
                    setDirty(true);
                  }}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="hs-num"
                  value={hsText}
                  onChange={(e) => {
                    const t = e.target.value;
                    setHsText(t);
                    const n = Number(t);
                    if (Number.isFinite(n) && n > 0) {
                      setHispeed(clampHs(n));
                      setDirty(true);
                    }
                  }}
                  onBlur={() => setHsText(String(hispeed))}
                />
              </div>
            </div>
            {/* 見かけのスクロールBPM (BPM × HS) */}
            <p className="hint hs-bpm-hint">
              {S.hsScrollBpm}: ♩=
              {bpms.length > 1
                ? `${+(Math.min(...bpms.map((x) => x.bpm)) * hispeed).toFixed(1)}-${+(
                    Math.max(...bpms.map((x) => x.bpm)) * hispeed
                  ).toFixed(1)}`
                : `${+(bpms[0].bpm * hispeed).toFixed(1)}`}
              {` (BPM × ${hispeed})`}
            </p>
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
                  range.end,
                  highlights,
                  noteComments
                );
                const enc = (v: string) =>
                  encodeURIComponent(v).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
                const parts: string[] = [];
                const encoded = await compressCompact(clip.compact);
                if (encoded && encoded.length < clip.compact.length)
                  parts.push(`d=${encoded}`);
                else parts.push(`n=${clip.compact}`);
                if (clipName) parts.push(`t=${encodeURIComponent(clipName)}`);
                if (subtitle) parts.push(`st=${encodeURIComponent(subtitle)}`);
                const clipDf = serializeDiff(diffCls, diffLvl);
                if (clipDf) parts.push(`df=${clipDf}`);
                if (clip.b) parts.push(`b=${enc(clip.b)}`);
                if (clip.s) parts.push(`s=${enc(clip.s)}`);
                if (clip.f) parts.push(`f=${clip.f}`);
                if (clip.hl) parts.push(`hl=${clip.hl}`);
                if (clip.hc) parts.push(`hc=${clip.hc}`);
                if (hispeed !== 1) parts.push(`hs=${hispeed}`);
                if (speed !== 1) parts.push(`sp=${speed}`);
                if (bgParam !== DEFAULT_BG) parts.push(`c=${bgParam}`);
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
              // 注目コメントの脚注ぶんも高さに含める
              const totalH =
                layout.height +
                measureChartComments(
                  filterCommentsForRange(noteComments, range.start, range.end),
                  layout.width
                );
              const sc = Math.min(200 / layout.width, 150 / totalH, 1);
              const ratio =
                totalH >= layout.width
                  ? `1 : ${(totalH / layout.width).toFixed(1)}`
                  : `${(layout.width / totalH).toFixed(1)} : 1`;
              return (
                <div className="img-preview">
                  <div
                    className="img-preview-frame"
                    style={{
                      width: Math.max(6, layout.width * sc),
                      height: Math.max(6, totalH * sc),
                      background: bgColor2
                        ? `linear-gradient(135deg, #${bgColor}, #${bgColor2})`
                        : `#${bgColor}`,
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
                    {Math.round(layout.width)}×{Math.round(totalH)}px
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
                    subtitle,
                    diff:
                      diffCls !== null || diffLvl
                        ? { cls: diffCls, lvl: diffLvl }
                        : null,
                    bgColor,
                    bgColor2,
                    measuresPerColumn:
                      Number.isFinite(perColNum) && perColNum >= 1 ? perColNum : 16,
                    hispeed,
                    highlights,
                    comments: noteComments,
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

      {showVideo && chart && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!vBusy) setShowVideo(false);
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{S.videoTitle}</h2>
              <button
                className="secondary modal-close"
                onClick={() => {
                  if (vBusy) vSignal.current.cancelled = true;
                  setShowVideo(false);
                }}
              >
                ✕
              </button>
            </div>
            <p className="hint opt-hint">{S.videoDesc}</p>
            <div className="opt-row">
              <div className="opt-btns">
                <button
                  className={vMode === "portrait" ? "" : "secondary"}
                  onClick={() => setVMode("portrait")}
                >
                  {S.videoModePortrait}
                </button>
                <button
                  className={vMode === "landscape" ? "" : "secondary"}
                  onClick={() => setVMode("landscape")}
                >
                  {S.videoModeLandscape}
                </button>
              </div>
            </div>
            {/* 横長のみ: 収録速度の選択 */}
            {vMode === "landscape" && (
              <div className="opt-row">
                <span className="opt-label">{S.videoSpeedLabel}</span>
                <div className="opt-btns">
                  <button
                    className={vLandSpeed === 0.5 ? "" : "secondary"}
                    onClick={() => setVLandSpeed(0.5)}
                  >
                    {S.videoSpeedHalf}
                  </button>
                  <button
                    className={vLandSpeed === 1 ? "" : "secondary"}
                    onClick={() => setVLandSpeed(1)}
                  >
                    {S.videoSpeedFull}
                  </button>
                </div>
              </div>
            )}
            {/* 横長のみ: 番組構成 (OFFなら素の譜面再生だけを書き出す) */}
            {vMode === "landscape" && (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={vProgram}
                  onChange={(e) => setVProgram(e.target.checked)}
                />
                <span>{S.videoProgram}</span>
              </label>
            )}
            {/* 自動解説の量と、書き出し前の件数・追加時間のプレビュー */}
            {vMode === "landscape" && vProgram && noteComments.size === 0 && (
              <>
                <div className="opt-row">
                  <span className="opt-label">{S.videoSpotAmount}</span>
                  <div className="opt-btns">
                    {(
                      [
                        ["few", S.videoSpotFew],
                        ["normal", S.videoSpotNormal],
                        ["many", S.videoSpotMany],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={vSpotAmount === key ? "" : "secondary"}
                        onClick={() => setVSpotAmount(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="video-spot-info">
                  {autoSpots.length > 0
                    ? S.videoSpotInfo(
                        autoSpots.length,
                        autoSpots
                          .slice(0, 6)
                          .map((s) =>
                            s.measures.length > 1
                              ? `${s.measures[0] + 1}〜${s.measures[s.measures.length - 1] + 1}`
                              : `${s.measures[0] + 1}`
                          )
                          .join("・") + (autoSpots.length > 6 ? "…" : "")
                      )
                    : S.videoSpotNone}
                </p>
              </>
            )}
            {vMode === "landscape" && vProgram && noteComments.size > 0 && (
              <p className="video-spot-info">{S.videoSpotManual(noteComments.size)}</p>
            )}
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={vUseMedia}
                onChange={(e) => setVUseMedia(e.target.checked)}
              />
              <span>{S.videoUseMedia}</span>
            </label>
            {vUseMedia && (
              <>
                <input
                  type="url"
                  placeholder={S.videoAudioUrl}
                  value={vOgg}
                  onChange={(e) => setVOgg(e.target.value)}
                />
                <input
                  type="url"
                  placeholder={S.videoJacketUrl}
                  value={vJacket}
                  onChange={(e) => setVJacket(e.target.value)}
                />
                <div className="opt-row">
                  <span className="opt-label">{S.videoOffset}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.05"
                    value={vOffset}
                    onChange={(e) => setVOffset(e.target.value)}
                  />
                </div>
              </>
            )}
            {vError && <p className="error">{vError}</p>}
            <button
              disabled={vBusy}
              onClick={async () => {
                if (!chart || vBusy) return;
                setVError(null);
                setVDone(false);
                setVBusy(true);
                setVProgress(0);
                vSignal.current = { cancelled: false };
                try {
                  const audio =
                    vUseMedia && vOgg.trim() ? await loadAudioFromUrl(vOgg.trim()) : null;
                  const jacket =
                    vUseMedia && vJacket.trim()
                      ? await loadImageFromUrl(vJacket.trim())
                      : null;
                  const off = Number(vOffset);
                  const bpmLabel =
                    bpms.length > 1
                      ? `${+Math.min(...bpms.map((x) => x.bpm)).toFixed(1)}-${+Math.max(
                          ...bpms.map((x) => x.bpm)
                        ).toFixed(1)}`
                      : `${+bpms[0].bpm.toFixed(1)}`;
                  const { blob, ext } = await recordChartVideo({
                    chart,
                    footsteps,
                    timeline,
                    title: title || S.untitled,
                    subtitle,
                    diff: diffCls !== null || diffLvl ? { cls: diffCls, lvl: diffLvl } : null,
                    bpmLabel,
                    bgColor,
                    bgColor2,
                    hispeed,
                    audio,
                    jacket,
                    offsetSec: Number.isFinite(off) ? off : 0,
                    landscape: vMode === "landscape",
                    landscapeSpeed: vLandSpeed,
                    plain: !vProgram,
                    trail: footTrail,
                    stats: [
                      { label: S.steps, value: stats.steps },
                      { label: S.jumps, value: stats.jumps },
                      { label: S.jacks, value: stats.jacks },
                      { label: S.crossovers, value: stats.crossovers },
                      { label: S.doubleSteps, value: stats.doubleSteps },
                      ...(stats.shocks > 0
                        ? [{ label: S.shocks, value: stats.shocks }]
                        : []),
                    ],
                    // 注目コメント (tick=48分音基準をbeatへ換算)。横長のみ使われる。
                    // 手動コメントがなければ自動検出の解説 (事前計算済み) を使う
                    spotlights:
                      noteComments.size > 0
                        ? [...noteComments.entries()].map(([tick, text]) => ({
                            beat: tick / 48,
                            text,
                          }))
                        : autoSpots.map((s) => ({
                            beat: s.beat,
                            text: s.text,
                            measures: s.measures,
                          })),
                    onProgress: setVProgress,
                    signal: vSignal.current,
                  });
                  if (vSignal.current.cancelled) return;
                  const base = (title || S.untitled).replace(/[\\/:*?"<>|]/g, "_");
                  const file = new File([blob], `${base}.${ext}`, { type: blob.type });
                  if (navigator.canShare?.({ files: [file] })) {
                    try {
                      await navigator.share({ files: [file] });
                      setVDone(true);
                      return;
                    } catch (err) {
                      if ((err as DOMException)?.name === "AbortError") return;
                    }
                  }
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = file.name;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  setVDone(true);
                } catch (e) {
                  setVError(e instanceof Error ? e.message : String(e));
                } finally {
                  setVBusy(false);
                }
              }}
            >
              {vBusy
                ? S.videoRecording(Math.round(vProgress * 100))
                : vDone
                ? S.videoDone
                : S.videoExport}
            </button>
            {vBusy && (
              <button
                className="secondary"
                onClick={() => {
                  vSignal.current.cancelled = true;
                }}
              >
                {S.videoCancel}
              </button>
            )}
            {vMode === "landscape" && (
              // 横動画はYouTubeのサムネを別画像でアップする必要があるため、
              // イントロカードと同じ絵を1280x720のJPEGとして書き出す
              <button
                className="secondary"
                disabled={vBusy || vThumbBusy}
                onClick={async () => {
                  if (vThumbBusy) return;
                  setVError(null);
                  setVThumbBusy(true);
                  try {
                    const jacket =
                      vUseMedia && vJacket.trim()
                        ? await loadImageFromUrl(vJacket.trim())
                        : null;
                    const bpmLabel =
                      bpms.length > 1
                        ? `${+Math.min(...bpms.map((x) => x.bpm)).toFixed(1)}-${+Math.max(
                            ...bpms.map((x) => x.bpm)
                          ).toFixed(1)}`
                        : `${+bpms[0].bpm.toFixed(1)}`;
                    const blob = await renderVideoThumbnail({
                      title: title || S.untitled,
                      subtitle,
                      diff:
                        diffCls !== null || diffLvl ? { cls: diffCls, lvl: diffLvl } : null,
                      bpmLabel,
                      bgColor,
                      bgColor2,
                      jacket,
                    });
                    const base = (title || S.untitled).replace(/[\\/:*?"<>|]/g, "_");
                    const file = new File([blob], `${base}_thumb.jpg`, { type: blob.type });
                    if (navigator.canShare?.({ files: [file] })) {
                      try {
                        await navigator.share({ files: [file] });
                        setVThumbDone(true);
                        return;
                      } catch (err) {
                        if ((err as DOMException)?.name === "AbortError") return;
                      }
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = file.name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    setVThumbDone(true);
                  } catch (e) {
                    setVError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setVThumbBusy(false);
                  }
                }}
              >
                {vThumbDone ? S.videoThumbDone : S.videoThumb}
              </button>
            )}
            {/* 投稿用テンプレ (タイトル+概要欄) をクリップボードへ。控えめに */}
            <button
              className="tpl-copy"
              onClick={async () => {
                const name = title || S.untitled;
                const diffTxt =
                  diffCls !== null || diffLvl
                    ? ` (${diffCls !== null ? ["習", "楽", "踊", "激", "鬼"][diffCls] : "Lv"}${diffLvl})`
                    : "";
                const bpmTxt =
                  bpms.length > 1
                    ? `${+Math.min(...bpms.map((x) => x.bpm)).toFixed(1)}-${+Math.max(
                        ...bpms.map((x) => x.bpm)
                      ).toFixed(1)}`
                    : `${+bpms[0].bpm.toFixed(1)}`;
                const shareUrl = location.origin + (await buildUrl());
                // 1行目=動画タイトル、空行以降=概要欄。縦横で文言を分ける
                const isLand = vMode === "landscape";
                const head = isLand
                  ? `【STEP ANALYZER】${name}${diffTxt} 足割りじっくり解説 (0.5倍速)`
                  : `【STEP ANALYZER】${name}${diffTxt} #Shorts`;
                const body = isLand
                  ? [
                      "DDRの譜面をどちらの足で踏むか (足割り) を自動解析し、0.5倍速でじっくり再生しています。",
                      "注目ポイントでは一時停止して解説コメントが入ります。",
                      "",
                      "譜面と足割りをブラウザで見る:",
                      shareUrl,
                      "",
                      "#DDR #DanceDanceRevolution #StepAnalyzer",
                    ]
                  : [
                      "DDRの譜面をどちらの足で踏むか (足割り) を自動解析して再生しています。",
                      "じっくり見たい人向けの0.5倍速解説版は関連動画からどうぞ。",
                      "",
                      "譜面と足割りをブラウザで見る:",
                      shareUrl,
                      "",
                      "#DDR #DanceDanceRevolution #Shorts #StepAnalyzer",
                    ];
                const text = [
                  head,
                  "",
                  `${name}${subtitle ? ` / ${subtitle}` : ""}`,
                  `♩=${bpmTxt}${diffTxt} / ${stats.steps}ステップ`,
                  "",
                  ...body,
                ].join("\n");
                try {
                  await navigator.clipboard.writeText(text);
                  setVTplCopied(true);
                } catch {
                  // クリップボード不許可なら黙って何もしない
                }
              }}
            >
              {vTplCopied ? S.videoTplCopied : S.videoTplCopy}
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
              ? S.rangePending(fmtBeat(rangeSel.a))
              : S.rangeActive(
                  fmtBeat(Math.min(rangeSel.a, rangeSel.b)),
                  fmtBeat(Math.max(rangeSel.a, rangeSel.b))
                )}
          </span>
          {/* 範囲編集 (編集モード中のみ)。貼り付け先は選択の始点 */}
          {editMode && (
            <span className="range-ops">
              {selBeats && (
                <button
                  className="secondary"
                  onClick={() =>
                    setBeatClip(copyBeats(compact, selBeats.start, selBeats.end + 1))
                  }
                >
                  ⧉ {S.rangeCopy}
                </button>
              )}
              {selBeats && (
                <button
                  className="secondary"
                  onClick={() => {
                    setBeatClip(copyBeats(compact, selBeats.start, selBeats.end + 1));
                    applyEdit(clearBeats(compact, selBeats.start, selBeats.end + 1));
                  }}
                >
                  ✂ {S.rangeCut}
                </button>
              )}
              {selBeats && (
                <button
                  className="secondary"
                  onClick={() =>
                    applyEdit(clearBeats(compact, selBeats.start, selBeats.end + 1))
                  }
                >
                  ⌫ {S.rangeDelete}
                </button>
              )}
              {beatClip && (
                <button
                  className="secondary"
                  onClick={() =>
                    applyEdit(
                      pasteBeats(
                        compact,
                        selBeats ? selBeats.start : rangeSel.a,
                        beatClip,
                        MAX_MEASURES
                      )
                    )
                  }
                >
                  ⎘ {S.rangePaste}
                </button>
              )}
            </span>
          )}
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
          onApply={(next, timing, smTitle, smArtist, smDiff) => {
            applyEdit(next);
            setOverrides(new Map());
            // 譜面を丸ごと差し替えるので注目・コメントも前の譜面のものを残さない
            setHighlights(new Set());
            setNoteComments(new Map());
            if (timing?.b) setBpm(timing.b);
            if (timing?.s !== undefined) setStops(timing.s);
            if (smTitle) setTitle(smTitle);
            if (smArtist !== undefined) setSubtitle(smArtist);
            if (smDiff !== undefined) {
              setDiffCls(smDiff.cls);
              setDiffLvl(smDiff.lvl);
            }
            go(0);
            setShowText(false);
          }}
        />
      )}

      <div className="viewer-layout">
        <div className="chart-pane" onClick={fs && !pm ? togglePlay : undefined}>
          {(fs || pm) && (
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
              {!playing && !pm && <div className="fs-paused">▶</div>}
              {/* プレイモード: 判定文字・コンボ・カウントイン */}
              {pm && pmPopup && (
                <div key={pmPopup.k} className={`pm-judgment pm-j-${pmPopup.j}`}>
                  {PM_JUDGE_TEXT[pmPopup.j]}
                </div>
              )}
              {pm && pmStarted && pmCombo >= 3 && (
                <div key={`c${pmCombo}`} className="pm-combo">
                  {pmCombo} <span className="pm-combo-word">COMBO</span>
                </div>
              )}
              {pm && pmCount > 0 && (
                <div key={`n${pmCount}`} className="pm-count">
                  {pmCount}
                </div>
              )}
              <button
                className="fs-exit"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pm) exitPm();
                  else exitFs();
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
            style={fs || pm ? { clipPath: `inset(${RECEPTOR_Y - noteSize / 2}px 0 0 0)` } : undefined}
          >
            <div
              className="chart-inner"
              ref={chartInnerRef}
              // fs/プレイモード中は明示heightを外す: transformで動かす
              // 合成レイヤーの大きさが譜面全体 (数万px) ではなく描画中の
              // 子要素の範囲だけになり、長い譜面でGPUのタイルメモリが
              // 膨らんでモバイルのタブが落ちるのを防ぐ (スクロールは
              // scrollTop=0固定のtransform追従なのでheightは不要)
              style={{ width: laneW * 4, height: fs || pm ? undefined : totalH }}
            >
              {playing && !fs && <div className="playhead" ref={playheadRef} />}
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
                        rangeSel && rangeSel.b === null && Math.floor(rangeSel.a / 4) === m
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
                    // 左端の小節番号ゾーン: タップで範囲選択 (4分単位。
                    // タップ位置の高さからどの拍かを割り出す)
                    <div
                      className="measure-tap"
                      style={{
                        top: m * 4 * pxPerBeat + noteSize / 2,
                        height: 4 * pxPerBeat,
                      }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const frac = (e.clientY - rect.top) / rect.height;
                        const lb = Math.min(3, Math.max(0, Math.floor(frac * 4)));
                        tapBeatZone(m * 4 + lb);
                      }}
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

              {/* 範囲選択のインジケータ: 左端の縦バー (拍単位、選択中は薄く表示) */}
              {rangeSel && (
                <div
                  className={`range-bar${rangeSel.b === null ? " pending" : ""}`}
                  style={{
                    top:
                      Math.min(rangeSel.a, rangeSel.b ?? rangeSel.a) * pxPerBeat +
                      noteSize / 2,
                    height:
                      (Math.abs((rangeSel.b ?? rangeSel.a) - rangeSel.a) + 1) * pxPerBeat,
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
                    <span className="timing-marker-label">♩{+e.bpm.toFixed(1)}</span>
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
                    <span className="timing-marker-label">
                      ⏸{String(+e.sec.toFixed(2)).replace(/^0\./, ".")}
                    </span>
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
                    // fs/プレイモード再生中は判定線より上を削って
                    // 「消費されていく」見た目に。
                    // --fs-cut未設定時はcalcが大きな負値になりクリップ無効
                    ...(fs || pm
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

              {/* 注目ノーツの黄色い枠 (連続選択は1つの枠にまとまる) */}
              {highlightBoxes.map((b, i) => {
                if (b.end < viewBeats.a || b.start > viewBeats.b) return null;
                const pad = 7;
                return (
                  <div
                    key={`hl${i}`}
                    className="hl-box"
                    style={{
                      left: b.pMin * laneW + (laneW - noteSize) / 2 - pad,
                      top: b.start * pxPerBeat - pad,
                      width: (b.pMax - b.pMin) * laneW + noteSize + pad * 2,
                      height: (b.end - b.start) * pxPerBeat + noteSize + pad * 2,
                    }}
                  />
                );
              })}

              {chart.events.map((ev, i) => {
                if (ev.row.beat < viewBeats.a || ev.row.beat > viewBeats.b) return null;
                // fs再生中: 受け皿でジャスト表示が出たノーツは実機同様に消す
                if ((fs || pm) && playing && i <= playedIdx) return null;
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
            {webglOk ? (
              <FootStage3D
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
                trail={footTrail}
                trailGapSec={trailGapSec}
                playSpeed={speed}
              />
            ) : (
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
            )}
            {pm && (
              // プレイモードの入力レイヤー: 足アニメの上に透明な4分割の
              // タップ領域を重ねる (下ペーン全体)。分割は内部的な入力判定で、
              // 見た目はタップした瞬間のフラッシュだけ。
              // マルチタッチ対応 (pointerdownは指ごとに発火する)
              <div
                className="pm-pad"
                onPointerDown={(e) => {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const dx = e.clientX - (r.left + r.width / 2);
                  const dy = e.clientY - (r.top + r.height / 2);
                  pmTap(
                    Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 3) : dy < 0 ? 2 : 1
                  );
                }}
              >
                {[0, 1, 2, 3].map((p) => (
                  <div
                    key={`${p}-${pmZoneFlash[p]}`}
                    className={`pm-zone pm-zone-${p}${pmZoneFlash[p] > 0 ? " flash" : ""}`}
                  />
                ))}
              </div>
            )}
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
                onClick={enterPm}
                title={S.playModeTitle}
              >
                🎮
              </button>
              {webglOk && (
                <button
                  className={footTrail ? "" : "secondary"}
                  onClick={() => setFootTrail(!footTrail)}
                  title={S.trailTitle}
                >
                  🐾
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
                <div className="event-head">
                  <span className="event-head-main">
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
                  </span>
                  <span className="event-head-side">
                  {hasSofran && (
                    <span className="cur-bpm">♩={+bpmAtBeat(bpms, curEvent.row.beat).toFixed(1)}</span>
                  )}
                  {!curEvent.shock && curEvent.panels.length > 0 && (
                    <button
                      className={`hl-btn${
                        highlights.has(tickOf(curEvent.row.beat)) ? " active" : ""
                      }`}
                      title={S.spotlightTitle}
                      onClick={() => {
                        const tick = tickOf(curEvent.row.beat);
                        setHighlights((prev) => {
                          const next = new Set(prev);
                          if (next.has(tick)) {
                            next.delete(tick);
                            // 注目解除時はコメントも一緒に消す
                            setNoteComments((pc) => {
                              if (!pc.has(tick)) return pc;
                              const nc = new Map(pc);
                              nc.delete(tick);
                              return nc;
                            });
                          } else {
                            next.add(tick);
                          }
                          return next;
                        });
                        setDirty(true);
                      }}
                    >
                      ★ {S.spotlightBtn}
                    </button>
                  )}
                  </span>
                </div>
                {/* 注目ノーツへのコメント (横長動画の注目シーンで字送り表示する) */}
                {!curEvent.shock &&
                  curEvent.panels.length > 0 &&
                  highlights.has(tickOf(curEvent.row.beat)) && (
                    <input
                      type="text"
                      className="hl-comment-input"
                      maxLength={120}
                      value={noteComments.get(tickOf(curEvent.row.beat)) ?? ""}
                      placeholder={S.hlCommentPlaceholder}
                      onChange={(e) => {
                        const tick = tickOf(curEvent.row.beat);
                        const v = e.target.value;
                        setNoteComments((prev) => {
                          const next = new Map(prev);
                          if (v) next.set(tick, v);
                          else next.delete(tick);
                          return next;
                        });
                        setDirty(true);
                      }}
                    />
                  )}
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

      {/* プレイモード: 開始前オーバーレイ (遅延キャリブレーション込み) */}
      {pm && !pmStarted && !pmResult && (
        <div
          className="pm-overlay"
          onPointerDown={pmCal ? pmCalTap : undefined}
        >
          {pmCal ? (
            <>
              <div className="pm-logo-text">CALIBRATE</div>
              <p className="pm-desc">{S.pmCalGuide(pmCal.taps)}</p>
              <div className="pm-cal-dots">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className={i < pmCal.taps ? "on" : ""} />
                ))}
              </div>
              <button
                className="secondary"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={stopPmCal}
              >
                {S.pmCalCancel}
              </button>
            </>
          ) : (
            <>
              <div className="pm-logo-text">PLAY MODE</div>
              <p className="pm-song">{title || "Step Analyzer"}</p>
              <p className="pm-desc">{S.pmHint}</p>
              <button className="pm-start" onClick={startPm}>
                {S.pmStart}
              </button>
              <div className="pm-settings">
                <div className="pm-setting-row">
                  <span>{S.pmOffsetLabel}</span>
                  <button
                    className="secondary"
                    onClick={() => setPmOffsetSaved(pmOffsetMs - 5)}
                  >
                    −
                  </button>
                  <span className="pm-offset-val">
                    {pmOffsetMs > 0 ? `+${pmOffsetMs}` : pmOffsetMs}ms
                  </span>
                  <button
                    className="secondary"
                    onClick={() => setPmOffsetSaved(pmOffsetMs + 5)}
                  >
                    ＋
                  </button>
                  <button className="secondary" onClick={startPmCal}>
                    {S.pmCalibrate}
                  </button>
                </div>
                <label className="pm-setting-row">
                  <input
                    type="checkbox"
                    checked={pmWide}
                    onChange={(e) => setPmWideSaved(e.target.checked)}
                  />
                  <span>{S.pmWideLabel}</span>
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {/* プレイモード: リザルト */}
      {pm && pmResult && (
        <div className="pm-overlay pm-result">
          <div className="pm-logo-text">RESULT</div>
          <div className={`pm-grade pm-grade-${pmResult.grade.replace(/[+-]/g, "")}`}>
            {pmResult.grade}
          </div>
          <div className="pm-score">
            <span className="pm-score-num">{pmResult.score.toLocaleString()}</span>
            <span className="pm-score-ex">
              EX {pmResult.exScore} / {pmResult.exMax}
            </span>
          </div>
          <div className="pm-counts">
            {(
              [
                ["marvelous", "MARVELOUS"],
                ["perfect", "PERFECT"],
                ["great", "GREAT"],
                ["good", "GOOD"],
                ["miss", "MISS"],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className={`pm-count-row pm-j-${k}`}>
                <span className="pm-count-label">{label}</span>
                <span className="pm-count-num">{pmResult.counts[k]}</span>
              </div>
            ))}
            <div className="pm-count-row">
              <span className="pm-count-label">{S.pmMaxCombo}</span>
              <span className="pm-count-num">{pmResult.maxCombo}</span>
            </div>
            {pmResult.shockHits > 0 && (
              <div className="pm-count-row pm-j-miss">
                <span className="pm-count-label">{S.pmShockHits}</span>
                <span className="pm-count-num">{pmResult.shockHits}</span>
              </div>
            )}
          </div>
          <div className="pm-result-btns">
            <button className="pm-start" onClick={startPm}>
              {S.pmRetry}
            </button>
            <button className="secondary" onClick={exitPm}>
              {S.pmClose}
            </button>
          </div>
        </div>
      )}
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
  onApply: (
    next: string,
    timing?: { b?: string; s?: string },
    smTitle?: string,
    smArtist?: string,
    smDiff?: { cls: number | null; lvl: string }
  ) => void;
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
  const applyChart = (
    noteText: string,
    full: string,
    timingText?: string,
    info?: SmChartInfo
  ) => {
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
      // アーティスト名はサブキャプションへ。ファイル全体の取り込み時は
      // 曲が変わったとみなし、#ARTISTが無ければ空文字で前の曲の値をクリアする
      const am = full.match(/#ARTIST\s*:\s*([^;]*);/i);
      const smArtist = isFullFile ? am?.[1].trim() ?? "" : undefined;
      // 難易度も同様: ファイル全体の取り込み時は必ず上書き (不明ならクリア)
      const smDiff = isFullFile
        ? {
            cls: info ? diffClassFromSm(info.difficulty) : null,
            lvl: info ? diffLevelFromSm(info.meter) : "",
          }
        : undefined;
      onApply(result.compact, timing, smTitle, smArtist, smDiff);
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
    if (charts.length > 0) {
      // SM/SSCファイル: シングルだけ列挙し、1つならそのまま、複数なら選ばせる。
      // 1譜面でもSmChartInfo経由にすることで難易度メタを取り込める
      const singles = charts.filter((c) => !/double|couple|routine/i.test(c.type));
      setExcluded(charts.length - singles.length);
      if (singles.length === 0) {
        setError(S.noSingleCharts);
        return;
      }
      if (singles.length === 1) {
        applyChart(singles[0].notes, body, singles[0].timingText, singles[0]);
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
              onClick={() => applyChart(c.notes, text, c.timingText, c)}
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
  // 足の表示角はプレゼン専用に圧縮する。内部のfacingは「両足を結ぶ線」由来の
  // 解析角で、135°の捻りでも実際の人間の足はそこまで後ろを向かない。
  // 45°までは等倍、以降は0.4倍で圧縮し、上限は真横 (90°)。
  const norm = facing % 360;
  let a = Math.abs(norm);
  const sign = Math.sign(norm);
  // 180°超のイレギュラー帯は「かかとを正面に向けて捻りを受ける」解釈。
  // 左225°ならつま先を左後ろ (-135°) に向け、かかとが右前を向く。
  // 直前の135° (=表示-81°) からの回転変化が最小になる連続的な表現
  const heelFlip = a > 180;
  if (heelFlip) a -= 180;
  const compressed = Math.min(90, a <= 45 ? a : 45 + (a - 45) * 0.4);
  const footRot = heelFlip ? sign * (180 - compressed) : sign * compressed;
  const lc = STAGE_CENTERS[leftPos];
  const rc = STAGE_CENTERS[rightPos];
  let lx = lc.x + (same ? -0.22 : 0);
  let ly = lc.y;
  let rx = rc.x + (same ? 0.22 : 0);
  let ry = rc.y;
  // 2枚抜き: 踏んでいる足は2パネルの中間 (角) に置き、
  // 2パネルを結ぶ対角線に沿った絶対角度 (±45°) で表示する。
  // パネルの組み合わせで足の向きは物理的に決まるため、体の向きは合成しない
  let lRot = footRot;
  let rRot = footRot;
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
