import type { Metadata } from "next";
import Viewer from "@/components/Viewer";
import { SAMPLE_BPM, SAMPLE_COMPACT, SAMPLE_TITLE } from "@/lib/sample";

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
  const isDefault = !n;

  return (
    <main className="container">
      <header className="site-header">
        <h1>
          <a href="/">Step Analyzer</a>
        </h1>
        <span className="tagline">DDR読譜トレーナー — 譜面の足割りを可視化して共有</span>
      </header>
      <Viewer
        key={n ?? "default"}
        compact={n ?? SAMPLE_COMPACT}
        title={isDefault ? SAMPLE_TITLE : t}
        bpm={isDefault ? SAMPLE_BPM : b}
        overrides={f}
        showAbout={isDefault}
      />
    </main>
  );
}
