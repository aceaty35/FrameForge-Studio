import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SEO_AUDIT_CHECKLIST, ALL_INDEXABLE_PAGES } from '@/lib/seo/registry';
import { CoreWebVitalsMonitor } from '@/components/seo/core-web-vitals-monitor';

export function SeoAuditChecklistSection() {
  return (
    <section
      aria-labelledby="seo-audit-heading"
      data-testid="seo-audit-checklist-section"
      className="space-y-8"
    >
      <div className="space-y-2 max-w-3xl">
        <div className="text-xs text-sky-400 font-medium">
          <span>Technical SEO & Next.js App Router Architecture</span>
          <span aria-hidden="true"> · </span>
          <span>{ALL_INDEXABLE_PAGES.length} Indexable Routes</span>
        </div>
        <h2
          id="seo-audit-heading"
          className="text-xl sm:text-2xl font-bold tracking-tight text-white"
        >
          Verified Technical SEO Audit Checklist & Core Web Vitals
        </h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          Every route in FrameForge Studio is engineered for crawlability, unique
          Next.js Metadata API tags, eligible Schema.org JSON-LD, zero layout
          shift, and deferred client-side WebAssembly loading. No deceptive
          ranking claims or doorway pages are generated.
        </p>
      </div>

      {/* Live Core Web Vitals Measurement */}
      <CoreWebVitalsMonitor />

      {/* Audit Checklist Table */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A]/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0B0F17] text-slate-300">
                <th scope="col" className="py-3.5 px-4 font-semibold">
                  Requirement
                </th>
                <th scope="col" className="py-3.5 px-4 font-semibold">
                  Domain
                </th>
                <th scope="col" className="py-3.5 px-4 font-semibold">
                  Architecture & Implementation
                </th>
                <th scope="col" className="py-3.5 px-4 font-semibold">
                  Verification
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {SEO_AUDIT_CHECKLIST.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-900/40 transition-colors align-top"
                >
                  <td className="py-3.5 px-4 font-medium text-white whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span>{item.requirement}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                    {item.category}
                  </td>
                  <td className="py-3.5 px-4 text-slate-300 leading-relaxed min-w-[260px]">
                    {item.implementationDetails}
                  </td>
                  <td className="py-3.5 px-4 text-slate-400 leading-relaxed min-w-[220px]">
                    {item.verificationMethod}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
