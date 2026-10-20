import React from 'react';
import type { Metadata } from 'next';
import { buildNextMetadata } from '@/lib/seo/registry';
import { ToolLandingTemplate } from '@/components/seo/tool-landing-template';

export const metadata: Metadata = buildNextMetadata('/online-video-editor');

export default function OnlineVideoEditorPage() {
  return <ToolLandingTemplate path="/online-video-editor" />;
}
