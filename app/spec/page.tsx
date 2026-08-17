import type { Metadata } from "next";

// URLパラメータ仕様の静的ページ。人間にもAI (ブラウジング) にも読める形で公開する
export const metadata: Metadata = {
  title: "URLパラメータ仕様 | Step Analyzer",
  description:
    "Step AnalyzerのURLクエリパラメータ仕様。nパラメータの譜面フォーマットやBPM・難易度・注目コメントの指定方法。",
};

const PARAMS: { name: string; desc: string }[] = [
  {
    name: "n (必須)",
    desc: "譜面データ。小節を「-」で区切る。各小節は「1行=4文字 (←↓↑→の順)」を行数ぶん連結した文字列で、行数がその小節の分割数 (4行=4分、8行=8分、12行=12分、16行=16分。4の倍数のみ)。文字: 0=なし / 1=ノーツ / 2=フリーズ開始 / 3=フリーズ終了 (同じ列の2とペア) / M=ショックアロー (行全体をMMMMにする)",
  },
  { name: "t", desc: "曲名 (URLエンコード)" },
  { name: "st", desc: "アーティスト名 (URLエンコード)" },
  {
    name: "b",
    desc: "BPM。単一なら b=150。変速は「開始BPM,拍:新BPM」を,区切りで b=150,32:75",
  },
  { name: "s", desc: "停止。「拍:秒」を,区切りで s=48:0.5" },
  {
    name: "df",
    desc: "難易度。1文字目がクラス (0=習 / 1=楽 / 2=踊 / 3=激 / 4=鬼 / x=指定なし)、続けて1〜20のレベル。例: df=317 = 踊の17",
  },
  { name: "hl", desc: "注目ノーツ。tick (拍×48) を-区切り" },
  { name: "hc", desc: "注目ノーツのコメント。「tick:base64urlテキスト」を,区切り" },
  { name: "f", desc: "足の手動指定。「tick+L/R/LL/RR/C/CL/CR」を-区切り" },
  { name: "hs", desc: "ハイスピード (0.25〜6、0.05刻み)" },
  { name: "sp", desc: "再生速度 (0.25 / 0.5 / 0.75 / 1)" },
  {
    name: "c",
    desc: "背景色 (6桁hex、#なし)。c=1a2a6c-e94560 のように2色をハイフンで繋ぐと左上→右下のグラデーション",
  },
  { name: "l", desc: "言語 (ja / en / ko)" },
  { name: "tr", desc: "変形 (mirror / left / right / 4桁の並べ替え)" },
  { name: "d", desc: "nのdeflate圧縮版 (base64url)。共有URLの短縮用で、手書きする場合はnを使う" },
];

export default function SpecPage() {
  return (
    <main className="container">
      <header className="site-header">
        <h1>
          <a href="/">Step Analyzer</a>
        </h1>
      </header>
      <div className="card">
        <h2 className="spec-h">URLパラメータ仕様</h2>
        <p className="hint">
          Step Analyzerは譜面データをすべてURLクエリパラメータに載せます。この仕様に従って
          URLを組み立てれば、任意の譜面を開くリンクを生成できます (AIによる生成にも対応)。
        </p>
        <dl className="spec-list">
          {PARAMS.map((p) => (
            <div key={p.name} className="spec-row">
              <dt>{p.name}</dt>
              <dd>{p.desc}</dd>
            </div>
          ))}
        </dl>
        <h2 className="spec-h">例</h2>
        <ul className="spec-examples">
          <li>
            4分の階段1小節 (←↓↑→): <code>?n=1000010000100001</code>
          </li>
          <li>
            8分で8ノーツの1小節: <code>?n=10000100001000011000010000100001</code>
          </li>
          <li>
            ジャンプ (←+→の同時踏み) は行を <code>1001</code> にする
          </li>
          <li>
            フリーズ (↓を伸ばす): <code>0200</code> の行の後、終えたい行を <code>0300</code>
          </li>
          <li>
            曲情報付き:{" "}
            <code>{"?n=1000010000100001-1001000001000010&b=150&t=Practice&df=317"}</code>
          </li>
        </ul>
        <p className="hint">
          機械可読版: <a href="/llms.txt">/llms.txt</a>
        </p>
      </div>
    </main>
  );
}
