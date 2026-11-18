import {Button, Card, CardContent, CardHeader, CardTitle} from '@plunk/ui';
import {BookOpen, CheckCircle2, Mail, Shield, Users, Zap} from 'lucide-react';
import Link from 'next/link';
import {useMemo} from 'react';
import {WIKI_URI} from '../lib/constants';
import type {ProjectSetupState} from '../lib/hooks/useProjectSetupState';
import {useConfig} from '../lib/hooks/useConfig';
import {t} from '../lib/i18n';

interface QuickStartStep {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  link: string;
  linkText: string;
  isCompleted: boolean;
}

interface QuickStartProps {
  setupState: ProjectSetupState | undefined;
  isLoading: boolean;
}

// Help resources that always appear
function HelpResources() {
  return (
    <div className="px-6 pb-6 pt-4 border-t border-neutral-200">
      <p className="text-xs font-medium text-neutral-500 mb-3">{t('Need help?')}</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Button asChild variant="outline" size="sm" className="flex-1">
          <Link href={WIKI_URI} target="_blank">
            <BookOpen className="h-3.5 w-3.5" />
            {t('Documentation')}
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function QuickStart({setupState, isLoading}: QuickStartProps) {
  // Calculate days since last campaign using useMemo to avoid impure function during render
  // Must be called before any early returns to follow Rules of Hooks
  const daysSinceLastCampaign = useMemo(() => {
    if (!setupState || !setupState.lastCampaignSentAt) return null;
    const now = new Date();
    const lastSent = new Date(setupState.lastCampaignSentAt);
    return Math.floor((now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24));
  }, [setupState]);

  const {data: config} = useConfig();
  const billingEnabled = config?.features.billing.enabled ?? false;

  if (isLoading || !setupState) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader>
          <CardTitle>{t('Quick start')}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="flex items-start gap-4 p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 animate-pulse"
              >
                <div className="h-10 w-10 rounded-lg bg-neutral-200" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-neutral-200 rounded w-1/3" />
                  <div className="h-3 bg-neutral-200 rounded w-2/3" />
                </div>
                <div className="h-9 w-20 bg-neutral-200 rounded-lg" />
              </div>
            ))}
          </div>
        </CardContent>
        <HelpResources />
      </Card>
    );
  }

  const hasContacts = setupState.contactCount > 0;
  const hasSentCampaign = setupState.lastCampaignSentAt !== null;
  const hasRecentCampaign = daysSinceLastCampaign !== null && daysSinceLastCampaign <= 30;

  // Build dynamic steps based on setup state with proper prioritization
  // Priority order: Domain → Contacts → Campaign → Workflow → Subscription
  const allSteps: QuickStartStep[] = [];

  // Priority 1: Domain verification (critical for deliverability)
  if (!setupState.hasVerifiedDomain) {
    allSteps.push({
      id: 'domain',
      icon: Shield,
      title: t('Verify your domain'),
      description: t('Unverified domains land in spam.'),
      link: '/settings?tab=domains',
      linkText: t('Add domain'),
      isCompleted: false,
    });
  }

  // Priority 2: Add contacts (can't send without contacts)
  if (!hasContacts) {
    allSteps.push({
      id: 'contacts',
      icon: Users,
      title: t('Add your first contacts'),
      description: t('Import a CSV or add them through the API.'),
      link: '/contacts',
      linkText: t('Add contacts'),
      isCompleted: false,
    });
  }

  // Priority 3: Send campaign (core functionality, show if they have contacts but never sent)
  if (hasContacts && !hasSentCampaign) {
    allSteps.push({
      id: 'campaign',
      icon: Mail,
      title: t('Send your first campaign'),
      description: t('Write it, preview it, send it.'),
      link: '/campaigns',
      linkText: t('Create campaign'),
      isCompleted: false,
    });
  }

  // Priority 4: Set up automation (advanced feature, only show if no workflow and have contacts)
  if (hasContacts && !setupState.hasEnabledWorkflow) {
    allSteps.push({
      id: 'workflows',
      icon: Zap,
      title: t('Set up automation'),
      description: t('Send email automatically when contacts trigger an event.'),
      link: '/workflows',
      linkText: t('Create workflow'),
      isCompleted: false,
    });
  }

  // Priority 5: Subscription (nice to have, lower priority)
  if (billingEnabled && !setupState.hasSubscription) {
    allSteps.push({
      id: 'subscription',
      icon: Shield,
      title: t('Upgrade your plan'),
      description: t('Remove Plunk branding from your emails.'),
      link: '/settings?tab=billing',
      linkText: t('Upgrade'),
      isCompleted: false,
    });
  }

  // Priority 6: Re-engagement (show if they've been inactive)
  if (hasSentCampaign && !hasRecentCampaign && daysSinceLastCampaign !== null && daysSinceLastCampaign > 30) {
    allSteps.push({
      id: 'campaign-reengagement',
      icon: Mail,
      title: t('Re-engage your contacts'),
      description: t('{daysSinceLastCampaign} days since your last campaign.', {daysSinceLastCampaign: daysSinceLastCampaign}),
      link: '/campaigns',
      linkText: t('Create campaign'),
      isCompleted: false,
    });
  }

  // If core setup is complete and they're actively sending, show success message
  if (setupState.hasVerifiedDomain && hasContacts && hasSentCampaign && hasRecentCampaign) {
    return (
      <Card className="flex flex-col h-full">
        <CardHeader>
          <CardTitle>{t('Quick start')}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-start gap-4 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="h-10 w-10 rounded-lg bg-green-100 border border-green-200 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-5 w-5 text-green-700" />
            </div>
            <div className="flex-1 pt-0.5">
              <p className="text-sm font-semibold text-green-900 mb-1">{t('All set!')}</p>
              <p className="text-xs text-green-700 leading-relaxed">
                {t('Domain verified, contacts imported, campaigns running.')}
              </p>
            </div>
          </div>
        </CardContent>
        <HelpResources />
      </Card>
    );
  }

  // Show only the first 3 most important steps
  const visibleSteps = allSteps.slice(0, 3);

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <CardTitle>{t('Quick start')}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-3">
          {visibleSteps.map(step => {
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                className="group relative flex items-start gap-4 p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50 hover:border-neutral-300 transition-all duration-200"
              >
                <div
                  className={`h-10 w-10 rounded-lg ${step.isCompleted ? 'bg-green-100 border border-green-200' : 'bg-white border border-neutral-200'} flex items-center justify-center flex-shrink-0 transition-colors`}
                >
                  <Icon
                    className={`h-5 w-5 ${step.isCompleted ? 'text-green-700' : 'text-neutral-600'} transition-colors`}
                  />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-sm font-semibold text-neutral-900">{step.title}</p>
                    {step.isCompleted && <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />}
                  </div>
                  <p className="text-xs text-neutral-600 leading-relaxed">{step.description}</p>
                </div>
                <Button asChild size="sm" variant={step.isCompleted ? 'outline' : 'default'} className="flex-shrink-0">
                  <Link href={step.link}>{step.linkText}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
      <HelpResources />
    </Card>
  );
}
