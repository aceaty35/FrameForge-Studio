import React from 'react';
import Link from 'next/link';
import { ALL_INDEXABLE_PAGES, SITE_NAME } from '@/lib/seo/registry';

export interface SiteHeaderProps {
  currentPath?: string;
}

const PRIMARY_HEADER_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/online-video-editor', label: 'Online Video Editor' },
  { href: '/#all-categories', label: 'All Categories' },
  { href: '/help', label: 'Help & Docs' },
  { href: '/privacy-policy', label: 'Privacy Policy' },
];

export function SiteHeader({ currentPath }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-[#0B0F17]/95 backdrop-blur-md">
      {/* Row 1: 3-Zone Top Header Bar */}
      <div className="max-w-6xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-6 border-b border-slate-800/60">
        {/* Zone 1: Single text wordmark */}
        <Link
          href="/"
          className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          {SITE_NAME}
        </Link>

        {/* Zone 2: 5 clean single-line text navigation links */}
        <nav
          aria-label="Primary marketing navigation"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300"
        >
          {PRIMARY_HEADER_LINKS.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors underline-offset-8 hover:text-white hover:underline ${
                  isActive ? 'text-sky-400 underline decoration-sky-400' : ''
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <Link
            href="/#workspace"
            className="inline-flex items-center justify-center rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs px-4 py-2 min-h-9 whitespace-nowrap transition-colors"
          >
            Open Studio
          </Link>
        </div>
      </div>

      {/* Row 2: All Categories & Pages Quick-Navigation Directory Bar */}
      <div className="bg-[#080B11]/90">
        <nav
          aria-label="All categories and video tools"
          className="max-w-6xl mx-auto px-4 sm:px-6 h-10 flex items-center gap-4 overflow-x-auto text-xs text-slate-400"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap shrink-0">
            All Categories:
          </span>
          {ALL_INDEXABLE_PAGES.map((page) => {
            const isActive = currentPath === page.path;
            return (
              <Link
                key={page.path}
                href={page.path}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors underline-offset-4 hover:text-white hover:underline ${
                  isActive
                    ? 'text-sky-400 font-semibold underline decoration-sky-400'
                    : 'text-slate-300'
                }`}
              >
                {page.path === '/' ? 'Homepage' : page.navLabel}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
