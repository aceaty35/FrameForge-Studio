export type WebVitalRating = 'good' | 'needs-improvement' | 'poor';

export interface WebVitalMetric {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  label: string;
  value: number;
  unit: 'ms' | 'score';
  rating: WebVitalRating;
  targetThreshold: string;
}

/**
 * Evaluates a Core Web Vital metric value against official Google Web Vitals thresholds:
 * - LCP (Largest Contentful Paint): Good <= 2500ms, Needs Improvement <= 4000ms
 * - CLS (Cumulative Layout Shift): Good <= 0.1, Needs Improvement <= 0.25
 * - INP (Interaction to Next Paint): Good <= 200ms, Needs Improvement <= 500ms
 * - FCP (First Contentful Paint): Good <= 1800ms, Needs Improvement <= 3000ms
 * - TTFB (Time to First Byte): Good <= 800ms, Needs Improvement <= 1800ms
 */
export function evaluateWebVitalRating(
  name: WebVitalMetric['name'],
  value: number
): WebVitalRating {
  const safeVal = Math.max(0, Number.isFinite(value) ? value : 0);
  switch (name) {
    case 'LCP':
      if (safeVal <= 2500) return 'good';
      if (safeVal <= 4000) return 'needs-improvement';
      return 'poor';
    case 'CLS':
      if (safeVal <= 0.1) return 'good';
      if (safeVal <= 0.25) return 'needs-improvement';
      return 'poor';
    case 'INP':
      if (safeVal <= 200) return 'good';
      if (safeVal <= 500) return 'needs-improvement';
      return 'poor';
    case 'FCP':
      if (safeVal <= 1800) return 'good';
      if (safeVal <= 3000) return 'needs-improvement';
      return 'poor';
    case 'TTFB':
      if (safeVal <= 800) return 'good';
      if (safeVal <= 1800) return 'needs-improvement';
      return 'poor';
  }
}

export function getDefaultWebVitalsSnapshot(): Record<
  WebVitalMetric['name'],
  WebVitalMetric
> {
  return {
    LCP: {
      name: 'LCP',
      label: 'Largest Contentful Paint',
      value: 420,
      unit: 'ms',
      rating: 'good',
      targetThreshold: '≤ 2500 ms',
    },
    CLS: {
      name: 'CLS',
      label: 'Cumulative Layout Shift',
      value: 0.0,
      unit: 'score',
      rating: 'good',
      targetThreshold: '≤ 0.10',
    },
    INP: {
      name: 'INP',
      label: 'Interaction to Next Paint',
      value: 16,
      unit: 'ms',
      rating: 'good',
      targetThreshold: '≤ 200 ms',
    },
    FCP: {
      name: 'FCP',
      label: 'First Contentful Paint',
      value: 240,
      unit: 'ms',
      rating: 'good',
      targetThreshold: '≤ 1800 ms',
    },
    TTFB: {
      name: 'TTFB',
      label: 'Time to First Byte',
      value: 65,
      unit: 'ms',
      rating: 'good',
      targetThreshold: '≤ 800 ms',
    },
  };
}
