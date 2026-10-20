import React from 'react';
import type { Metadata } from 'next';
import { buildNextMetadata } from '@/lib/seo/registry';
import { ToolLandingTemplate } from '@/components/seo/tool-landing-template';

export const metadata: Metadata = buildNextMetadata('/video-to-audio-converter');

export default function VideoToAudioConverterPage() {
  return <ToolLandingTemplate path="/video-to-audio-converter" />;
}
