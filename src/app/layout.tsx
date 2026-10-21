import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mystery Match: blind dating, no photos",
  description: "Answer one questionnaire, get matched by vector similarity, and talk before you ever swap socials. No photos, ever.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
