import {Section, Text} from '@react-email/components';
import * as React from 'react';

interface FooterProps {
  projectId?: string;
  /** @deprecated kept for call-site compatibility; no external links are rendered */
  landingUrl?: string;
}

export function Footer({projectId}: FooterProps) {
  return (
    <Section className="border-t border-gray-100 bg-gray-50 px-8 py-8">
      <Text className="mb-4 mt-0 text-center text-xs leading-relaxed text-gray-600">
        This is an automated message from your email platform.
      </Text>
      {projectId && (
        <Text className="mb-4 mt-0 text-center text-xs leading-relaxed text-gray-400">
          Project ID: <span className="font-mono">{projectId}</span>
        </Text>
      )}
    </Section>
  );
}
