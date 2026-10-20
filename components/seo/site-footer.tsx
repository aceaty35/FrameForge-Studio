import React from 'react';
import Link from 'next/link';
import { SITE_NAME, TOOL_LANDING_PAGES } from '@/lib/seo/registry';

export function SiteFooter() {
  return (
    <footer
      aria-label="Site footer and tool directory"
      className="border-t border-slate-800/90 bg-[#080B11] text-slate-400"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Column 1: Brand & Architecture */}
          <div className="space-y-3">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-white inline-block"
            >
              {SITE_NAME}
            </Link>
            <p className="text-xs text-slate-400 leading-relaxed">
              Browser-native non-linear video editing powered by HTML5 Canvas 2D
              compositing, Web Workers, IndexedDB persistence, and FFmpeg.wasm.
            </p>
            <p className="text-xs text-slate-500">
              <span>Zero cloud uploads</span>
              <span aria-hidden="true"> · </span>
              <span>100% client-side execution</span>
            </p>
          </div>

          {/* Column 2: Core Editing Tools */}
          <nav aria-label="Core video editing tools" className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Video Editing Tools
            </h2>
            <ul className="space-y-2 text-xs">
              {TOOL_LANDING_PAGES.slice(0, 5).map((tool) => (
                <li key={tool.path}>
                  <Link
                    href={tool.path}
                    className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                  >
                    {tool.navLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Column 3: Audio, Captions & Speed Tools */}
          <nav aria-label="Audio, text, and speed tools" className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Audio, Captions & Speed
            </h2>
            <ul className="space-y-2 text-xs">
              {TOOL_LANDING_PAGES.slice(5).map((tool) => (
                <li key={tool.path}>
                  <Link
                    href={tool.path}
                    className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                  >
                    {tool.navLabel}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  Homepage & Full Studio
                </Link>
              </li>
            </ul>
          </nav>

          {/* Column 4: Documentation, Legal & Technical SEO */}
          <nav aria-label="Documentation and legal resources" className="space-y-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              Documentation & Legal
            </h2>
            <ul className="space-y-2 text-xs">
              <li>
                <Link
                  href="/help"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  Help & Documentation
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy-policy"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms-of-service"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <a
                  href="/sitemap.xml"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  XML Sitemap (sitemap.xml)
                </a>
              </li>
              <li>
                <a
                  href="/robots.txt"
                  className="text-slate-400 hover:text-sky-300 hover:underline underline-offset-4 transition-colors"
                >
                  Crawler Directives (robots.txt)
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <p>
            © {new Date().getFullYear()} {SITE_NAME}. Local-first browser video
            processing.
          </p>
          <p>
            <span>HTML5 Canvas 2D</span>
            <span aria-hidden="true"> · </span>
            <span>Web Workers</span>
            <span aria-hidden="true"> · </span>
            <span>IndexedDB v2</span>
            <span aria-hidden="true"> · </span>
            <span>FFmpeg.wasm</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
