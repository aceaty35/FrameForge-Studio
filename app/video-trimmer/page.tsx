import React from 'react';
import type { Metadata } from 'next';
import { buildNextMetadata } from '@/lib/seo/registry';
import { ToolLandingTemplate } from '@/components/seo/tool-landing-template';

export const metadata: Metadata = buildNextMetadata('/video-trimmer');

export default function VideoTrimmerPage() {
  return <ToolLandingTemplate path="/video-trimmer" />;
}
