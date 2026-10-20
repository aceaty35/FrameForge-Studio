import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  auditEnvironmentVariablesForLeaks,
  DEPLOYMENT_RUNBOOK,
  FREE_HOSTING_PROVIDER_MATRIX,
  MINIMAL_VALID_WASM_BINARY,
  NEXTJS_ARCHITECTURE_ASSESSMENT,
  runDeploymentSmokeTests,
  verifyWasmAndWorkerRuntime,
} from '@/lib/deployment/deployment-readiness';
import {
  buildContentSecurityPolicy,
  SECURITY_HEADERS_LIST,
  WASM_AND_WORKER_MIME_HEADERS,
} from '@/lib/security/security-controls';
import {
  FFMPEG_RUNTIME_SPEC,
  releaseExportResources,
} from '@/lib/export/exporter';
import { resetInMemoryDbForTests } from '@/lib/persistence/db';

describe('Deployment Readiness, Free Hosting Compatibility & Smoke Test Suite', () => {
  beforeEach(() => {
    resetInMemoryDbForTests();
    releaseExportResources(true);
  });

  it('1. Identifies Next.js architecture capabilities: supports both standalone server and 100% static export with zero paid backend', () => {
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.requiresPaidVideoBackend).toBe(false);
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.requiresServerForEditingOrExport).toBe(
      false
    );
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.supportsStaticExport).toBe(true);
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.supportsStandaloneServer).toBe(true);
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.totalPrerenderedStaticRoutes).toBe(16);
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.staticRoutesList).toContain('/');
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.staticRoutesList).toContain(
      '/online-video-editor'
    );
    expect(NEXTJS_ARCHITECTURE_ASSESSMENT.staticRoutesList).toContain(
      '/privacy-policy'
    );
  });

  it('2. Audits environment configuration and blocks any API keys or secrets in NEXT_PUBLIC_* variables', () => {
    // Current process.env should have zero leaked NEXT_PUBLIC_ secrets
    const currentAudit = auditEnvironmentVariablesForLeaks();
    expect(currentAudit.passed).toBe(true);
    expect(currentAudit.leakedPublicKeys).toHaveLength(0);

    // Simulated safe public configuration passes
    const safeAudit = auditEnvironmentVariablesForLeaks({
      GEMINI_API_KEY: 'server-only-secret-ok',
      APP_URL: 'https://frameforge.studio',
      NEXT_PUBLIC_FFMPEG_CORE_BASE_URL:
        'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
      NEXT_PUBLIC_ENABLE_COOP_COEP: 'false',
    });
    expect(safeAudit.passed).toBe(true);

    // Simulated public secret leak is immediately detected and flagged
    const leakedAudit = auditEnvironmentVariablesForLeaks({
      NEXT_PUBLIC_GEMINI_API_KEY: 'leaked-key',
      NEXT_PUBLIC_STRIPE_SECRET: 'sk_live_123',
      NEXT_PUBLIC_DATABASE_URL: 'postgres://user:pass@host/db',
    });
    expect(leakedAudit.passed).toBe(false);
    expect(leakedAudit.leakedPublicKeys).toEqual([
      'NEXT_PUBLIC_GEMINI_API_KEY',
      'NEXT_PUBLIC_STRIPE_SECRET',
      'NEXT_PUBLIC_DATABASE_URL',
    ]);
  });

  it('3. Verifies WebAssembly binary compilation, application/wasm MIME rules, Worker loading, HTTPS, and CSP headers', async () => {
    expect(MINIMAL_VALID_WASM_BINARY.byteLength).toBe(8);
    const runtime = await verifyWasmAndWorkerRuntime();

    expect(runtime.wasmSupported).toBe(true);
    expect(runtime.wasmMagicBytesValid).toBe(true);
    expect(runtime.wasmCompilePassed).toBe(true);
    expect(runtime.wasmBlobMimeVerified).toBe(true);
    expect(runtime.workerBlobRoundTripPassed).toBe(true);
    expect(runtime.httpsSecureContext).toBe(true);
    expect(runtime.cspHeaderValid).toBe(true);
    expect(runtime.wasmMimeHeaderConfigured).toBe(true);

    // Primary + fallback CDN URLs are pinned and HTTPS
    expect(FFMPEG_RUNTIME_SPEC.coreBaseUrl).toBe(
      'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    );
    expect(FFMPEG_RUNTIME_SPEC.fallbackCoreBaseUrl).toBe(
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd'
    );
    expect(FFMPEG_RUNTIME_SPEC.wasmMimeType).toBe('application/wasm');

    // Verify CSP allows both primary and fallback CDNs plus wasm-unsafe-eval and blob: workers
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain('https://unpkg.com');
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain('upgrade-insecure-requests');

    // Verify WASM MIME header rules exist
    const wasmRule = WASM_AND_WORKER_MIME_HEADERS.find((r) =>
      r.source.includes('.wasm')
    );
    expect(wasmRule).toBeDefined();
    expect(wasmRule?.headers).toContainEqual({
      key: 'Content-Type',
      value: 'application/wasm',
    });

    // Verify COOP header is included in SECURITY_HEADERS_LIST
    expect(SECURITY_HEADERS_LIST).toContainEqual({
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin-allow-popups',
    });
  });

  it('4. Documents distinct configurations and bandwidth/file-size limits across 5 free hosting providers', () => {
    expect(FREE_HOSTING_PROVIDER_MATRIX).toHaveLength(5);

    const cloudflare = FREE_HOSTING_PROVIDER_MATRIX.find(
      (h) => h.id === 'cloudflare-pages'
    )!;
    const githubPages = FREE_HOSTING_PROVIDER_MATRIX.find(
      (h) => h.id === 'github-pages'
    )!;
    const vercel = FREE_HOSTING_PROVIDER_MATRIX.find(
      (h) => h.id === 'vercel-hobby'
    )!;

    // Cloudflare Pages uses static export and enforces a 25 MiB per-file limit
    expect(cloudflare.recommendedBuildMode).toBe('export');
    expect(cloudflare.maxSingleFileSizeLimit).toContain('25 MiB');
    expect(cloudflare.supportsCustomHttpHeaders).toBe(true);

    // GitHub Pages does NOT support custom HTTP headers
    expect(githubPages.recommendedBuildMode).toBe('export');
    expect(githubPages.supportsCustomHttpHeaders).toBe(false);
    expect(githubPages.supportsCoopCoepSharedArrayBuffer).toBe(
      'requires-service-worker-or-single-thread'
    );

    // Vercel supports standalone/server headers and vercel.json
    expect(vercel.recommendedBuildMode).toBe('standalone');
    expect(vercel.supportsCustomHttpHeaders).toBe(true);
  });

  it('5. Verifies on-disk deployment configuration files (.env.example, public/_headers, vercel.json) and runbooks', () => {
    const rootDir = process.cwd();

    const envExample = fs.readFileSync(
      path.join(rootDir, '.env.example'),
      'utf8'
    );
    expect(envExample).toContain('NEXT_OUTPUT_MODE=');
    expect(envExample).toContain('NEXT_PUBLIC_FFMPEG_CORE_BASE_URL=');
    expect(envExample).not.toContain('NEXT_PUBLIC_GEMINI_API_KEY');

    const staticHeaders = fs.readFileSync(
      path.join(rootDir, 'public', '_headers'),
      'utf8'
    );
    expect(staticHeaders).toContain('/*.wasm');
    expect(staticHeaders).toContain('Content-Type: application/wasm');
    expect(staticHeaders).toContain('Strict-Transport-Security:');

    const vercelConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8')
    );
    expect(vercelConfig.framework).toBe('nextjs');
    expect(JSON.stringify(vercelConfig.headers)).toContain('application/wasm');

    expect(DEPLOYMENT_RUNBOOK.buildInstructions.length).toBeGreaterThanOrEqual(2);
    expect(
      DEPLOYMENT_RUNBOOK.troubleshootingGuide.length
    ).toBeGreaterThanOrEqual(5);
    expect(DEPLOYMENT_RUNBOOK.rollbackProcedure.length).toBeGreaterThanOrEqual(4);
  });

  it('6. Executes the full 8-step automated deployment smoke test suite with 100% pass rate', async () => {
    const smokeReport = await runDeploymentSmokeTests();
    expect(smokeReport.allPassed).toBe(true);
    expect(smokeReport.passedCount).toBe(8);
    expect(smokeReport.totalCount).toBe(8);
    for (const step of smokeReport.steps) {
      expect(step.passed).toBe(true);
    }
  });
});
