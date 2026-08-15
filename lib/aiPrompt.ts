// 外部のチャットAIに譜面URLを作ってもらうためのプロンプトとリンク生成。
// URL仕様をプロンプトに埋め込んでおき、ユーザーはAI側で要望を話すだけで
// Step Analyzerで開けるURLを受け取れる。

export const SITE_ORIGIN = "https://step-analyzer-beta.vercel.app";

// 詳細仕様はllms.txtに寄せ、プロンプトは「まず取得して読む」指示+
// 取得できない場合の最小フォールバックだけにする。
// 具体的な譜面パターン例をプロンプトに置くと生成がそれに引っ張られる
// (例: 階段ばかりになる) ため、書式の最小限にとどめる
const TASK_COMMON = `あなたはDDR (Dance Dance Revolution) の譜面を作るアシスタントです。
まず ${SITE_ORIGIN}/llms.txt を取得して、Step AnalyzerのURLパラメータ仕様 (特にnパラメータの譜面書式) と譜面生成ガイドラインを読み込んでください。
取得できない場合のみ、次の最小仕様を使うこと:
- n: 小節を「-」区切り。各小節は「1行=4文字 (←↓↑→の順)」×行数 (4の倍数。行数=その小節の分割数)。0=なし, 1=ノーツ, 2=フリーズ開始, 3=フリーズ終了(同列の2とペア), M=ショック行(MMMM)
- t=曲名, st=アーティスト, b=BPM (変速は「開始BPM,拍:新BPM」を,区切り。例 b=150,32:75), s=停止 (拍:秒), df=難易度 (クラス0習/1楽/2踊/3激/4鬼またはx+レベル数字)
設計は左右交互で踏めることを最優先に、同時押しは2枚まで。階段に限らず要望に合ったパターンを多様に使うこと。
最後に ${SITE_ORIGIN}/?n=... のURLを1本、プレーンテキストで出力してください。`;

/** 要望テキスト入りのプロンプトを組む (空なら要望をAI側で聞いてもらう) */
export function buildAiPrompt(wish: string): string {
  const w = wish.trim();
  return w
    ? `${TASK_COMMON}\n\nユーザーの要望: 「${w}」\n追加の質問はせず、この要望で譜面を作ってURLを出力してください。`
    : `${TASK_COMMON}\n\nまず「どんな譜面を作りますか？ (雰囲気・BPM・長さ・難易度など)」と聞いてください。`;
}

export interface AiService {
  key: string;
  label: string;
  host: string; // ファビコン取得用
  url: (p: string) => string;
}

export const AI_SERVICES: AiService[] = [
  {
    key: "chatgpt",
    label: "ChatGPT",
    host: "chatgpt.com",
    url: (p) => `https://chatgpt.com/?prompt=${p}`,
  },
  {
    key: "claude",
    label: "Claude",
    host: "claude.ai",
    url: (p) => `https://claude.ai/new?q=${p}`,
  },
  {
    key: "perplexity",
    label: "Perplexity",
    host: "www.perplexity.ai",
    url: (p) => `https://www.perplexity.ai/search?q=${p}`,
  },
];

export function aiPromptUrl(service: AiService, wish = ""): string {
  return service.url(encodeURIComponent(buildAiPrompt(wish)));
}

/** サービスのアイコンURL (Googleのfaviconプロキシ経由) */
export function aiServiceIcon(service: AiService): string {
  return `https://www.google.com/s2/favicons?domain=${service.host}&sz=64`;
}
