import React from 'react';
import type { Metadata } from 'next';
import { buildPrivateProjectMetadata } from '@/lib/seo/registry';
import { LazyWorkspaceLoader } from '@/components/editor/lazy-workspace-loader';

interface PrivateProjectPageProps {
  params: Promise<{ projectId: string }>;
}

export async function generateMetadata({
  params,
}: PrivateProjectPageProps): Promise<Metadata> {
  const { projectId } = await params;
  return buildPrivateProjectMetadata(projectId);
}

export default async function PrivateProjectPage({
  params,
}: PrivateProjectPageProps) {
  const { projectId } = await params;

  return (
    <main
      data-testid="private-project-page"
      data-project-id={projectId}
      className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col"
    >
      <LazyWorkspaceLoader initialTab="projects" />
    </main>
  );
}
