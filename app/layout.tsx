import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "MT5 — Human Demand Meme Index",
    description:
      "直近30分で多くの推定ユーザーが買ったミームコイン5銘柄を、リアルタイム時価総額加重で追跡する研究指数。",
    icons: {
      icon: "/mt5-brand.jpeg",
      shortcut: "/mt5-brand.jpeg",
    },
    openGraph: {
      title: "MT5 — Human Demand Meme Index",
      description: "ウォレットではなく、人の買いを測る。",
      type: "website",
      locale: "ja_JP",
      images: [
        {
          url: "/og.png",
          width: 1760,
          height: 920,
          alt: "MT5 Meme Top 5 Index",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "MT5 — Human Demand Meme Index",
      description: "ウォレットではなく、人の買いを測る。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
