import React from 'react';
import type { Metadata } from 'next';
import { buildNextMetadata } from '@/lib/seo/registry';
import { ToolLandingTemplate } from '@/components/seo/tool-landing-template';

export const metadata: Metadata = buildNextMetadata('/video-resizer');

export default function VideoResizerPage() {
  return <ToolLandingTemplate path="/video-resizer" />;
}
