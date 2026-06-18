import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimArbiter · Claim adjudication on Band",
  description:
    "From claim to verdict in minutes. Agents intake the claim, auto-classify its domain, recruit the matching property, medical, or legal specialist, and return a verdict for a human to sign, with Band as the system of record.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0c0e15",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Fonts loaded via <link> rather than next/font for build portability. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Schibsted+Grotesk:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --font-space: "Schibsted Grotesk";
            --font-mono-real: "JetBrains Mono";
          }
        `}</style>
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
