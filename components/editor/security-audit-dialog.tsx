'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Wrench,
  Lock,
  FileWarning,
  Terminal,
  PackageCheck,
  FlaskConical,
  CheckCircle2,
  XCircle,
  Cpu,
  Globe,
} from 'lucide-react';
import { useEditorStore } from '@/store/use-editor-store';
import {
  buildContentSecurityPolicy,
  DEPENDENCY_SECURITY_MANIFEST,
  EditorFailureCategory,
  FAILURE_RECOVERY_CATALOG,
  PRIVACY_AND_TELEMETRY_POLICY,
  SECURITY_HEADERS_LIST,
  SECURITY_LIMITATIONS_DOCUMENTATION,
} from '@/lib/security/security-controls';
import {
  BROWSER_COVERAGE_MATRIX,
  QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT,
  QaSuiteExecutionReport,
  runAutomatedQaSuite,
} from '@/lib/qa/qa-suite';
import { STANDARD_QA_MEDIA_FIXTURES } from '@/lib/qa/media-probe';
import {
  DEPLOYMENT_RUNBOOK,
  DeploymentSmokeTestReport,
  FREE_HOSTING_PROVIDER_MATRIX,
  NEXTJS_ARCHITECTURE_ASSESSMENT,
  runDeploymentSmokeTests,
} from '@/lib/deployment/deployment-readiness';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Visible, actionable recovery banner rendered at the top of the workspace
 * whenever any of the 9 expected failure scenarios occurs.
 */
export function SecurityRecoveryBanner() {
  const incident = useEditorStore((s) => s.activeFailureIncident);
  const executeRecoveryAction = useEditorStore((s) => s.executeRecoveryAction);
  const dismissFailureIncident = useEditorStore((s) => s.dismissFailureIncident);
  const setSecurityDialogOpen = useEditorStore((s) => s.setSecurityDialogOpen);

  if (!incident) return null;

  const { recoverySpec } = incident;
  const isError = recoverySpec.severity === 'error';

  return (
    <div
      role="alert"
      data-testid="security-recovery-banner"
      data-failure-category={incident.category}
      className={`px-3.5 py-2.5 border-b text-xs flex flex-wrap items-center justify-between gap-3 shrink-0 ${
        isError
          ? 'bg-rose-950/90 border-rose-500/40 text-rose-100'
          : 'bg-amber-950/90 border-amber-500/40 text-amber-100'
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <AlertTriangle
          className={`h-4 w-4 shrink-0 mt-0.5 ${
            isError ? 'text-rose-400' : 'text-amber-400'
          }`}
        />
        <div className="min-w-0 space-y-0.5">
          <div className="font-semibold flex flex-wrap items-center gap-2">
            <span data-testid="recovery-banner-title">{recoverySpec.title}</span>
            <span className="font-mono text-[10px] opacity-80">
              [{incident.category}]
            </span>
          </div>
          <p className="text-[11px] opacity-90 leading-relaxed">
            {incident.customDetail || recoverySpec.userExplanation}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void executeRecoveryAction(recoverySpec.primaryActionId)}
          data-testid="recovery-primary-action-btn"
          className="px-3 py-1.5 rounded-md bg-white text-slate-950 hover:bg-slate-100 font-semibold text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {recoverySpec.primaryActionLabel}
        </button>
        <button
          type="button"
          onClick={() =>
            void executeRecoveryAction(recoverySpec.secondaryActionId)
          }
          data-testid="recovery-secondary-action-btn"
          className="px-2.5 py-1.5 rounded-md bg-slate-900/80 hover:bg-slate-900 text-slate-200 border border-slate-700 font-medium text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          {recoverySpec.secondaryActionLabel}
        </button>
        <button
          type="button"
          onClick={() => setSecurityDialogOpen(true)}
          className="px-2.5 py-1.5 rounded-md bg-transparent hover:bg-white/10 text-slate-200 font-medium text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          Diagnostics
        </button>
        <button
          type="button"
          onClick={dismissFailureIncident}
          className="px-2 py-1 text-[11px] opacity-75 hover:opacity-100 cursor-pointer whitespace-nowrap shrink-0"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function SecurityAuditDialog() {
  const isOpen = useEditorStore((s) => s.isSecurityDialogOpen);
  const setOpen = useEditorStore((s) => s.setSecurityDialogOpen);
  const activeIncident = useEditorStore((s) => s.activeFailureIncident);
  const reportFailureIncident = useEditorStore((s) => s.reportFailureIncident);
  const executeRecoveryAction = useEditorStore((s) => s.executeRecoveryAction);

  const [activeSection, setActiveSection] = useState<
    'controls' | 'recovery' | 'dependencies' | 'limitations' | 'qa' | 'deployment'
  >('controls');

  const [qaReport, setQaReport] = useState<QaSuiteExecutionReport | null>(null);
  const [isRunningQa, setIsRunningQa] = useState(false);

  const [deployReport, setDeployReport] =
    useState<DeploymentSmokeTestReport | null>(null);
  const [isRunningDeploySmoke, setIsRunningDeploySmoke] = useState(false);

  const failureEntries = Object.values(FAILURE_RECOVERY_CATALOG);

  const handleSimulateFailure = (category: EditorFailureCategory) => {
    const spec = FAILURE_RECOVERY_CATALOG[category];
    reportFailureIncident(spec.userExplanation, category);
  };

  const handleRunQaSuite = async () => {
    setIsRunningQa(true);
    try {
      const report = await runAutomatedQaSuite();
      setQaReport(report);
    } finally {
      setIsRunningQa(false);
    }
  };

  const handleRunDeploySmokeTests = async () => {
    setIsRunningDeploySmoke(true);
    try {
      const report = await runDeploymentSmokeTests();
      setDeployReport(report);
    } finally {
      setIsRunningDeploySmoke(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-3xl max-h-[88vh] overflow-y-auto"
        data-testid="security-audit-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>
              Security Controls, Failure Recovery &amp; QA Automation Center
            </span>
          </DialogTitle>
          <DialogDescription>
            Defense-in-depth media signature verification, FFmpeg argument
            isolation, CSP/HTTPS headers, pinned dependency licenses, recovery
            paths for all 9 failure modes, and automated QA binary media probe
            &amp; performance benchmarks.
          </DialogDescription>
        </DialogHeader>

        {/* Section Switcher Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setActiveSection('controls')}
            data-testid="security-tab-controls"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'controls'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            1. Security &amp; CSP
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('recovery')}
            data-testid="security-tab-recovery"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'recovery'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            2. Failure Recovery (9/9)
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('dependencies')}
            data-testid="security-tab-dependencies"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'dependencies'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            3. Dependencies &amp; Licenses
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('limitations')}
            data-testid="security-tab-limitations"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'limitations'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            4. Security Limitations
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('qa')}
            data-testid="security-tab-qa"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'qa'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            5. QA Suite &amp; Media Probe
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('deployment')}
            data-testid="security-tab-deployment"
            className={`px-2.5 py-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeSection === 'deployment'
                ? 'bg-sky-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            6. Deployment &amp; Free Hosts
          </button>
        </div>

        {/* Active Incident Callout inside Dialog */}
        {activeIncident && (
          <div
            data-testid="dialog-active-incident-card"
            className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-rose-200">
                Active Failure Incident: {activeIncident.recoverySpec.title}
              </span>
              <span className="font-mono text-[10px] text-rose-300">
                {activeIncident.category}
              </span>
            </div>
            <p className="text-[11px] text-rose-100/90">
              {activeIncident.customDetail ||
                activeIncident.recoverySpec.userExplanation}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  void executeRecoveryAction(
                    activeIncident.recoverySpec.primaryActionId
                  )
                }
              >
                {activeIncident.recoverySpec.primaryActionLabel}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  void executeRecoveryAction(
                    activeIncident.recoverySpec.secondaryActionId
                  )
                }
              >
                {activeIncident.recoverySpec.secondaryActionLabel}
              </Button>
            </div>
          </div>
        )}

        {/* TAB 1: SECURITY CONTROLS & CSP */}
        {activeSection === 'controls' && (
          <div className="space-y-3 text-xs text-slate-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <FileWarning className="h-4 w-4 text-sky-400" />
                  <span>Binary Magic-Byte Media Verification</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  File extensions and browser MIME types are treated as
                  insufficient proof of validity. Every imported file undergoes
                  64-byte binary container signature inspection (ISO BMFF/ftyp,
                  EBML/WebM, RIFF/WAV/WebP, OggS, PNG, JPEG, GIF, ID3/ADTS) and
                  blocks disguised executables (PE, ELF, Mach-O, shell scripts)
                  and active HTML/SVG/Script payloads before decoding.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <span>FFmpeg Argument &amp; Export Validation</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Export parameters are validated against strict format,
                  resolution, FPS, and even-dimension bounds. FFmpeg commands
                  are constructed as discrete{' '}
                  <code className="text-slate-200">string[]</code> arrays
                  validated against an explicit flag allowlist, blocking shell
                  metacharacters, protocol breakouts (
                  <code className="text-slate-200">file:</code>,{' '}
                  <code className="text-slate-200">http:</code>,{' '}
                  <code className="text-slate-200">concat:</code>), and path
                  traversal.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Lock className="h-4 w-4 text-amber-400" />
                  <span>Zero Unsafe HTML &amp; Text Sanitization</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Uploaded files are never executed or mounted into the DOM.
                  User-generated titles, SRT subtitles, and project names are
                  sanitized to strip{' '}
                  <code className="text-slate-200">&lt;script&gt;</code>,{' '}
                  <code className="text-slate-200">&lt;svg&gt;</code>, event
                  handlers, NUL bytes, and Unicode Bidi-override spoofing
                  characters while preserving Hindi Devanagari and multilingual
                  graphemes.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>Local-Only Default &amp; Zero Media Analytics</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {PRIVACY_AND_TELEMETRY_POLICY.summary} No API keys or secrets
                  are exposed in client-side bundles.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-semibold text-white">
                Configured HTTP Security Headers &amp; Content Security Policy
                (CSP)
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                {SECURITY_HEADERS_LIST.map((h) => (
                  <div
                    key={h.key}
                    className="p-2 rounded bg-slate-950 border border-slate-800/80 break-all"
                  >
                    <span className="text-sky-400 font-semibold">{h.key}:</span>{' '}
                    <span className="text-slate-300">{h.value}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                Active CSP string length: {buildContentSecurityPolicy().length}{' '}
                chars · Enforces HTTPS upgrade-insecure-requests, HSTS preload,
                nosniff, and object-src &apos;none&apos;.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: VISIBLE RECOVERY PATHS FOR ALL 9 EXPECTED FAILURES */}
        {activeSection === 'recovery' && (
          <div className="space-y-3 text-xs text-slate-300">
            <p className="text-slate-400 text-[11px]">
              Every expected failure mode has a deterministic classification and
              a visible, one-click recovery path. Click{' '}
              <strong className="text-white">Test Recovery Banner</strong> on
              any scenario below to inspect and trigger its live recovery
              workflow.
            </p>
            <div
              className="space-y-2"
              data-testid="failure-recovery-catalog-list"
            >
              {failureEntries.map((spec) => (
                <div
                  key={spec.category}
                  data-testid={`recovery-card-${spec.category}`}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">
                        {spec.title}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {spec.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {spec.userExplanation}
                    </p>
                    <div className="text-[10px] text-sky-400 font-mono">
                      Recovery Path: {spec.primaryActionLabel} ·{' '}
                      {spec.secondaryActionLabel}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleSimulateFailure(spec.category)}
                      data-testid={`simulate-failure-${spec.category}`}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                      <span>Test Recovery Banner</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: PINNED DEPENDENCIES & LICENSES */}
        {activeSection === 'dependencies' && (
          <div className="space-y-3 text-xs text-slate-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-white">
                <PackageCheck className="h-4 w-4 text-emerald-400" />
                <span>Pinned Dependency Versions &amp; SPDX License Review</span>
              </div>
              <span className="font-mono text-[11px] text-emerald-400">
                0 Floating Ranges (100% Exact Pinned)
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-900 text-slate-300 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Package</th>
                    <th className="py-2 px-3 font-semibold">Pinned Version</th>
                    <th className="py-2 px-3 font-semibold">SPDX License</th>
                    <th className="py-2 px-3 font-semibold">
                      Security Role &amp; Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-950">
                  {DEPENDENCY_SECURITY_MANIFEST.map((dep) => (
                    <tr key={dep.packageName}>
                      <td className="py-2 px-3 font-mono text-white">
                        {dep.packageName}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-sky-400">
                        {dep.pinnedVersion}
                      </td>
                      <td className="py-2 px-3 font-mono text-emerald-400">
                        {dep.spdxLicense}
                      </td>
                      <td className="py-2 px-3 text-slate-400">
                        <div>{dep.securityRole}</div>
                        {dep.licenseNotes && (
                          <div className="text-[10px] text-amber-300/90 mt-0.5">
                            Note: {dep.licenseNotes}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: DOCUMENTED SECURITY LIMITATIONS & PRIVACY */}
        {activeSection === 'limitations' && (
          <div
            className="space-y-3 text-xs text-slate-300"
            data-testid="security-limitations-section"
          >
            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-200 text-[11px] leading-relaxed">
              <strong>Engineering Security Disclosure:</strong> Client-side
              processing prevents server-side media data breaches, but{' '}
              <strong>
                does not automatically make the entire application secure
              </strong>
              . Browser decoders, WebAssembly runtimes, local disk storage on
              shared machines, and third-party scripts remain part of the threat
              model and require explicit controls.
            </div>

            <div className="space-y-2.5">
              {SECURITY_LIMITATIONS_DOCUMENTATION.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5"
                >
                  <div className="font-semibold text-white">{item.title}</div>
                  <p className="text-[11px] text-slate-400">
                    <strong className="text-slate-200">
                      Threat / Limitation:
                    </strong>{' '}
                    {item.limitation}
                  </p>
                  <p className="text-[11px] text-emerald-300/90">
                    <strong>Control Implemented:</strong>{' '}
                    {item.mitigationImplemented}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: QA AUTOMATION SUITE, MEDIA PROBE & BROWSER COVERAGE */}
        {activeSection === 'qa' && (
          <div
            className="space-y-4 text-xs text-slate-300"
            data-testid="qa-automation-section"
          >
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <FlaskConical className="h-4 w-4 text-sky-400" />
                  <span>
                    Automated QA Runner, Binary Container Decoder &amp;
                    Performance Suite
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Executes unit math, 8-stage integration pipeline, binary ISO
                  BMFF/WebM/WAV media container probe, and repeatable Small
                  (720p) vs Medium (1080p) hardware benchmarks.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleRunQaSuite()}
                disabled={isRunningQa}
                data-testid="run-qa-suite-btn"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                <span>
                  {isRunningQa
                    ? 'Running QA Suite...'
                    : 'Run Live QA Verification'}
                </span>
              </Button>
            </div>

            {/* Live QA Execution Results */}
            {qaReport && (
              <div
                className="space-y-3"
                data-testid="qa-suite-execution-results"
              >
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-emerald-200">
                    Executed {qaReport.totalChecks} Automated Verification
                    Suites · {qaReport.passedChecks} Passed ·{' '}
                    {qaReport.failedChecks} Failed
                  </div>
                  <span className="font-mono text-[10px] text-emerald-300">
                    {qaReport.executedAt}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {qaReport.steps.map((step) => (
                    <div
                      key={step.stepId}
                      className="p-2.5 rounded bg-slate-900 border border-slate-800 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 font-semibold text-white">
                          {step.passed ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          )}
                          <span>
                            [{step.stepId}] {step.name}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 pl-5">
                          {step.assertionDetails}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-sky-400 tabular-nums shrink-0">
                        {step.durationMs} ms
                      </span>
                    </div>
                  ))}
                </div>

                {qaReport.probedExportReport && (
                  <div
                    className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5"
                    data-testid="qa-probed-export-card"
                  >
                    <div className="font-semibold text-white">
                      Decoded Binary Export Output Probe (ISO BMFF Container
                      Inspector)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
                      <div className="p-2 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-500 text-[10px]">Format</div>
                        <div className="text-sky-400">
                          {qaReport.probedExportReport.containerFormat.toUpperCase()}{' '}
                          ({qaReport.probedExportReport.videoCodec} /{' '}
                          {qaReport.probedExportReport.audioCodec})
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-500 text-[10px]">
                          Dimensions &amp; FPS
                        </div>
                        <div className="text-emerald-400">
                          {qaReport.probedExportReport.width}×
                          {qaReport.probedExportReport.height} @{' '}
                          {qaReport.probedExportReport.fps}fps
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-500 text-[10px]">
                          Decoded Duration
                        </div>
                        <div className="text-white">
                          {qaReport.probedExportReport.durationSec}s (
                          {qaReport.probedExportReport.sizeBytes} bytes)
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-950 border border-slate-800">
                        <div className="text-slate-500 text-[10px]">
                          Verified Atoms
                        </div>
                        <div className="text-amber-300">
                          {qaReport.probedExportReport.atomsOrChunksFound.join(
                            ' · '
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Performance Benchmarks Table */}
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Cpu className="h-4 w-4 text-sky-400" />
                    <span>
                      Repeatable Hardware Performance Benchmarks (Small 720p vs
                      Medium 1080p)
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-[11px] font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-1.5 px-2">Workload</th>
                          <th className="py-1.5 px-2">Hardware Profile</th>
                          <th className="py-1.5 px-2">Clips</th>
                          <th className="py-1.5 px-2">Preview Scale</th>
                          <th className="py-1.5 px-2">120-Frame Sched</th>
                          <th className="py-1.5 px-2">Total Pipeline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {qaReport.performanceBenchmarks.map((b) => (
                          <tr key={b.id}>
                            <td className="py-1.5 px-2 text-white">
                              {b.workloadName} ({b.resolution})
                            </td>
                            <td className="py-1.5 px-2 text-sky-400">
                              {b.hardwareProfile}
                            </td>
                            <td className="py-1.5 px-2">{b.clipCount}</td>
                            <td className="py-1.5 px-2">
                              {Math.round(b.previewScaleRatio * 100)}%
                            </td>
                            <td className="py-1.5 px-2">
                              {b.metricsMs.frameSchedule120FramesMs} ms
                            </td>
                            <td className="py-1.5 px-2 text-emerald-400">
                              {b.metricsMs.totalPipelineMs} ms (&le;
                              {b.budgetMs} ms)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Reference Legal Media Fixtures */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-semibold text-white">
                Deterministic Legal Test Media Fixtures (CC0 Binary Containers)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                {Object.values(STANDARD_QA_MEDIA_FIXTURES).map((f) => (
                  <div
                    key={f.id}
                    className="p-2 rounded bg-slate-950 border border-slate-800/80"
                  >
                    <div className="font-mono text-sky-400 font-semibold">
                      {f.filename}
                    </div>
                    <div className="text-slate-400">{f.description}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Codec: {f.videoCodec}/{f.audioCodec} · License:{' '}
                      {f.license}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Coverage Matrix */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Globe className="h-4 w-4 text-emerald-400" />
                <span>
                  Supported Browser Coverage Matrix &amp; Documented Feature
                  Differences
                </span>
              </div>
              <div className="space-y-2">
                {BROWSER_COVERAGE_MATRIX.map((b) => (
                  <div
                    key={b.browser}
                    className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {b.browser} ({b.minimumStableVersion}) — {b.engine}
                      </span>
                      <span className="font-mono text-[10px] text-emerald-400">
                        {b.status}
                      </span>
                    </div>
                    <ul className="list-disc pl-4 text-[11px] text-slate-400 space-y-0.5">
                      {b.documentedFeatureDifferences.map((diff, i) => (
                        <li key={i}>{diff}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Honest Report of Failed / Environment-Blocked Checks & Unresolved Limitations */}
            <div
              className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/30 space-y-2"
              data-testid="qa-unresolved-limitations-list"
            >
              <div className="font-semibold text-rose-200">
                Reported Environment-Failed Checks &amp; Unresolved Technical
                Limitations
              </div>
              <div className="space-y-2">
                {QA_UNRESOLVED_LIMITATIONS_AND_ENV_REPORT.map((lim) => (
                  <div
                    key={lim.id}
                    className="p-2.5 rounded bg-slate-950/90 border border-rose-500/20 space-y-1 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        [{lim.id}] {lim.title}
                      </span>
                      <span className="font-mono text-[10px] text-rose-400">
                        {lim.status}
                      </span>
                    </div>
                    <p className="text-slate-400">
                      <strong className="text-slate-200">Observed:</strong>{' '}
                      {lim.observedBehavior}
                    </p>
                    <p className="text-emerald-300/90">
                      <strong>Mitigation:</strong> {lim.mitigationInApp}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: DEPLOYMENT & FREE HOSTING READINESS */}
        {activeSection === 'deployment' && (
          <div className="space-y-4 text-xs" data-testid="deployment-readiness-panel">
            {/* Smoke Test Runner Header */}
            <div className="p-3.5 rounded-lg bg-emerald-950/35 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="font-semibold text-emerald-200 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-emerald-400" />
                  <span>
                    Production Deployment Smoke Tests &amp; Free Host Verification
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Verifies dual-mode Next.js architecture (Standalone vs Static Export),
                  zero public secrets, WebAssembly binary compilation &amp;{' '}
                  <code className="font-mono">application/wasm</code> MIME rules, Blob
                  Worker IPC, CSP/HTTPS, and zero-backend MP4 export.
                </p>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleRunDeploySmokeTests()}
                disabled={isRunningDeploySmoke}
                data-testid="run-deployment-smoke-btn"
              >
                {isRunningDeploySmoke
                  ? 'Running Smoke Suite...'
                  : 'Run Deployment Smoke Tests (8/8)'}
              </Button>
            </div>

            {/* Live Smoke Test Report */}
            {deployReport && (
              <div
                className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5"
                data-testid="deployment-smoke-results"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    Smoke Suite Status: {deployReport.passedCount} /{' '}
                    {deployReport.totalCount} Passed
                  </span>
                  <span className="font-mono text-[10px] text-emerald-400">
                    Mode: {deployReport.runtimeReport.selectedFfmpegThreadingMode}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {deployReport.steps.map((step) => (
                    <div
                      key={step.id}
                      className="p-2 rounded bg-slate-950 border border-slate-800 flex items-start justify-between gap-2 text-[11px]"
                    >
                      <div className="space-y-0.5">
                        <div className="font-medium text-white flex items-center gap-1.5">
                          {step.passed ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                          )}
                          <span>
                            [{step.id}] {step.name}
                          </span>
                        </div>
                        <p className="text-slate-400 pl-5">{step.detail}</p>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">
                        {step.durationMs} ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Next.js Static vs Server Architecture Assessment */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-semibold text-white">
                Next.js Architecture Assessment (Server vs Static Export)
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {NEXTJS_ARCHITECTURE_ASSESSMENT.architecturalRationale}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                  <div className="font-semibold text-sky-300">
                    Mode A: Standalone / Server (Default)
                  </div>
                  <p className="text-slate-400 mt-1">
                    {NEXTJS_ARCHITECTURE_ASSESSMENT.whenToUseStandaloneOrEdge}
                  </p>
                </div>
                <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                  <div className="font-semibold text-emerald-300">
                    Mode B: Static Export (NEXT_OUTPUT_MODE=export)
                  </div>
                  <p className="text-slate-400 mt-1">
                    {NEXTJS_ARCHITECTURE_ASSESSMENT.whenToUseStaticExport}
                  </p>
                </div>
              </div>
            </div>

            {/* Free Hosting Provider Comparison Matrix */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-semibold text-white">
                Free Hosting Provider Matrix &amp; Configuration Differences
              </div>
              <div className="space-y-2">
                {FREE_HOSTING_PROVIDER_MATRIX.map((host) => (
                  <div
                    key={host.id}
                    className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1 text-[11px]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {host.providerName}
                      </span>
                      <span className="font-mono text-[10px] text-sky-400">
                        Build: {host.buildCommand} → {host.outputDirectory}
                      </span>
                    </div>
                    <div className="text-slate-300">
                      <strong>Bandwidth &amp; Limits:</strong>{' '}
                      {host.monthlyBandwidthLimit} |{' '}
                      <strong>Max File:</strong> {host.maxSingleFileSizeLimit}
                    </div>
                    <div className="text-slate-400">
                      <strong>Headers / WASM Config:</strong>{' '}
                      {host.headerConfigMechanism}
                    </div>
                    <div className="text-emerald-300/90">
                      <strong>FFmpeg.wasm Strategy:</strong>{' '}
                      {host.ffmpegWasmDeliveryStrategy}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Troubleshooting & Rollback Runbook */}
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
              <div className="font-semibold text-white">
                Troubleshooting Guide &amp; Atomic Rollback Procedure
              </div>
              <div className="space-y-1.5">
                {DEPLOYMENT_RUNBOOK.rollbackProcedure.map((rb) => (
                  <div
                    key={rb.step}
                    className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px]"
                  >
                    <div className="font-semibold text-amber-300">{rb.step}</div>
                    <p className="text-slate-300 mt-0.5">{rb.action}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

