import type { Metadata } from "next";
import Viewer from "@/components/Viewer";
import { decompressCompact } from "@/lib/codec-server";
import { STRINGS, normalizeLang } from "@/lib/i18n";
import { parseTransform } from "@/lib/transform";
import {
  SAMPLE_BPM,
  SAMPLE_COMMENTS,
  SAMPLE_COMPACT,
  SAMPLE_HIGHLIGHTS,
  SAMPLE_SUBTITLE,
  SAMPLE_TITLE,
} from "@/lib/sample";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function pick(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// n (生データ) / d (deflate圧縮) のどちらかから譜面を取り出す
function resolveChart(sp: { [key: string]: string | string[] | undefined }): {
  n: string | undefined;
  ogParam: { key: "n" | "d"; value: string } | null;
} {
  const rawN = pick(sp.n);
  const d = pick(sp.d);
  if (rawN) return { n: rawN, ogParam: { key: "n", value: rawN } };
  if (d) {
    try {
      return { n: decompressCompact(d), ogParam: { key: "d", value: d } };
    } catch {
      return { n: undefined, ogParam: null };
    }
  }
  return { n: undefined, ogParam: null };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const sp = await searchParams;
  const { n, ogParam } = resolveChart(sp);
  const t = pick(sp.t);
  const st = pick(sp.st);
  const b = pick(sp.b);
  const f = pick(sp.f);
  const c = pick(sp.c);
  const tr = pick(sp.tr);
  // 背景色カスタム時はファビコン/ホーム画面アイコンも同じ色にする
  const bgOk = c && /^[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : undefined;
  const icons = bgOk
    ? {
        icon: [
          { url: `/api/icon?s=64&c=${bgOk}`, type: "image/png", sizes: "64x64" },
        ],
        apple: [{ url: `/api/icon?s=180&c=${bgOk}`, sizes: "180x180" }],
      }
    : undefined;

  if (!n || !ogParam) {
    return {
      title: "Step Analyzer — DDR読譜トレーナー",
      description:
        "DDRの譜面の一部をURLで共有し、左右どちらの足でどのパネルを踏むべきかを可視化するツール",
      ...(icons ? { icons } : {}),
    };
  }

  const title = t
    ? `${t}${st ? ` — ${st}` : ""} | Step Analyzer`
    : "DDR譜面の足割り解析 | Step Analyzer";
  const bpmLabel = b ? (/[,:]/.test(b) ? `BPM ${b.split(",")[0]}〜 変速` : `BPM ${b}`) : "";
  const description = `この譜面部分をどの足で踏むべきかを可視化${bpmLabel ? ` (${bpmLabel})` : ""}。矢印をタップして足運びを確認できます。`;

  const qs = new URLSearchParams();
  qs.set(ogParam.key, ogParam.value);
  if (t) qs.set("t", t);
  if (f) qs.set("f", f);
  if (c && /^[0-9a-fA-F]{6}$/.test(c)) qs.set("c", c.toLowerCase());
  if (tr && parseTransform(tr)) qs.set("tr", tr);
  const ogUrl = `/og?${qs.toString()}`;

  return {
    title,
    description,
    ...(icons ? { icons } : {}),
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
  const { n } = resolveChart(sp);
  const t = pick(sp.t);
  const st = pick(sp.st);
  const df = pick(sp.df);
  const b = pick(sp.b);
  const s = pick(sp.s);
  const f = pick(sp.f);
  const hl = pick(sp.hl);
  const hc = pick(sp.hc);
  const hs = pick(sp.hs);
  const spd = pick(sp.sp);
  const c = pick(sp.c);
  const bg = c && /^[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : undefined;
  const lang = normalizeLang(pick(sp.l));
  const tr = pick(sp.tr);
  const isDefault = !n;

  return (
    <main className="container">
      {/* SSR時から背景色を適用してチラつきを防ぐ */}
      {bg && <style>{`:root{--page-bg:#${bg};}`}</style>}
      <header className="site-header">
        <h1>
          <a href="/">Step Analyzer</a>
        </h1>
      </header>
      <Viewer
        key={n ?? "default"}
        compact={n ?? SAMPLE_COMPACT}
        title={isDefault ? SAMPLE_TITLE : t}
        subtitle={isDefault ? SAMPLE_SUBTITLE : st}
        difficulty={isDefault ? undefined : df}
        bpm={isDefault ? SAMPLE_BPM : b}
        stops={isDefault ? undefined : s}
        overrides={f}
        highlights={isDefault ? SAMPLE_HIGHLIGHTS : hl}
        comments={isDefault ? SAMPLE_COMMENTS : hc}
        hispeed={hs}
        speed={spd}
        bg={bg}
        lang={lang}
        transform={tr}
      />
      <footer className="site-footer">
        {STRINGS[lang].footerContact}
        {" · "}
        <a href="/spec">{STRINGS[lang].specLink}</a>
      </footer>
    </main>
  );
}
