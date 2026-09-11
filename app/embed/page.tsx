import type { Metadata } from "next";
import Page from "../page";

export const metadata: Metadata = {
  title: "踏み順プレイヤー | Step Analyzer",
  robots: { index: false, follow: false },
};

export default async function EmbedPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Page searchParams={Promise.resolve({ ...await searchParams, embed: "1" })} />;
}
