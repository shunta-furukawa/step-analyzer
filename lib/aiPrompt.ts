// 外部のチャットAIに譜面URLを作ってもらうためのプロンプトとリンク生成。
// URL仕様をプロンプトに埋め込んでおき、ユーザーはAI側で要望を話すだけで
// Step Analyzerで開けるURLを受け取れる。

export const SITE_ORIGIN = "https://step-analyzer-beta.vercel.app";

// llms.txt・/specページと同じ内容のミニ仕様書 (プロンプト用に圧縮)
const URL_SPEC = `# Step Analyzer URL仕様
ベース: ${SITE_ORIGIN}/
- n: 譜面データ (必須)。小節を「-」で区切る。各小節は「1行=4文字 (←↓↑→の順)」を行数ぶん連結した文字列。行数がその小節の分割数 (4行=4分, 8行=8分, 12行=12分, 16行=16分。4の倍数のみ)。文字: 0=なし, 1=ノーツ, 2=フリーズ開始, 3=フリーズ終了 (同じ列の2とペア), M=その行全体がショックアロー (MMMM)
- t: 曲名 / st: アーティスト名 (URLエンコード)
- b: BPM (例 b=150。変速は「開始BPM,拍:新BPM」を,区切りで b=150,32:75)
- df: 難易度。1文字目=クラス (0=習,1=楽,2=踊,3=激,4=鬼,x=指定なし)、続けてレベル (例 df=317 = 踊の17)

## 例
- 4分の階段1小節 (←↓↑→): n=1000010000100001
- 8分で8ノーツの1小節 (←↓↑→←↓↑→): n=10000100001000011000010000100001
- ジャンプ (←+→同時): 行を 1001 にする
- フリーズ (↓を1拍伸ばす): 0200 の行の後、終わりたい行を 0300
- 完成形: ${SITE_ORIGIN}/?n=1000010000100001-1001000001000010&b=150&t=Practice`;

const TASK = `あなたはDDR (Dance Dance Revolution) の譜面を作るアシスタントです。上の仕様に従って、ユーザーの要望 (雰囲気・BPM・長さ・難易度など) を聞き、踏める自然な譜面を設計して、最後にStep Analyzerで開けるURLを1本プレーンテキストで出力してください。同時押しは2枚まで、同じ足が連続しすぎない交互踏みを基本にすること。まず「どんな譜面を作りますか？」と聞いてください。`;

export const AI_PROMPT = `${URL_SPEC}\n\n${TASK}`;

export const AI_SERVICES: { key: string; label: string; url: (p: string) => string }[] = [
  { key: "chatgpt", label: "ChatGPT", url: (p) => `https://chatgpt.com/?prompt=${p}` },
  { key: "claude", label: "Claude", url: (p) => `https://claude.ai/new?q=${p}` },
  {
    key: "perplexity",
    label: "Perplexity",
    url: (p) => `https://www.perplexity.ai/search?q=${p}`,
  },
];

export function aiPromptUrl(service: (typeof AI_SERVICES)[number]): string {
  return service.url(encodeURIComponent(AI_PROMPT));
}
