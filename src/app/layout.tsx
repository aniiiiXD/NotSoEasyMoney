import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mystery Match: blind dating, no photos",
  description: "Stop swiping. Answer a few questions and we match you with someone whose personality fits yours. No photos, just conversation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
