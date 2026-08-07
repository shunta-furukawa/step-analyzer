"use client";

import { useState } from "react";
import { normalizeNotesInput, buildShareUrl } from "@/lib/url";

// 3icecreamのチャート画像 (45〜48小節) を書き起こしたサンプル。
// 16分の階段、12分のトリプレット、フリーズアローを含む。
const SAMPLE = `1000
0010
0100
0000
1000
0001
0010
0000
0100
0001
0010
0000
0100
0001
0100
0000
,
1000
0100
0010
0000
1000
0010
0001
0000
1000
0010
0100
0000
1000
0100
0001
0000
,
1000
0100
1000
0010
0100
0010
0100
0001
0100
0001
1000
0001
,
2000
0000
0000
0000
3000
0000
0000
0000
`;

export default function Editor() {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [bpm, setBpm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = (): string | null => {
    setError(null);
    setWarning(null);
    setCopied(false);
    try {
      const result = normalizeNotesInput(text);
      if (result.warning) setWarning(result.warning);
      const u = buildShareUrl(
        window.location.origin,
        result.compact,
        title.trim() || undefined,
        bpm.trim() || undefined
      );
      setUrl(u);
      return u;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUrl(null);
      return null;
    }
  };

  const open = () => {
    const u = generate();
    if (u) window.location.href = u;
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  return (
    <div className="card">
      <h2>譜面を入力</h2>
      <p className="hint" style={{ marginBottom: 10 }}>
        SM/SSCファイルの <code>#NOTES</code> 以下のノートデータ (小節を <code>,</code>{" "}
        区切り、1行4文字の <code>0</code>/<code>1</code>/<code>2</code>/<code>3</code>
        ) を貼り付けてください。練習したい部分だけの抜粋でOKです。
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"1000\n0100\n0010\n0001\n,\n..."}
        spellCheck={false}
      />
      <div className="form-row">
        <input
          type="text"
          placeholder="曲名・ラベル (任意)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          type="text"
          placeholder="BPM (任意)"
          value={bpm}
          onChange={(e) => setBpm(e.target.value)}
          style={{ width: 110 }}
        />
      </div>
      <div className="form-row">
        <button onClick={open}>譜面を解析して表示</button>
        <button className="secondary" onClick={generate}>
          共有URLだけ生成
        </button>
        <button className="secondary" onClick={() => setText(SAMPLE)}>
          サンプル譜面を入れる
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {warning && <p className="warning">{warning}</p>}
      {url && (
        <div className="share-url">
          <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className="secondary" onClick={copy}>
            {copied ? "コピーしました" : "コピー"}
          </button>
        </div>
      )}
    </div>
  );
}
