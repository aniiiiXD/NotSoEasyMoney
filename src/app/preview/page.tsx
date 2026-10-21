import type { Metadata } from "next";
import Preview from "./preview";

export const metadata: Metadata = {
  title: "Interactive demo · Mystery Match",
  description: "Explore a fictional Mystery Match introduction and conversation.",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <Preview />;
}
