import type { Metadata } from "next";
import Editor from "@/components/Editor";
import Viewer from "@/components/Viewer";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function pick(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const n = pick(sp.n);
  const t = pick(sp.t);
  const b = pick(sp.b);
  const f = pick(sp.f);

  if (!n) {
    return {
      title: "Step Analyzer — DDR読譜トレーナー",
      description:
        "DDRの譜面の一部をURLで共有し、左右どちらの足でどのパネルを踏むべきかを可視化するツール",
    };
  }

  const title = t ? `${t} | Step Analyzer` : "DDR譜面の足割り解析 | Step Analyzer";
  const description = `この譜面部分をどの足で踏むべきかを可視化${b ? ` (BPM ${b})` : ""}。矢印をタップして足運びを確認できます。`;

  const qs = new URLSearchParams();
  qs.set("n", n);
  if (t) qs.set("t", t);
  if (f) qs.set("f", f);
  const ogUrl = `/og?${qs.toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogUrl],
    },
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const n = pick(sp.n);
  const t = pick(sp.t);
  const b = pick(sp.b);
  const f = pick(sp.f);

  return (
    <main className="container">
      <header className="site-header">
        <h1>
          <a href="/">Step Analyzer</a>
        </h1>
        <span className="tagline">DDR読譜トレーナー — 譜面の足割りを可視化して共有</span>
      </header>

      {n ? (
        <Viewer compact={n} title={t} bpm={b} overrides={f} />
      ) : (
        <>
          <Editor />
          <div className="card">
            <h2>このツールについて</h2>
            <p className="hint">
              譜面の一部をURLパラメータに載せて共有できる読譜練習ツールです。
              交互踏みを基本に、各ノートを左右どちらの足で踏むべきかを自動で割り当てて表示します
              (縦連は同じ足、ジャンプは両足、交差が必要な箇所にはマークが付きます)。
              <br />
              生成されたURLをXなどのSNSに貼ると、譜面のプレビュー画像 (OGP)
              が自動で展開されるので、「ここどう踏む?」という議論がしやすくなります。
              <br />
              URL形式: <code>/?n=小節1-小節2-…</code> (各小節は1行4文字のノートを連結した{" "}
              <code>0134M</code> の列)、<code>t=</code> タイトル、<code>b=</code> BPM。
            </p>
          </div>
        </>
      )}
    </main>
  );
}
