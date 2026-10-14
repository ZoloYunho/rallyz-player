import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderUser } from "@/components/header-user";
import { mainSiteUrl, siteUrl } from "@/lib/supabase/env";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Rallyz — Tennis in Bangkok", template: "%s · Rallyz" },
  description: "Find tennis games, instructors and players at your level in Bangkok.",
};

export const viewport: Viewport = { themeColor: "#0f6e56" };

const nav = [
  { href: mainSiteUrl(), label: "Courts" },
  { href: "/events", label: "Events" },
  { href: "/instructors", label: "Instructors" },
  { href: "/partner", label: "Find partner" },
  { href: "/levels", label: "Levels" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} ${GeistMono.variable} min-h-dvh antialiased`}>
        <header className="sticky top-0 z-30 border-b border-line bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <span aria-hidden className="inline-block h-4 w-4 rounded-full bg-ball ring-2 ring-court" />
              Rallyz
            </Link>
            <nav className="hidden items-center gap-5 text-sm font-medium md:flex">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="text-ink/80 hover:text-court">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto">
              <Suspense fallback={<div className="h-8 w-24" />}>
                <HeaderUser />
              </Suspense>
            </div>
          </div>
          <nav className="flex gap-5 overflow-x-auto border-t border-line px-4 py-2 text-sm font-medium md:hidden">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap text-ink/80 hover:text-court">
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
          Rallyz · Tennis in Bangkok · Times shown in Bangkok time
        </footer>
      </body>
    </html>
  );
}
