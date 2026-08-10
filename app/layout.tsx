import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { Anton, Ultra } from "next/font/google";
import "./globals.css";

// 統計数字・fsタイトル用の極太コンデンス
const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-logo" });
// サイトロゴ用のファットフェイスセリフ
const ultra = Ultra({ weight: "400", subsets: ["latin"], variable: "--font-title" });

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Step Analyzer — DDR読譜トレーナー",
  description:
    "DDRの譜面の一部をURLで共有し、左右どちらの足でどのパネルを踏むべきかを可視化するツール",
  appleWebApp: {
    capable: true,
    title: "StepAnalyzer",
    statusBarStyle: "black-translucent",
  },
  // アイコンは動的ルートから配信 (c=で背景色カスタム可能)
  icons: {
    icon: [{ url: "/api/icon?s=64", type: "image/png", sizes: "64x64" }],
    apple: [{ url: "/api/icon?s=180", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#29d6a2",
  width: "device-width",
  initialScale: 1,
  // iOSの入力フォーカス時の自動ズームとダブルタップズームを抑止する。
  // (iOS 10以降、ユーザーのピンチズーム自体はこの指定があっても可能)
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${anton.variable} ${ultra.variable}`}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
