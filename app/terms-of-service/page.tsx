import React from 'react';
import type { Metadata } from 'next';
import { buildNextMetadata } from '@/lib/seo/registry';
import { ToolLandingTemplate } from '@/components/seo/tool-landing-template';

export const metadata: Metadata = buildNextMetadata('/terms-of-service');

export default function TermsOfServicePage() {
  return <ToolLandingTemplate path="/terms-of-service" />;
}
