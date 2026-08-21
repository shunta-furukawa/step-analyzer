// UI文字列のローカライズ。デフォルトは日本語 (l= パラメータで保持)。
// 用語はDDR/ITGコミュニティの通称に合わせる (2枚抜き=Bracket, 縦連=Jack など)

import type { ReactNode } from "react";

export type Lang = "ja" | "en" | "ko";

export const LANGS: { value: Lang; flag: string; label: string }[] = [
  { value: "ja", flag: "🇯🇵", label: "日本語" },
  { value: "en", flag: "🇺🇸", label: "English" },
  { value: "ko", flag: "🇰🇷", label: "한국어" },
];

export function normalizeLang(v: string | undefined): Lang {
  return v === "en" || v === "ko" ? v : "ja";
}

export interface Strings {
  // ヘッダ・統計
  untitled: string;
  leftFoot: string;
  rightFoot: string;
  quantSuffix: string; // "4分" の "分"
  facingLegend: string;
  steps: string;
  jumps: string;
  jacks: string;
  crossovers: string;
  doubleSteps: string;
  ghosts: string;
  shocks: string;
  titlePlaceholder: string;
  subtitlePlaceholder: string;
  bgPickerTitle: string;
  bgPickerTitleGrad1: string;
  bgPickerTitleGrad2: string;
  bgGradTitle: string;
  bgResetTitle: string;
  // ツールバー
  edit: string;
  editing: string;
  textBtn: string;
  textBtnShort: string;
  timingBtn: string;
  copyUrl: string;
  copyShort: string;
  copied: string;
  placeAt: (res: number) => string;
  shockMode: string;
  shockModeActive: string;
  shockModeTitle: string;
  ghostMode: string;
  ghostModeActive: string;
  ghostModeTitle: string;
  freezeMode: string;
  freezeModeActive: string;
  freezeModeTitle: string;
  hintFreezeStart: string;
  hintFreezeEnd: string;
  hintShock: string;
  hintGhost: string;
  hintNormal: string;
  // 変速パネル
  timingPanelTitle: string;
  timingPanelDesc: ReactNode;
  bpmField: string;
  stopsField: string;
  // テキスト入力パネル
  textPanelTitle: string;
  textPanelDesc: ReactNode;
  urlPlaceholder: string;
  loadFromUrl: string;
  loading: string;
  loadText: string;
  multiCharts: (excluded: number) => string;
  noSingleCharts: string;
  fetchFailed: string;
  chartFallback: (i: number) => string;
  // オプションモーダル
  optionsBtn: string;
  optionsTitle: string;
  hispeedLabel: string;
  hsScrollBpm: string;
  transformLabel: string;
  transformOff: string;
  transformRandomReroll: string;
  transformCustom: string;
  close: string;
  // クリップ共有
  clipBtn: string;
  clipTitle: string;
  clipDesc: string;
  clipStart: string;
  clipEnd: string;
  clipNameLabel: string;
  clipMeasures: (n: number) => string;
  clipCopy: string;
  clipCopied: string;
  clipRangeError: (max: number) => string;
  imageBtnTitle: string;
  imageTitle: string;
  imageDesc: string;
  imageSave: string;
  imageSaving: string;
  imageSaved: string;
  imagePerCol: string;
  // 動画書き出し
  videoBtnTitle: string;
  videoTitle: string;
  videoDesc: string;
  videoUseMedia: string;
  videoAudioUrl: string;
  videoJacketUrl: string;
  videoOffset: string;
  videoExport: string;
  videoRecording: (pct: number) => string;
  videoDone: string;
  videoThumb: string;
  videoThumbDone: string;
  videoTplCopy: string;
  videoTplCopied: string;
  hlCommentPlaceholder: string;
  videoModePortrait: string;
  videoModeLandscape: string;
  videoSpeedLabel: string;
  videoSpeedHalf: string;
  videoSpeedFull: string;
  videoCancel: string;
  // 小節番号タップの範囲選択
  rangePending: (p: string) => string;
  rangeActive: (a: string, b: string) => string;
  rangeClear: string;
  rangeCopy: string;
  rangeCut: string;
  rangeDelete: string;
  rangePaste: string;
  addMeasure: string;
  addMeasureTitle: string;
  metronomeTitle: string;
  aiGenBtn: string;
  aiModalTitle: string;
  aiModalDesc: string;
  aiWishPlaceholder: string;
  aiOpenExternal: string;
  specLink: string;
  spotlightBtn: string;
  spotlightTitle: string;
  // コントロール
  toStartTitle: string;
  playTitle: string;
  clapTitle: string;
  stompTitle: string;
  fsTitle: string;
  hispeedTitle: string;
  prev: string;
  next: string;
  // 現在ノーツ情報
  measureLabel: (n: number) => string;
  shockArrow: string;
  footL: string;
  footR: string;
  facingLabel: (dir: "L" | "R", deg: number) => string;
  stepFootLabel: string;
  handlingLabel: string;
  centerBoth: string;
  centerL: string;
  centerR: string;
  resetIgnore: string;
  resetAuto: string;
  bracketWith: (f: "L" | "R") => string;
  footLBtn: string;
  footRBtn: string;
  holding: string;
  overrideCount: (n: number) => string;
  clearAll: string;
  // タグ
  tagShockGhost: string;
  tagShockIgnore: string;
  tagGhostSwap: string;
  tagGhostReposition: string;
  tagBracket: string;
  tagJump: string;
  tagJack: string;
  tagCrossover: string;
  tagFootswitch: string;
  // 譜面上のバッジ
  flagJack: string;
  flagCross: string;
  flagSwitch: string;
  badgeBoth: string;
  mineTitle: string;
  shockRowTitle: string;
  // エラー
  loadError: string;
  backToTop: string;
  helpTitle: string;
  // フッター
  footerContact: ReactNode;
}

const ja: Strings = {
  untitled: "無題の譜面",
  leftFoot: "左足",
  rightFoot: "右足",
  quantSuffix: "分",
  facingLegend: "背景=体の向き (左←→右)",
  steps: "ステップ",
  jumps: "ジャンプ",
  jacks: "縦連",
  crossovers: "交差",
  doubleSteps: "踏み替え",
  ghosts: "空打ち",
  shocks: "ショック",
  titlePlaceholder: "タイトルを入力",
  subtitlePlaceholder: "アーティスト名など (任意)",
  bgPickerTitle: "背景色をカスタマイズ",
  bgPickerTitleGrad1: "グラデーション左上の色",
  bgPickerTitleGrad2: "グラデーション右下の色",
  bgGradTitle: "2色グラデーションに切り替え",
  bgResetTitle: "デフォルト色に戻す",
  edit: "編集",
  editing: "編集中",
  textBtn: "テキスト入力",
  textBtnShort: "テキスト",
  timingBtn: "変速",
  copyUrl: "URLをコピー",
  copyShort: "コピー",
  copied: "✓ コピー済",
  placeAt: (r) => `${r}分で配置`,
  shockMode: "ショック",
  shockModeActive: "ショック配置中",
  shockModeTitle: "ショックアロー配置モード",
  ghostMode: "空打ち",
  ghostModeActive: "空打ち配置中",
  ghostModeTitle: "空打ち配置モード (足の置き直し)",
  freezeMode: "フリーズ",
  freezeModeActive: "フリーズ配置中",
  freezeModeTitle: "フリーズアロー配置モード",
  hintFreezeStart: "フリーズの始点にしたいセルをタップしてください。",
  hintFreezeEnd: "同じ列の終点セルをタップするとフリーズを配置します (同じセルをタップでキャンセル、別の列なら始点を取り直し)。頭の矢印をタップすると削除できます。",
  hintShock: "グリッドをタップでショックアロー (⚡踏んではいけない全パネル) を配置・削除します。",
  hintGhost: "グリッドをタップで空打ち (◇判定のない踏み直し・足の置き直し) を配置・削除します。",
  hintNormal:
    "グリッドをタップでノーツを追加、ノーツをタップで削除。フリーズ中のセルは空打ち、終端は空打ちトグルになります。",
  timingPanelTitle: "変速・停止",
  timingPanelDesc: (
    <>
      ソフラン (途中変速) と停止を設定できます。拍はSMの <code>#BPMS</code> /{" "}
      <code>#STOPS</code> と同じ0起点のビート単位 (1小節=4拍) です。
      SMファイルごと「テキスト入力」に貼り付けると自動で取り込まれます。
    </>
  ),
  bpmField: "BPM変化 (初期BPM,拍:BPM,…)",
  stopsField: "停止 (拍:秒,…)",
  textPanelTitle: "テキスト入力",
  textPanelDesc: (
    <>
      SM/SSCファイルの <code>#NOTES</code> 以下のノートデータ (小節を <code>,</code> 区切り、
      1行4文字) を貼り付けて読み込めます。ファイル全体を貼ると <code>#BPMS</code> /{" "}
      <code>#STOPS</code> (ソフラン・停止) も自動で取り込みます。 Webにホストされた{" "}
      <code>.sm</code>/<code>.ssc</code> ファイルのURLを指定して直接読み込むこともできます。
    </>
  ),
  urlPlaceholder: "https://…/譜面ファイル.sm のURLから読み込む (オプション)",
  loadFromUrl: "URLから読み込み",
  loading: "取得中…",
  loadText: "この内容を読み込む",
  multiCharts: (ex) =>
    `複数の譜面が見つかりました。読み込む譜面を選んでください${ex > 0 ? ` (シングル以外の${ex}譜面は除外)` : ""}:`,
  noSingleCharts: "シングル (4パネル) の譜面が見つかりませんでした",
  fetchFailed: "取得に失敗しました。URLを確認してください",
  chartFallback: (i) => `譜面${i}`,
  optionsBtn: "オプション",
  optionsTitle: "オプション",
  hispeedLabel: "ハイスピード (縦縮尺)",
  hsScrollBpm: "見かけのスクロールBPM",
  transformLabel: "変形 (矢印の並べ替え)",
  transformOff: "OFF",
  transformRandomReroll: "タップするたびに並びを引き直します",
  transformCustom: "並びを自分で作る (2つタップで入れ替え)",
  close: "閉じる",
  clipBtn: "共有",
  clipTitle: "URLを共有",
  clipDesc: "この譜面のURLをコピーします。小節範囲を絞ると、その部分だけを切り出したクリップURLになります (変速・停止・足指定はシフトされ、ハイスピなどのオプションは引き継がれます)。",
  clipStart: "開始小節",
  clipEnd: "終了小節",
  clipNameLabel: "クリップ名 (コピー前に編集できます)",
  clipMeasures: (n) => `${n}小節`,
  clipCopy: "URLをコピー",
  clipCopied: "✓ コピーしました",
  clipRangeError: (max) => `1〜${max}の小節番号で、開始≦終了になるように入力してください`,
  imageBtnTitle: "譜面を画像で保存・共有",
  imageTitle: "画像を書き出し",
  imageDesc:
    "指定した小節範囲の譜面を、体の向きの色分けや足バッジ付きの画像にして保存・共有できます。",
  imageSave: "画像を保存・共有",
  imageSaving: "生成中…",
  imageSaved: "✓ 書き出しました",
  imagePerCol: "1列の小節数",
  videoBtnTitle: "譜面再生をショート動画で書き出し",
  videoTitle: "動画を書き出し (β)",
  videoDesc:
    "譜面の自動再生を動画にします。縦はショート向け (720×1280・等速)、横はじっくり観察向け (1920×1080・0.5倍速、注目コメントで一時停止)。録画は再生時間ぶんかかります。",
  videoUseMedia: "曲とジャケットを使う",
  videoAudioUrl: "音源 (ogg/mp3) のURL",
  videoJacketUrl: "ジャケット画像のURL (任意)",
  videoOffset: "オフセット秒 (1小節目の頭が音源の何秒目か)",
  videoExport: "動画を書き出し",
  videoRecording: (pct) => `録画中… ${pct}%`,
  videoDone: "✓ 書き出しました",
  videoThumb: "サムネ画像を書き出し",
  videoThumbDone: "✓ サムネを書き出しました",
  videoTplCopy: "動画概要をテキストでコピー",
  videoTplCopied: "✓ コピーしました",
  hlCommentPlaceholder: "コメント (動画の注目シーンで表示)",
  videoModePortrait: "縦 (ショート・等速)",
  videoModeLandscape: "横 (じっくり解説向け)",
  videoSpeedLabel: "収録速度",
  videoSpeedHalf: "0.5倍速 (じっくり)",
  videoSpeedFull: "等倍",
  videoCancel: "中止",
  rangePending: (p) => `始点: ${p} — 終点の位置をタップ`,
  rangeActive: (a, b) => `選択範囲: ${a}〜${b} (小節.拍)`,
  rangeClear: "解除",
  rangeCopy: "コピー",
  rangeCut: "切り取り",
  rangeDelete: "削除",
  rangePaste: "貼り付け",
  addMeasure: "小節追加",
  addMeasureTitle: "末尾に空の小節を1つ追加",
  metronomeTitle: "メトロノーム (4分のティック音)",
  aiGenBtn: "AIで譜面作成",
  aiModalTitle: "AIで譜面を作成",
  aiModalDesc:
    "作りたい譜面のイメージを書いて、相談するAIを選んでください。譜面URLの仕様を教えるプロンプト付きで外部のAIチャットが新しいタブで開き、会話の最後にこのアプリで開けるURLを受け取れます。",
  aiWishPlaceholder:
    "例: BPM170で8分メインの4小節。最後に16分の階段でラス殺しっぽく。激14ぐらい",
  aiOpenExternal: "外部サイトを開く",
  specLink: "URL仕様",
  spotlightBtn: "注目",
  spotlightTitle: "注目ノーツにする (黄色い枠で強調され、URLや画像に反映)",
  toStartTitle: "最初に戻る",
  playTitle: "再生 / 停止 (スペースキー)",
  clapTitle: "クラップ音",
  stompTitle: "空打ちのストンプ音",
  fsTitle: "フルスクリーン再生 (撮影モード)",
  hispeedTitle: "ハイスピ (縦縮尺)",
  prev: "◀ 前",
  next: "次 ▶",
  measureLabel: (n) => `${n}小節目`,
  shockArrow: "⚡ショックアロー",
  footL: "左",
  footR: "右",
  facingLabel: (d, deg) => `体の向き ${d === "R" ? "右" : "左"}${deg}°`,
  stepFootLabel: "踏む足:",
  handlingLabel: "捌き方:",
  centerBoth: "両足で中央",
  centerL: "Lで中央",
  centerR: "Rで中央",
  resetIgnore: "無視に戻す",
  resetAuto: "自動に戻す",
  bracketWith: (f) => `で2枚抜き`,
  footLBtn: "L 左",
  footRBtn: "R 右",
  holding: "フリーズ中:",
  overrideCount: (n) => `手動指定 ${n}件`,
  clearAll: "全て解除",
  tagShockGhost: "ショック: 中央空打ちで捌く",
  tagShockIgnore: "ショック: 無視 (踏まない)",
  tagGhostSwap: "空打ち (フリーズ持ち替え)",
  tagGhostReposition: "空打ち (足の置き直し)",
  tagBracket: "2枚抜き",
  tagJump: "ジャンプ",
  tagJack: "縦連 (同じ足)",
  tagCrossover: "交差 (体を捻る)",
  tagFootswitch: "踏み替え (スライド)",
  flagJack: "縦連",
  flagCross: "交差",
  flagSwitch: "踏替",
  badgeBoth: "◇両足",
  mineTitle: "地雷 (踏まない)",
  shockRowTitle: "ショックアロー (タップで捌き方を指定)",
  loadError: "譜面を読み込めませんでした",
  backToTop: "トップに戻る",
  helpTitle: "ヘルプ",
  footerContact: (
    <>
      機能要望・感想は{" "}
      <a href="https://x.com/MONO_DDR" target="_blank" rel="noopener noreferrer">
        @MONO_DDR
      </a>{" "}
      まで
    </>
  ),
};

const en: Strings = {
  untitled: "Untitled chart",
  leftFoot: "L foot",
  rightFoot: "R foot",
  quantSuffix: "th",
  facingLegend: "BG = body facing (L←→R)",
  steps: "STEPS",
  jumps: "JUMPS",
  jacks: "JACKS",
  crossovers: "CROSS",
  doubleSteps: "SWITCH",
  ghosts: "GHOST",
  shocks: "SHOCK",
  titlePlaceholder: "Enter a title",
  subtitlePlaceholder: "Artist name etc. (optional)",
  bgPickerTitle: "Customize background color",
  bgPickerTitleGrad1: "Gradient top-left color",
  bgPickerTitleGrad2: "Gradient bottom-right color",
  bgGradTitle: "Toggle two-color gradient",
  bgResetTitle: "Reset to default color",
  edit: "Edit",
  editing: "Editing",
  textBtn: "Text input",
  textBtnShort: "Text",
  timingBtn: "Timing",
  copyUrl: "Copy URL",
  copyShort: "Copy",
  copied: "✓ Copied",
  placeAt: (r) => `${r}th snap`,
  shockMode: "Shock",
  shockModeActive: "Placing shocks",
  shockModeTitle: "Shock arrow placement mode",
  ghostMode: "Ghost",
  ghostModeActive: "Placing ghosts",
  ghostModeTitle: "Ghost step placement mode (repositioning)",
  freezeMode: "Freeze",
  freezeModeActive: "Placing freeze",
  freezeModeTitle: "Freeze arrow placement mode",
  hintFreezeStart: "Tap the cell where the freeze should start.",
  hintFreezeEnd: "Tap the end cell in the same lane to place the freeze (same cell cancels, another lane re-anchors). Tap a freeze head arrow to delete it.",
  hintShock: "Tap the grid to place / remove a shock arrow (⚡ all panels, don't step).",
  hintGhost: "Tap the grid to place / remove a ghost step (◇ no judgment, re-step / reposition).",
  hintNormal:
    "Tap the grid to add notes, tap a note to remove it. Cells inside a freeze become ghost steps; the tail toggles a ghost.",
  timingPanelTitle: "Timing & Stops",
  timingPanelDesc: (
    <>
      Set mid-song BPM changes and stops. Beats are 0-based like SM&apos;s <code>#BPMS</code> /{" "}
      <code>#STOPS</code> (1 measure = 4 beats). Pasting a whole SM file into
      &quot;Text input&quot; imports them automatically.
    </>
  ),
  bpmField: "BPM changes (initial,beat:bpm,…)",
  stopsField: "Stops (beat:sec,…)",
  textPanelTitle: "Text input",
  textPanelDesc: (
    <>
      Paste the note data under <code>#NOTES</code> of an SM/SSC file (measures separated by{" "}
      <code>,</code>, 4 chars per row). Pasting the whole file also imports <code>#BPMS</code> /{" "}
      <code>#STOPS</code>. You can also load a hosted <code>.sm</code>/<code>.ssc</code> file
      directly by URL.
    </>
  ),
  urlPlaceholder: "Load from a .sm file URL (optional)",
  loadFromUrl: "Load from URL",
  loading: "Loading…",
  loadText: "Load this text",
  multiCharts: (ex) =>
    `Multiple charts found. Pick one to load${ex > 0 ? ` (${ex} non-single charts excluded)` : ""}:`,
  noSingleCharts: "No single (4-panel) charts found",
  fetchFailed: "Failed to fetch. Check the URL",
  chartFallback: (i) => `Chart ${i}`,
  optionsBtn: "Options",
  optionsTitle: "Options",
  hispeedLabel: "Hi-Speed (vertical scale)",
  hsScrollBpm: "Apparent scroll BPM",
  transformLabel: "Transform (arrow shuffle)",
  transformOff: "OFF",
  transformRandomReroll: "Tap again to reroll the arrangement",
  transformCustom: "Custom arrangement (tap two lanes to swap)",
  close: "Close",
  clipBtn: "Share",
  clipTitle: "Share URL",
  clipDesc: "Copies this chart's URL. Narrow the measure range to get a clip URL with only that part (timing and foot overrides are shifted; options like Hi-Speed are carried over).",
  clipStart: "First measure",
  clipEnd: "Last measure",
  clipNameLabel: "Clip name (edit before copying)",
  clipMeasures: (n) => `${n} measure${n === 1 ? "" : "s"}`,
  clipCopy: "Copy URL",
  clipCopied: "✓ Copied",
  clipRangeError: (max) => `Enter measure numbers between 1 and ${max}, with start ≤ end`,
  imageBtnTitle: "Save / share the chart as an image",
  imageTitle: "Export image",
  imageDesc:
    "Renders the selected measure range as an image with facing colors and foot badges, ready to save or share.",
  imageSave: "Save / share image",
  imageSaving: "Rendering…",
  imageSaved: "✓ Exported",
  imagePerCol: "Measures per column",
  videoBtnTitle: "Export playback as a short video",
  videoTitle: "Export video (beta)",
  videoDesc:
    "Renders the auto-play as a video. Portrait for Shorts (720×1280, 1×), landscape for study (1920×1080, 0.5× with spotlight comment pauses). Recording takes as long as the playback.",
  videoUseMedia: "Use song & jacket",
  videoAudioUrl: "Audio URL (ogg/mp3)",
  videoJacketUrl: "Jacket image URL (optional)",
  videoOffset: "Offset seconds (where measure 1 starts in the audio)",
  videoExport: "Export video",
  videoRecording: (pct) => `Recording… ${pct}%`,
  videoDone: "✓ Exported",
  videoThumb: "Export thumbnail image",
  videoThumbDone: "✓ Thumbnail exported",
  videoTplCopy: "Copy video summary as text",
  videoTplCopied: "✓ Copied",
  hlCommentPlaceholder: "Comment (shown at spotlight scenes in videos)",
  videoModePortrait: "Portrait (Shorts, 1×)",
  videoModeLandscape: "Landscape (study)",
  videoSpeedLabel: "Recording speed",
  videoSpeedHalf: "0.5× (study)",
  videoSpeedFull: "1×",
  videoCancel: "Cancel",
  rangePending: (p) => `Start: ${p} — tap the end position`,
  rangeActive: (a, b) => `Selection: ${a}–${b} (measure.beat)`,
  rangeClear: "Clear",
  rangeCopy: "Copy",
  rangeCut: "Cut",
  rangeDelete: "Delete",
  rangePaste: "Paste",
  addMeasure: "Add bar",
  addMeasureTitle: "Append an empty measure at the end",
  metronomeTitle: "Metronome (quarter-note ticks)",
  aiGenBtn: "Build with AI",
  aiModalTitle: "Build a chart with AI",
  aiModalDesc:
    "Describe the chart you want, then pick an AI to ask. An external AI chat opens in a new tab with a prompt that teaches it this app's URL format, and you'll get back a URL that opens here.",
  aiWishPlaceholder:
    "e.g. 4 measures at BPM 170, mostly 8th notes, ending with a 16th-note staircase",
  aiOpenExternal: "opens external site",
  specLink: "URL spec",
  spotlightBtn: "Spotlight",
  spotlightTitle: "Mark as a spotlight note (yellow frame, saved to URL and images)",
  toStartTitle: "Back to start",
  playTitle: "Play / pause (Space)",
  clapTitle: "Clap sound",
  stompTitle: "Ghost stomp sound",
  fsTitle: "Fullscreen playback (recording mode)",
  hispeedTitle: "Hi-Speed (vertical scale)",
  prev: "◀ Prev",
  next: "Next ▶",
  measureLabel: (n) => `Measure ${n}`,
  shockArrow: "⚡Shock arrow",
  footL: "L",
  footR: "R",
  facingLabel: (d, deg) => `Facing ${d}${deg}°`,
  stepFootLabel: "Foot:",
  handlingLabel: "Handling:",
  centerBoth: "Center w/ both",
  centerL: "Center w/ L",
  centerR: "Center w/ R",
  resetIgnore: "Reset to ignore",
  resetAuto: "Reset to auto",
  bracketWith: () => ` bracket`,
  footLBtn: "L Left",
  footRBtn: "R Right",
  holding: "Holding:",
  overrideCount: (n) => `${n} manual override${n === 1 ? "" : "s"}`,
  clearAll: "Clear all",
  tagShockGhost: "Shock: ghost-step the center",
  tagShockIgnore: "Shock: ignore (don't step)",
  tagGhostSwap: "Ghost step (freeze foot switch)",
  tagGhostReposition: "Ghost step (repositioning)",
  tagBracket: "Bracket",
  tagJump: "Jump",
  tagJack: "Jack (same foot)",
  tagCrossover: "Crossover (twist)",
  tagFootswitch: "Footswitch (slide)",
  flagJack: "jack",
  flagCross: "cross",
  flagSwitch: "sw",
  badgeBoth: "◇both",
  mineTitle: "Mine (don't step)",
  shockRowTitle: "Shock arrow (tap to set handling)",
  loadError: "Could not load the chart",
  backToTop: "Back to top",
  helpTitle: "Help",
  footerContact: (
    <>
      Requests &amp; feedback →{" "}
      <a href="https://x.com/MONO_DDR" target="_blank" rel="noopener noreferrer">
        @MONO_DDR
      </a>
    </>
  ),
};

const ko: Strings = {
  untitled: "제목 없는 채보",
  leftFoot: "왼발",
  rightFoot: "오른발",
  quantSuffix: "분",
  facingLegend: "배경=몸의 방향 (좌←→우)",
  steps: "스텝",
  jumps: "점프",
  jacks: "잭",
  crossovers: "크로스",
  doubleSteps: "풋스위치",
  ghosts: "헛밟기",
  shocks: "쇼크",
  titlePlaceholder: "제목 입력",
  subtitlePlaceholder: "아티스트명 등 (선택)",
  bgPickerTitle: "배경색 변경",
  bgPickerTitleGrad1: "그라데이션 왼쪽 위 색",
  bgPickerTitleGrad2: "그라데이션 오른쪽 아래 색",
  bgGradTitle: "2색 그라데이션 전환",
  bgResetTitle: "기본 색상으로 되돌리기",
  edit: "편집",
  editing: "편집 중",
  textBtn: "텍스트 입력",
  textBtnShort: "텍스트",
  timingBtn: "변속",
  copyUrl: "URL 복사",
  copyShort: "복사",
  copied: "✓ 복사됨",
  placeAt: (r) => `${r}분 배치`,
  shockMode: "쇼크",
  shockModeActive: "쇼크 배치 중",
  shockModeTitle: "쇼크 애로우 배치 모드",
  ghostMode: "헛밟기",
  ghostModeActive: "헛밟기 배치 중",
  ghostModeTitle: "헛밟기 배치 모드 (발 위치 조정)",
  freezeMode: "프리즈",
  freezeModeActive: "프리즈 배치 중",
  freezeModeTitle: "프리즈 애로우 배치 모드",
  hintFreezeStart: "프리즈 시작 셀을 탭하세요.",
  hintFreezeEnd: "같은 레인의 끝 셀을 탭하면 프리즈가 배치됩니다 (같은 셀은 취소, 다른 레인은 시작점 재설정). 머리 화살표를 탭하면 삭제됩니다.",
  hintShock: "그리드를 탭하여 쇼크 애로우 (⚡밟으면 안 되는 전체 패널) 를 배치·삭제합니다.",
  hintGhost: "그리드를 탭하여 헛밟기 (◇판정 없는 다시 밟기·발 위치 조정) 를 배치·삭제합니다.",
  hintNormal:
    "그리드를 탭하면 노트 추가, 노트를 탭하면 삭제. 프리즈 구간의 셀은 헛밟기, 끝부분은 헛밟기 토글이 됩니다.",
  timingPanelTitle: "변속·정지",
  timingPanelDesc: (
    <>
      변속과 정지를 설정할 수 있습니다. 박자는 SM의 <code>#BPMS</code> /{" "}
      <code>#STOPS</code> 와 같은 0 기준 비트 단위 (1마디=4박) 입니다. SM 파일 전체를 &quot;텍스트
      입력&quot;에 붙여넣으면 자동으로 가져옵니다.
    </>
  ),
  bpmField: "BPM 변화 (초기BPM,박:BPM,…)",
  stopsField: "정지 (박:초,…)",
  textPanelTitle: "텍스트 입력",
  textPanelDesc: (
    <>
      SM/SSC 파일의 <code>#NOTES</code> 아래 노트 데이터 (마디를 <code>,</code> 로 구분, 1행
      4글자) 를 붙여넣어 불러올 수 있습니다. 파일 전체를 붙여넣으면 <code>#BPMS</code> /{" "}
      <code>#STOPS</code> 도 자동으로 가져옵니다. 웹에 호스팅된 <code>.sm</code>/
      <code>.ssc</code> 파일의 URL로 직접 불러올 수도 있습니다.
    </>
  ),
  urlPlaceholder: ".sm 파일 URL에서 불러오기 (옵션)",
  loadFromUrl: "URL에서 불러오기",
  loading: "불러오는 중…",
  loadText: "이 내용 불러오기",
  multiCharts: (ex) =>
    `여러 채보를 찾았습니다. 불러올 채보를 선택하세요${ex > 0 ? ` (싱글 외 ${ex}개 제외)` : ""}:`,
  noSingleCharts: "싱글 (4패널) 채보를 찾지 못했습니다",
  fetchFailed: "불러오지 못했습니다. URL을 확인하세요",
  chartFallback: (i) => `채보 ${i}`,
  optionsBtn: "옵션",
  optionsTitle: "옵션",
  hispeedLabel: "하이스피드 (세로 배율)",
  hsScrollBpm: "체감 스크롤 BPM",
  transformLabel: "변형 (화살표 재배치)",
  transformOff: "OFF",
  transformRandomReroll: "탭할 때마다 배치를 다시 뽑습니다",
  transformCustom: "직접 배치 만들기 (두 개를 탭해 교체)",
  close: "닫기",
  clipBtn: "공유",
  clipTitle: "URL 공유",
  clipDesc: "이 채보의 URL을 복사합니다. 마디 범위를 좁히면 그 부분만 잘라낸 클립 URL이 됩니다 (변속·정지·발 지정은 이동되고, 하이스피드 등의 옵션은 이어집니다).",
  clipStart: "시작 마디",
  clipEnd: "끝 마디",
  clipNameLabel: "클립 이름 (복사 전에 수정 가능)",
  clipMeasures: (n) => `${n}마디`,
  clipCopy: "URL 복사",
  clipCopied: "✓ 복사됨",
  clipRangeError: (max) => `1〜${max} 사이의 마디 번호를 시작≦끝이 되도록 입력하세요`,
  imageBtnTitle: "채보를 이미지로 저장·공유",
  imageTitle: "이미지 내보내기",
  imageDesc:
    "지정한 마디 범위의 채보를 몸 방향 색상과 발 배지가 포함된 이미지로 저장·공유할 수 있습니다.",
  imageSave: "이미지 저장·공유",
  imageSaving: "생성 중…",
  imageSaved: "✓ 내보냈습니다",
  imagePerCol: "한 열의 마디 수",
  videoBtnTitle: "재생을 쇼트 동영상으로 내보내기",
  videoTitle: "동영상 내보내기 (β)",
  videoDesc:
    "자동 재생을 동영상으로 만듭니다. 세로는 쇼트용 (720×1280·1배속), 가로는 관찰용 (1920×1080·0.5배속, 주목 코멘트에서 일시정지). 녹화는 재생 시간만큼 걸립니다.",
  videoUseMedia: "곡·재킷 사용",
  videoAudioUrl: "음원 (ogg/mp3) URL",
  videoJacketUrl: "재킷 이미지 URL (선택)",
  videoOffset: "오프셋 초 (1마디 시작이 음원의 몇 초인지)",
  videoExport: "동영상 내보내기",
  videoRecording: (pct) => `녹화 중… ${pct}%`,
  videoDone: "✓ 내보냈습니다",
  videoThumb: "썸네일 이미지 내보내기",
  videoThumbDone: "✓ 썸네일을 내보냈습니다",
  videoTplCopy: "동영상 개요를 텍스트로 복사",
  videoTplCopied: "✓ 복사했습니다",
  hlCommentPlaceholder: "코멘트 (동영상 주목 장면에 표시)",
  videoModePortrait: "세로 (쇼트·1배속)",
  videoModeLandscape: "가로 (관찰용)",
  videoSpeedLabel: "녹화 속도",
  videoSpeedHalf: "0.5배속 (관찰)",
  videoSpeedFull: "1배속",
  videoCancel: "중지",
  rangePending: (p) => `시작: ${p} — 끝 위치를 탭`,
  rangeActive: (a, b) => `선택 범위: ${a}〜${b} (마디.박)`,
  rangeClear: "해제",
  rangeCopy: "복사",
  rangeCut: "잘라내기",
  rangeDelete: "삭제",
  rangePaste: "붙여넣기",
  addMeasure: "마디 추가",
  addMeasureTitle: "끝에 빈 마디를 1개 추가",
  metronomeTitle: "메트로놈 (4분 틱 사운드)",
  aiGenBtn: "AI 채보 생성",
  aiModalTitle: "AI로 채보 만들기",
  aiModalDesc:
    "원하는 채보의 이미지를 적고 상담할 AI를 선택하세요. 이 앱의 URL 사양을 알려주는 프롬프트와 함께 외부 AI 채팅이 새 탭에서 열리고, 대화 끝에 여기서 열 수 있는 URL을 받게 됩니다.",
  aiWishPlaceholder: "예: BPM 170, 8분 위주 4마디. 마지막에 16분 계단",
  aiOpenExternal: "외부 사이트 열기",
  specLink: "URL 사양",
  spotlightBtn: "주목",
  spotlightTitle: "주목 노트로 표시 (노란 테두리로 강조, URL·이미지에 반영)",
  toStartTitle: "처음으로",
  playTitle: "재생 / 정지 (스페이스)",
  clapTitle: "클랩 사운드",
  stompTitle: "헛밟기 스톰프 사운드",
  fsTitle: "전체화면 재생 (촬영 모드)",
  hispeedTitle: "하이스피드 (세로 배율)",
  prev: "◀ 이전",
  next: "다음 ▶",
  measureLabel: (n) => `${n}마디`,
  shockArrow: "⚡쇼크 애로우",
  footL: "L",
  footR: "R",
  facingLabel: (d, deg) => `몸 방향 ${d === "R" ? "우" : "좌"}${deg}°`,
  stepFootLabel: "밟는 발:",
  handlingLabel: "처리:",
  centerBoth: "중앙 양발",
  centerL: "중앙 L",
  centerR: "중앙 R",
  resetIgnore: "무시로 되돌리기",
  resetAuto: "자동으로 되돌리기",
  bracketWith: () => ` 브라켓`,
  footLBtn: "L 왼발",
  footRBtn: "R 오른발",
  holding: "프리즈 중:",
  overrideCount: (n) => `수동 지정 ${n}개`,
  clearAll: "모두 해제",
  tagShockGhost: "쇼크: 중앙 헛밟기로 처리",
  tagShockIgnore: "쇼크: 무시 (밟지 않음)",
  tagGhostSwap: "헛밟기 (프리즈 발 전환)",
  tagGhostReposition: "헛밟기 (발 위치 조정)",
  tagBracket: "브라켓",
  tagJump: "점프",
  tagJack: "잭 (같은 발)",
  tagCrossover: "크로스오버 (몸 비틀기)",
  tagFootswitch: "풋스위치 (슬라이드)",
  flagJack: "잭",
  flagCross: "크로스",
  flagSwitch: "전환",
  badgeBoth: "◇양발",
  mineTitle: "지뢰 (밟지 않음)",
  shockRowTitle: "쇼크 애로우 (탭하여 처리 지정)",
  loadError: "채보를 불러오지 못했습니다",
  backToTop: "처음으로",
  helpTitle: "도움말",
  footerContact: (
    <>
      기능 요청·피드백 →{" "}
      <a href="https://x.com/MONO_DDR" target="_blank" rel="noopener noreferrer">
        @MONO_DDR
      </a>
    </>
  ),
};

export const STRINGS: Record<Lang, Strings> = { ja, en, ko };
