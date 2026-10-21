import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mystery Match — meet the mind first",
  description: "A more thoughtful way to meet, starting with a conversation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
