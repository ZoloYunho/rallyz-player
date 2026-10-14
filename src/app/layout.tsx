import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderUser } from "@/components/header-user";
import { mainSiteUrl, siteUrl } from "@/lib/supabase/env";
import "@fontsource-variable/dm-sans";
import "@fontsource/oswald/700.css";
import { MainNav } from "@/components/main-nav";
import { DEFAULT_SPORT } from "@/lib/sports";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Rallyz — Tennis in Bangkok", template: "%s · Rallyz" },
  description: "Find tennis games, instructors and players at your level in Bangkok.",
};

export const viewport: Viewport = { themeColor: "#0f6e56" };

// Same links, in the same order, as the main rallyz.club navbar.
const nav = [
  { href: mainSiteUrl(), label: "Courts" },
  { href: `/${DEFAULT_SPORT}/events`, label: "Events" },
  { href: `/${DEFAULT_SPORT}/instructors`, label: "Instructors" },
  { href: `/${DEFAULT_SPORT}/partner`, label: "Find partner" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${GeistMono.variable} min-h-dvh antialiased`}>
        <header className="sticky top-0 z-30 border-b border-line bg-white">
          <div className="flex h-16 items-center gap-4 px-4 md:grid md:grid-cols-[1fr_auto_1fr] md:px-8">
            <Link href={mainSiteUrl()} aria-label="Rallyz home" className="font-logo text-[28px] leading-none font-bold tracking-tight text-ink">
              Rall<span className="text-court">yz</span>
            </Link>
            <MainNav items={nav} className="hidden items-center gap-12 md:flex" />
            <div className="ml-auto flex items-center justify-end">
              <Suspense fallback={<div className="h-10 w-40" />}>
                <HeaderUser />
              </Suspense>
            </div>
          </div>
          <MainNav items={nav} className="flex gap-6 overflow-x-auto border-t border-line px-4 py-2.5 md:hidden" />
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
          Rallyz · Tennis in Bangkok · Times shown in Bangkok time ·{" "}
          <Link href={`/${DEFAULT_SPORT}/levels`} className="underline hover:text-ink">How levels work</Link>
        </footer>
      </body>
    </html>
  );
}
