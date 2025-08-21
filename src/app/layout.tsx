// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";                 // ⬅️ 這行一定要有
import PwaProvider from "./pwa-provider";

export const metadata: Metadata = {
  title: "RS Baseball Manager",
  description: "Team stats & box score manager",
  themeColor: "#08213A",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" }
    ],
    apple: [
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" }
    ]
  },
  appleWebApp: { capable: true, title: "RS Baseball Manager", statusBarStyle: "default" }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <PwaProvider />
        {children}
      </body>
    </html>
  );
}
