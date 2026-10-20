import React from 'react';
import Link from 'next/link';
import { ArrowRight, Terminal, AlertCircle } from 'lucide-react';
import {
  generateStructuredDataForPage,
  getPageSeoConfig,
  SEO_CATEGORY_DIRECTORY,
} from '@/lib/seo/registry';
import { SiteHeader } from '@/components/seo/site-header';
import { SiteFooter } from '@/components/seo/site-footer';
import { OnDemandToolWorkspace } from '@/components/seo/on-demand-tool-workspace';
import { SeoAuditChecklistSection } from '@/components/seo/seo-audit-checklist-section';

export interface ToolLandingTemplateProps {
  path: string;
  autoMountWorkspace?: boolean;
  showSeoAuditChecklist?: boolean;
}

export function ToolLandingTemplate({
  path,
  autoMountWorkspace = false,
  showSeoAuditChecklist = false,
}: ToolLandingTemplateProps) {
  const page = getPageSeoConfig(path);
  const jsonLdSchemas = generateStructuredDataForPage(path);
  const isInteractiveTool = page.category === 'tool' || page.category === 'core';

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* Structured Data (JSON-LD) rendered only when eligible */}
      {jsonLdSchemas.map((schema, idx) => (
        <script
          key={`${page.slug}-schema-${idx}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      <SiteHeader currentPath={page.path} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 space-y-14">
        {/* Semantic Breadcrumb Navigation */}
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-slate-400 flex items-center gap-2"
        >
          <Link href="/" className="hover:text-white hover:underline">
            FrameForge Studio
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-slate-200 font-medium" aria-current="page">
            {page.navLabel}
          </span>
        </nav>

        {/* Primary Hero & Page Heading */}
        <header className="space-y-4 max-w-3xl">
          <div className="text-xs text-sky-400 font-medium">
            <span>
              {page.category === 'tool'
                ? 'Browser-Native Video Processing Tool'
                : page.category === 'docs'
                ? 'Engineering & User Documentation'
                : 'Legal & Privacy Transparency'}
            </span>
            <span aria-hidden="true"> · </span>
            <span>Updated {page.lastModified}</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
            {page.h1}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            {page.lead}
          </p>
        </header>

        {/* On-Demand Interactive Tool Workspace (for Tool & Editor Pages) */}
        {isInteractiveTool && (
          <section aria-label={`Interactive ${page.navLabel} application`}>
            <OnDemandToolWorkspace
              toolName={page.navLabel}
              toolSummary={page.description}
              defaultTab={page.defaultEditorTab}
              autoMount={autoMountWorkspace}
            />
          </section>
        )}

        {/* Step-by-Step Workflow (HowTo Section) */}
        {page.howToSteps && page.howToSteps.length > 0 && (
          <section
            aria-labelledby="howto-heading"
            className="space-y-6 border-t border-slate-800/80 pt-10"
          >
            <div className="space-y-2 max-w-2xl">
              <h2
                id="howto-heading"
                className="text-xl sm:text-2xl font-bold tracking-tight text-white"
              >
                How to Use the {page.navLabel} in Your Browser
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">
                Complete your edit locally in four deterministic steps without
                uploading video files to external cloud servers.
              </p>
            </div>

            <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {page.howToSteps.map((step, index) => (
                <li
                  key={step.name}
                  className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-sky-400">
                      0{index + 1}. Step
                    </div>
                    <h3 className="text-sm font-semibold text-white">
                      {step.name}
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {step.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Technical Architecture, Algorithm & Specification Details */}
        <article
          aria-labelledby="architecture-heading"
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 border-t border-slate-800/80 pt-10"
        >
          <div className="lg:col-span-7 space-y-5">
            <h2
              id="architecture-heading"
              className="text-xl sm:text-2xl font-bold tracking-tight text-white"
            >
              {page.category === 'legal'
                ? `${page.navLabel} Terms & Guarantees`
                : `How ${page.navLabel} Works Under the Hood`}
            </h2>

            <div className="space-y-4">
              {page.operationOverview.map((paragraph, idx) => (
                <p
                  key={idx}
                  className="text-sm text-slate-300 leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            {page.ffmpegPipelineExample && (
              <div className="rounded-xl border border-slate-800 bg-[#070A10] p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
                  <Terminal className="h-3.5 w-3.5" />
                  <span>Validated Web Worker FFmpeg.wasm Pipeline</span>
                </div>
                <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  <code>{page.ffmpegPipelineExample}</code>
                </pre>
              </div>
            )}

            {page.browserLimitationsNote && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 flex items-start gap-3">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <h3 className="font-semibold text-amber-200">
                    Browser & Codec Compatibility Note
                  </h3>
                  <p className="text-amber-200/80 leading-relaxed">
                    {page.browserLimitationsNote}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Semantic Description List (<dl>/<dt>/<dd>) for Technical Specs */}
          <aside
            aria-labelledby="specs-heading"
            className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 p-6 space-y-4 h-fit"
          >
            <h3
              id="specs-heading"
              className="text-base font-semibold text-white border-b border-slate-800 pb-3"
            >
              Technical Specifications
            </h3>
            <dl className="space-y-4 text-xs">
              {page.specifications.map((spec) => (
                <div key={spec.label} className="space-y-1">
                  <dt className="font-medium text-slate-400">{spec.label}</dt>
                  <dd className="text-slate-100 font-mono leading-relaxed">
                    {spec.value}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        </article>

        {/* Optional SEO Audit & Core Web Vitals Reference Section (on /help) */}
        {showSeoAuditChecklist && (
          <div className="border-t border-slate-800/80 pt-10">
            <SeoAuditChecklistSection />
          </div>
        )}

        {/* Frequently Asked Questions (FAQ Section) */}
        {page.faqs && page.faqs.length > 0 && (
          <section
            aria-labelledby="faq-heading"
            className="space-y-6 border-t border-slate-800/80 pt-10"
          >
            <h2
              id="faq-heading"
              className="text-xl sm:text-2xl font-bold tracking-tight text-white"
            >
              Frequently Asked Questions — {page.navLabel}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {page.faqs.map((faq) => (
                <article
                  key={faq.question}
                  className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]/60 space-y-2.5"
                >
                  <h3 className="text-sm font-semibold text-white leading-snug">
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

        {/* Internal Links Between Related Tools */}
        <section
          aria-labelledby="related-tools-heading"
          className="space-y-6 border-t border-slate-800/80 pt-10"
        >
          <div className="space-y-1">
            <h2
              id="related-tools-heading"
              className="text-xl font-bold tracking-tight text-white"
            >
              Related Video Editing Tools & Documentation
            </h2>
            <p className="text-xs text-slate-400">
              Combine {page.navLabel} with other non-destructive tools in the
              FrameForge Studio workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {page.relatedTools.map((rel) => (
              <Link
                key={rel.path}
                href={rel.path}
                className="group p-4 rounded-xl border border-slate-800 bg-[#0F172A]/50 hover:bg-[#0F172A] hover:border-sky-500/50 transition-colors flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-white group-hover:text-sky-300 transition-colors flex items-center justify-between gap-2">
                    <span>{rel.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-500 group-hover:text-sky-400 transition-transform group-hover:translate-x-0.5 shrink-0" />
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {rel.relationship}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  {rel.path}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* All Website Categories & Pages Directory */}
        <section
          id="all-categories"
          aria-labelledby="all-categories-directory-heading"
          className="space-y-6 border-t border-slate-800/80 pt-10"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2
                id="all-categories-directory-heading"
                className="text-xl font-bold tracking-tight text-white"
              >
                All Categories & Website Pages
              </h2>
              <p className="text-xs text-slate-400">
                Complete index of all 13 public routes across 5 categories.
              </p>
            </div>
            <Link
              href="/"
              className="text-xs font-medium text-sky-400 hover:text-sky-300 underline underline-offset-4"
            >
              Return to Homepage →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {SEO_CATEGORY_DIRECTORY.map((group) => (
              <div
                key={group.id}
                className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]/40 space-y-2.5"
              >
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 border-b border-slate-800 pb-2">
                  {group.title}
                </h3>
                <ul className="space-y-1.5 text-xs">
                  {group.pages.map((catPage) => {
                    const isCurrent = catPage.path === page.path;
                    return (
                      <li key={catPage.path}>
                        <Link
                          href={catPage.path}
                          className={`block py-0.5 transition-colors hover:underline underline-offset-4 ${
                            isCurrent
                              ? 'text-sky-400 font-semibold'
                              : 'text-slate-300 hover:text-white'
                          }`}
                        >
                          {catPage.path === '/' ? 'Homepage' : catPage.navLabel}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

