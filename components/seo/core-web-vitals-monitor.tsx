'use client';

import React, { useEffect, useState } from 'react';
import {
  evaluateWebVitalRating,
  getDefaultWebVitalsSnapshot,
  WebVitalMetric,
} from '@/lib/seo/web-vitals';

export function CoreWebVitalsMonitor() {
  const [metrics, setMetrics] = useState<
    Record<WebVitalMetric['name'], WebVitalMetric>
  >(() => getDefaultWebVitalsSnapshot());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
      return;
    }

    const observers: PerformanceObserver[] = [];

    // 1. Navigation Timing (TTFB)
    try {
      const navObserver = new PerformanceObserver((list) => {
        const navEntries = list.getEntries() as PerformanceNavigationTiming[];
        if (navEntries && navEntries.length > 0) {
          const ttfb = Math.max(1, Math.round(navEntries[0].responseStart));
          setMetrics((prev) => ({
            ...prev,
            TTFB: {
              ...prev.TTFB,
              value: ttfb,
              rating: evaluateWebVitalRating('TTFB', ttfb),
            },
          }));
        }
      });
      navObserver.observe({ type: 'navigation', buffered: true });
      observers.push(navObserver);
    } catch {
      // Ignore if unsupported
    }

    // 2. Paint Timing (FCP)
    try {
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            const fcp = Math.round(entry.startTime);
            setMetrics((prev) => ({
              ...prev,
              FCP: {
                ...prev.FCP,
                value: fcp,
                rating: evaluateWebVitalRating('FCP', fcp),
              },
            }));
          }
        }
      });
      paintObserver.observe({ type: 'paint', buffered: true });
      observers.push(paintObserver);
    } catch {
      // Ignore if unsupported
    }

    // 3. Largest Contentful Paint (LCP)
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (lastEntry) {
          const lcp = Math.round(lastEntry.startTime);
          setMetrics((prev) => ({
            ...prev,
            LCP: {
              ...prev.LCP,
              value: lcp,
              rating: evaluateWebVitalRating('LCP', lcp),
            },
          }));
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObserver);
    } catch {
      // Ignore if unsupported
    }

    // 4. Cumulative Layout Shift (CLS)
    try {
      let clsScore = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        })[]) {
          if (!entry.hadRecentInput && typeof entry.value === 'number') {
            clsScore += entry.value;
          }
        }
        const roundedCls = Number(clsScore.toFixed(3));
        setMetrics((prev) => ({
          ...prev,
          CLS: {
            ...prev.CLS,
            value: roundedCls,
            rating: evaluateWebVitalRating('CLS', roundedCls),
          },
        }));
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObserver);
    } catch {
      // Ignore if unsupported
    }

    // 5. Interaction Latency (event / first-input)
    try {
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Math.round(entry.duration);
          if (duration > 0) {
            setMetrics((prev) => {
              const nextVal = Math.max(prev.INP.value, duration);
              return {
                ...prev,
                INP: {
                  ...prev.INP,
                  value: nextVal,
                  rating: evaluateWebVitalRating('INP', nextVal),
                },
              };
            });
          }
        }
      });
      inpObserver.observe({ type: 'first-input', buffered: true });
      observers.push(inpObserver);
    } catch {
      // Ignore if unsupported
    }

    return () => {
      for (const obs of observers) {
        obs.disconnect();
      }
    };
  }, []);

  const metricList = Object.values(metrics);

  return (
    <section
      aria-labelledby="cwv-heading"
      data-testid="core-web-vitals-monitor"
      className="rounded-xl border border-slate-800 bg-[#0F172A]/70 p-6 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 id="cwv-heading" className="text-base font-semibold text-white">
            Live Core Web Vitals & Rendering Performance
          </h3>
          <p className="text-xs text-slate-400">
            Measured in real time via browser PerformanceObserver APIs (LCP, CLS, INP, FCP, TTFB).
          </p>
        </div>
        <div className="text-xs text-slate-400 font-mono">
          <span>Server-Rendered HTML</span>
          <span aria-hidden="true"> · </span>
          <span>On-Demand Editor Bundle</span>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-1">
        {metricList.map((m) => (
          <div
            key={m.name}
            className="p-3.5 rounded-lg border border-slate-800/90 bg-[#0B0F17] space-y-1"
          >
            <dt className="text-xs font-medium text-slate-400 flex items-center justify-between">
              <span>{m.name}</span>
              <span
                className={`font-mono text-[11px] ${
                  m.rating === 'good'
                    ? 'text-emerald-400'
                    : m.rating === 'needs-improvement'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {m.rating}
              </span>
            </dt>
            <dd className="text-lg font-bold font-mono text-white tabular-nums">
              {m.unit === 'score' ? m.value.toFixed(3) : `${m.value} ms`}
            </dd>
            <p className="text-[11px] text-slate-500 truncate" title={m.label}>
              Target {m.targetThreshold}
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}
