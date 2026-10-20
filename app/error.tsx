'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('FrameForge Studio route error boundary caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B0F17] text-slate-100 px-4 py-16">
      <main className="max-w-xl w-full rounded-2xl border border-slate-800 bg-[#0F172A] p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2 text-xs font-mono text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>RUNTIME APPLICATION ERROR</span>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Something interrupted the workspace view
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            Your saved projects and cached media blobs in local IndexedDB remain
            intact. You can retry rendering this view or return to the homepage.
          </p>
        </div>

        {error?.message && (
          <div className="p-3.5 rounded-lg border border-slate-800 bg-[#090D16] text-xs font-mono text-slate-400 break-words">
            {error.message}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm px-5 py-2.5 min-h-11 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
            <span>Retry View</span>
          </button>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 font-medium text-sm px-5 py-2.5 min-h-11 transition-colors"
          >
            Return to Homepage
          </Link>

          <Link
            href="/help"
            className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-transparent hover:bg-slate-900 text-slate-300 font-medium text-sm px-4 py-2.5 min-h-11 transition-colors"
          >
            Troubleshooting Guide
          </Link>
        </div>
      </main>
    </div>
  );
}
