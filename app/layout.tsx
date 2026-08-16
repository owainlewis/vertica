import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vertica — LinkedIn carousel studio",
  description: "Turn ideas into polished LinkedIn carousels and export them as PDFs.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
