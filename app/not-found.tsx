import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Compass } from 'lucide-react';
import { SiteHeader } from '@/components/seo/site-header';
import { SiteFooter } from '@/components/seo/site-footer';
import { TOOL_LANDING_PAGES } from '@/lib/seo/registry';

export const metadata: Metadata = {
  title: 'Page Not Found (404) – FrameForge Studio',
  description:
    'The requested page or video tool route could not be found. Browse FrameForge Studio’s browser-native video editing tools or return to the workspace.',
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <SiteHeader />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-16 sm:py-24 space-y-12">
        <section className="space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-mono text-amber-400">
            <Compass className="h-4 w-4" />
            <span>HTTP 404 · ROUTE NOT FOUND</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            We couldn’t find that page or timeline route
          </h1>

          <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl">
            The URL you requested may have been moved, or you may have followed a
            link to a local project that only exists in another browser’s
            IndexedDB storage.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/#workspace"
              className="inline-flex items-center justify-center rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm px-5 py-2.5 min-h-11 transition-colors"
            >
              Open Video Editor Studio
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 font-medium text-sm px-5 py-2.5 min-h-11 transition-colors"
            >
              Read Help & Documentation
            </Link>
          </div>
        </section>

        <section
          aria-labelledby="not-found-tools-heading"
          className="space-y-4 border-t border-slate-800 pt-10"
        >
          <h2
            id="not-found-tools-heading"
            className="text-lg font-semibold text-white"
          >
            Available Browser Video Editing Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {TOOL_LANDING_PAGES.map((tool) => (
              <Link
                key={tool.path}
                href={tool.path}
                className="group p-4 rounded-xl border border-slate-800 bg-[#0F172A]/60 hover:border-sky-500/50 transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between text-sm font-semibold text-white group-hover:text-sky-300">
                  <span>{tool.navLabel}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-sky-400" />
                </div>
                <p className="text-xs text-slate-400 line-clamp-2">
                  {tool.lead}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
