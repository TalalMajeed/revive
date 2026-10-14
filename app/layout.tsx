import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "Revive", template: "%s · Revive" },
  description: "Early warning for construction delays",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-rule bg-panel/95 backdrop-blur-sm">
          <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink no-underline">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <rect x="1" y="1" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="M4 14h4l2-6 2 3h4" fill="none" stroke="var(--risk)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Revive
            </Link>
            <nav className="flex items-center gap-4 text-sm text-ink-2">
              <Link href="/" className="hover:text-ink">Projects</Link>
              <Link href="/projects/new" className="hover:text-ink">New project</Link>
            </nav>
          </div>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
