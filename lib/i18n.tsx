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
  bgPickerTitle: string;
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
  transformLabel: string;
  transformOff: string;
  transformRandomReroll: string;
  close: string;
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
  bgPickerTitle: "背景色をカスタマイズ",
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
  transformLabel: "変形 (矢印の並べ替え)",
  transformOff: "OFF",
  transformRandomReroll: "タップするたびに並びを引き直します",
  close: "閉じる",
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
  bgPickerTitle: "Customize background color",
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
  transformLabel: "Transform (arrow shuffle)",
  transformOff: "OFF",
  transformRandomReroll: "Tap again to reroll the arrangement",
  close: "Close",
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
  bgPickerTitle: "배경색 변경",
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
  transformLabel: "변형 (화살표 재배치)",
  transformOff: "OFF",
  transformRandomReroll: "탭할 때마다 배치를 다시 뽑습니다",
  close: "닫기",
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
