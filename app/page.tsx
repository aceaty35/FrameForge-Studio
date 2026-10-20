import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Play, Layers, FolderOpen } from 'lucide-react';
import { LazyWorkspaceLoader } from '@/components/editor/lazy-workspace-loader';
import {
  ALL_INDEXABLE_PAGES,
  buildNextMetadata,
  generateStructuredDataForPage,
  getPageSeoConfig,
  SEO_CATEGORY_DIRECTORY,
} from '@/lib/seo/registry';
import { SiteHeader } from '@/components/seo/site-header';
import { SeoAuditChecklistSection } from '@/components/seo/seo-audit-checklist-section';
import { SiteFooter } from '@/components/seo/site-footer';

export const metadata: Metadata = buildNextMetadata('/');

export default function HomePage() {
  const homeSeo = getPageSeoConfig('/');
  const jsonLdSchemas = generateStructuredDataForPage('/');

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Eligible Structured Data (WebApplication & FAQPage) */}
      {jsonLdSchemas.map((schema, index) => (
        <script
          key={`home-schema-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      {/* Sticky Site Header with Home Link & All Categories Navigation Bar */}
      <SiteHeader currentPath="/" />

      {/* Main Server-Rendered Homepage Content & All Categories Directory */}
      <main
        aria-label="Homepage, all video editing categories, and interactive studio"
        className="flex-1 w-full"
      >
        {/* Above-the-Fold Homepage Hero Section */}
        <section className="max-w-6xl mx-auto w-full px-4 sm:px-6 pt-10 pb-12 border-b border-slate-800/80">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-5">
              <div className="text-xs text-sky-400 font-medium">
                <span>Client-Side WebAssembly & HTML5 Canvas 2D Studio</span>
                <span aria-hidden="true"> · </span>
                <span>Zero Cloud Uploads</span>
                <span aria-hidden="true"> · </span>
                <span>{ALL_INDEXABLE_PAGES.length} Specialized Pages</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
                {homeSeo.h1}
              </h1>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
                {homeSeo.lead}
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#workspace"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm px-5 py-2.5 min-h-11 transition-colors"
                >
                  <Play className="h-4 w-4 fill-current" />
                  <span>Jump to Live Studio</span>
                </a>

                <Link
                  href="/online-video-editor"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 font-medium text-sm px-4 py-2.5 min-h-11 transition-colors"
                >
                  <Layers className="h-4 w-4 text-sky-400" />
                  <span>Online Video Editor Page</span>
                </Link>

                <a
                  href="#all-categories"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#0F172A] hover:bg-slate-800/80 text-slate-300 font-medium text-sm px-4 py-2.5 min-h-11 transition-colors"
                >
                  <FolderOpen className="h-4 w-4 text-sky-400" />
                  <span>Browse All Categories ({ALL_INDEXABLE_PAGES.length})</span>
                </a>
              </div>
            </div>

            {/* Right Column: Quick Summary of All 5 Category Groups */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0F172A]/80 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-sm font-semibold text-white">
                  All Website Categories & Tools
                </h2>
                <span className="text-xs font-mono text-sky-400">
                  {ALL_INDEXABLE_PAGES.length} Routes
                </span>
              </div>

              <ul className="space-y-2.5 text-xs">
                {SEO_CATEGORY_DIRECTORY.map((group) => (
                  <li
                    key={group.id}
                    className="p-2.5 rounded-lg border border-slate-800/80 bg-[#0B0F17]/70 flex flex-col gap-1.5"
                  >
                    <div className="font-semibold text-slate-200">
                      {group.title}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {group.pages.map((page) => (
                        <Link
                          key={page.path}
                          href={page.path}
                          className="text-sky-400 hover:text-sky-300 hover:underline underline-offset-4 font-medium"
                        >
                          {page.path === '/' ? 'Homepage' : page.navLabel}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Complete All-Categories Directory Section (All 13 Pages) */}
        <section
          id="all-categories"
          aria-labelledby="all-categories-heading"
          className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-14 space-y-10 border-b border-slate-800/80"
        >
          <div className="space-y-2 max-w-3xl">
            <div className="text-xs font-mono uppercase tracking-wider text-sky-400">
              Complete Site Directory · 5 Categories · {ALL_INDEXABLE_PAGES.length} Indexable Pages
            </div>
            <h2
              id="all-categories-heading"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
            >
              All Video Editing Categories, Tools & Documentation
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Explore every specialized browser video tool, technical workflow
              guide, and legal transparency page in FrameForge Studio. Each route
              features a stable URL, dedicated FFmpeg filter documentation, and
              an on-demand client-side workspace.
            </p>
          </div>

          <div className="space-y-10">
            {SEO_CATEGORY_DIRECTORY.map((group) => (
              <div
                key={group.id}
                data-testid={`category-group-${group.id}`}
                className="space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 border-b border-slate-800/80 pb-2">
                  <h3 className="text-lg font-semibold text-white">
                    {group.title}
                  </h3>
                  <p className="text-xs text-slate-400">{group.description}</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {group.pages.map((tool) => (
                    <Link
                      key={tool.path}
                      href={tool.path}
                      className="group p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 hover:bg-[#0F172A] hover:border-sky-500/50 transition-colors flex flex-col justify-between gap-4"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-base font-semibold text-white group-hover:text-sky-300 transition-colors">
                            {tool.path === '/' ? 'Homepage' : tool.navLabel}
                          </h4>
                          <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-sky-400 transition-transform group-hover:translate-x-0.5 shrink-0" />
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {tool.description}
                        </p>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 flex items-center justify-between pt-2 border-t border-slate-800/60">
                        <span>{tool.path}</span>
                        <span className="uppercase">{tool.category}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Full-Viewport Non-Linear Video Editor Studio (Client-Side Lazy-Loaded) */}
        <section
          aria-label="Interactive Multi-Track Video Editor Studio"
          className="w-full border-b border-slate-800/80"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">
                Interactive Multi-Track Video Editor Workspace
              </h2>
              <p className="text-xs text-slate-400">
                Edit, trim, crop, add subtitles, and export directly in your
                browser below.
              </p>
            </div>
            <Link
              href="/online-video-editor"
              className="text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4"
            >
              Open Dedicated Online Video Editor Route →
            </Link>
          </div>
          <LazyWorkspaceLoader />
        </section>

        {/* Below-the-Fold Architecture Overview, FAQs & SEO Audit Checklist */}
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-16 space-y-16">
          {/* Core Engineering Pillars */}
          <section className="space-y-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Core Browser Video Engineering Architecture
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <article className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2">
                <h3 className="text-base font-semibold text-white">
                  01. Non-Destructive Multi-Track Timeline
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Trim clip in-points and out-points, split clips at the playhead
                  with millisecond precision, adjust playback speed from 0.25x to
                  4.0x, and snap clips magnetically across video, overlay,
                  caption, and audio tracks.
                </p>
              </article>

              <article className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2">
                <h3 className="text-base font-semibold text-white">
                  02. Off-Main-Thread Web Worker Pipeline
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Expensive audio PCM peak downsampling and FFmpeg.wasm video
                  muxing execute in background Web Workers with cancellation
                  support, keeping timeline scrubbing and 60 FPS Canvas
                  compositing responsive.
                </p>
              </article>

              <article className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2">
                <h3 className="text-base font-semibold text-white">
                  03. Local IndexedDB & Dual-Engine Export
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Save project snapshots and media blobs locally in IndexedDB
                  Schema v2 without cloud uploads. Export finished sequences to
                  MP4 or WebM via validated FFmpeg.wasm filters or native
                  MediaRecorder streams.
                </p>
              </article>
            </div>
          </section>

          {/* Frequently Asked Questions */}
          {homeSeo.faqs && (
            <section
              aria-labelledby="home-faq-heading"
              className="space-y-6 border-t border-slate-800/80 pt-12"
            >
              <h2
                id="home-faq-heading"
                className="text-xl sm:text-2xl font-bold tracking-tight text-white"
              >
                Frequently Asked Questions
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {homeSeo.faqs.map((faq) => (
                  <article
                    key={faq.question}
                    className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2"
                  >
                    <h3 className="text-sm font-semibold text-white">
                      {faq.question}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {faq.answer}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Technical SEO Audit Checklist & Core Web Vitals */}
          <div className="border-t border-slate-800/80 pt-12">
            <SeoAuditChecklistSection />
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
