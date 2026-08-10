import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Step Analyzer — DDR読譜トレーナー",
    short_name: "StepAnalyzer",
    description:
      "DDRの譜面の一部をURLで共有し、左右どちらの足でどのパネルを踏むべきかを可視化するツール",
    start_url: "/",
    display: "standalone",
    background_color: "#29d6a2",
    theme_color: "#29d6a2",
    icons: [
      { src: "/api/icon?s=192", sizes: "192x192", type: "image/png" },
      { src: "/api/icon?s=512", sizes: "512x512", type: "image/png" },
    ],
  };
}
