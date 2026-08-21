import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "bots — studio",
  description: "Design a pet, feed it your documents, embed it anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
