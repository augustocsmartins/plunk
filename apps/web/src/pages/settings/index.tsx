import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {zodResolver} from '@hookform/resolvers/zod';
import {ProjectSchemas, SUPPORTED_LANGUAGES} from '@plunk/shared';
import {TrackingMode} from '@plunk/db';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectItemWithDescription,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@plunk/ui';
import {AnimatePresence, motion} from 'framer-motion';
import {NextSeo} from 'next-seo';
import {
  AlertTriangle,
  CreditCard,
  Database,
  Globe,
  KeyRound,
  Mail,
  MessageCircle,
  RotateCcw,
  Settings as SettingsIcon,
  Shield,
  Users,
} from 'lucide-react';
import type {z} from 'zod';
import {useRouter} from 'next/router';
import {DashboardLayout} from '../../components/DashboardLayout';
import {DomainsSettings} from '../../components/DomainsSettings';
import {BillingLimits} from '../../components/BillingLimits';
import {BillingConsumption} from '../../components/BillingConsumption';
import {BillingInvoices} from '../../components/BillingInvoices';
import {UnpaidInvoiceBanner} from '../../components/UnpaidInvoiceBanner';
import {ApiKeyDisplay} from '../../components/ApiKeyDisplay';
import {SmtpSettings} from '../../components/SmtpSettings';
import {DataManagementSettings} from '../../components/DataManagementSettings';
import {TeamSettings} from '../../components/TeamSettings';
import {SecuritySettings} from '../../components/SecuritySettings';
import {WhatsAppSettings} from '../../components/WhatsAppSettings';
import {useActiveProject} from '../../lib/contexts/ActiveProjectProvider';
import {network} from '../../lib/network';
import {useProjects} from '../../lib/hooks/useProject';
import {useConfig} from '../../lib/hooks/useConfig';
import {useUser} from '../../lib/hooks/useUser';
import {useProjectSecurity} from '../../lib/hooks/useProjectSecurity';
import useSWR from 'swr';
import {t} from '../../lib/i18n';

type TabId = 'general' | 'billing' | 'domains' | 'smtp' | 'whatsapp' | 'data' | 'team' | 'security';

interface Tab {
  id: TabId;
  label: string;
  icon: typeof SettingsIcon;
  condition?: boolean;
}

/** Why sending is paused, for the pauses the customer clears by updating their card. */
const BILLING_PAUSE_COPY: Record<string, string> = {
  PAYMENT_FAILED:
    t('Your last payment didn’t go through. Add a working card and we’ll retry the payment straight away. Sending resumes once it’s paid.'),
  CARD_VERIFICATION_FAILED:
    t('Your card declined the charge we use to confirm it supports monthly billing. Add a standard credit or debit card (prepaid cards aren’t supported) and we’ll verify it straight away.'),
  CARD_VERIFICATION_REQUIRED:
    t('Your bank didn’t approve the charge we use to confirm your card supports monthly billing. Add your card again, or a different one, and we’ll verify it straight away.'),
};

const buildTabs = (options: {billingEnabled: boolean; smtpEnabled: boolean; whatsappEnabled: boolean}): Tab[] => {
  const {billingEnabled, smtpEnabled, whatsappEnabled} = options;
  const allTabs: Tab[] = [
    {id: 'general', label: t('General'), icon: SettingsIcon},
    {id: 'team', label: t('Team'), icon: Users},
    {id: 'security', label: t('Security'), icon: Shield},
    {id: 'billing', label: t('Billing'), icon: CreditCard, condition: billingEnabled},
    {id: 'domains', label: t('Domains'), icon: Globe},
    {id: 'smtp', label: 'SMTP', icon: Mail, condition: smtpEnabled},
    {id: 'whatsapp', label: t('WhatsApp'), icon: MessageCircle, condition: whatsappEnabled},
    {id: 'data', label: t('Data'), icon: Database},
  ];
  return allTabs.filter(tab => tab.condition !== false);
};

export default function Settings() {
  const router = useRouter();
  const {activeProject, setActiveProject, updateActiveProject} = useActiveProject();
  const {mutate: projectsMutate} = useProjects();
  const {data: config} = useConfig();
  const {data: user} = useUser();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  type SettingsDialog = {type: 'none'} | {type: 'regenerate'} | {type: 'delete'} | {type: 'reset'};
  const [dialog, setDialog] = useState<SettingsDialog>({type: 'none'});
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('auto');
  const [showCurrencySelector, setShowCurrencySelector] = useState(false);

  // Fetch current user's membership for the active project
  const {data: membershipData} = useSWR<{
    success: boolean;
    data: Array<{userId: string; email: string; role: 'OWNER' | 'ADMIN' | 'MEMBER'}>;
  }>(activeProject?.id ? `/projects/${activeProject.id}/members` : null, {revalidateOnFocus: false});

  const currentUserMembership = membershipData?.data.find(m => m.userId === user?.id);
  const currentUserRole = currentUserMembership?.role || 'MEMBER';

  const {securityMetrics, isLoading: isLoadingSecurityMetrics} = useProjectSecurity(activeProject?.id);

  const billingEnabled = config?.features.billing.enabled ?? false;
  const billingPause = activeProject?.disabled ? BILLING_PAUSE_COPY[activeProject.disabledReason ?? ''] : undefined;
  const smtpEnabled = config?.features.smtp.enabled ?? false;
  const whatsappEnabled = config?.features.whatsapp?.enabled ?? false;
  const trackingToggleEnabled = config?.features.email.trackingToggleEnabled ?? false;
  const smtpConfig = smtpEnabled
    ? {
        enabled: true as const,
        domain: config?.features.smtp.domain ?? undefined,
        portSecure: config?.features.smtp.ports?.secure,
        portSubmission: config?.features.smtp.ports?.submission,
      }
    : {enabled: false as const};

  // Get current tab from URL or default to 'general'
  const currentTab = (router.query.tab as TabId) || 'general';

  // Set default tab in URL if none is present
  useEffect(() => {
    if (!router.query.tab && router.isReady) {
      router.replace('/settings?tab=general', undefined, {shallow: true});
    }
  }, [router]);

  // Handler to change tabs and update URL
  const handleTabChange = (newTab: string) => {
    router.push(`/settings?tab=${newTab}`, undefined, {shallow: true});
  };

  // Handle Stripe redirect success/cancel messages
  useEffect(() => {
    if (!router.isReady) return;

    if (router.query.success === 'true') {
      // Use setTimeout to defer state update, avoiding synchronous setState in effect
      const timer = setTimeout(() => {
        setSuccessMessage(t('Subscription active. Billing details may take a minute to appear.'));
        // Clear message and URL after 5 seconds
        setTimeout(() => {
          setSuccessMessage(null);
          router.replace('/settings?tab=billing', undefined, {shallow: true});
        }, 5000);
      }, 0);
      return () => clearTimeout(timer);
    } else if (router.query.canceled === 'true') {
      // Use setTimeout to defer state update, avoiding synchronous setState in effect
      const timer = setTimeout(() => {
        setErrorMessage(t('Checkout was canceled. You can try again anytime.'));
        // Clear message and URL after 5 seconds
        setTimeout(() => {
          setErrorMessage(null);
          router.replace('/settings?tab=billing', undefined, {shallow: true});
        }, 5000);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [router]);

  const form = useForm<z.infer<typeof ProjectSchemas.update>>({
    resolver: zodResolver(ProjectSchemas.update),
    defaultValues: {
      name: activeProject?.name || '',
      tracking: activeProject?.tracking ?? TrackingMode.ENABLED,
      language: activeProject?.language || 'en',
    },
  });

  // Update form when active project changes
  useEffect(() => {
    if (activeProject) {
      form.reset({
        name: activeProject.name,
        tracking: activeProject.tracking ?? TrackingMode.ENABLED,
        language: activeProject.language || 'en',
      });
    }
  }, [activeProject, form]);

  const onSubmit = async (values: z.infer<typeof ProjectSchemas.update>) => {
    if (!activeProject) return;

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      const updatedProject = await network.fetch<typeof activeProject, typeof ProjectSchemas.update>(
        'PATCH',
        `/users/@me/projects/${activeProject.id}`,
        values,
      );

      // Update the active project in context without invalidating the full SWR cache
      updateActiveProject(updatedProject);

      // Refresh projects list
      await projectsMutate();

      setSuccessMessage(t('Project settings updated'));

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t save your project settings. Try again.'));
    }
  };

  const handleRegenerateKeys = async () => {
    if (!activeProject) return;

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      const updatedProject = await network.fetch<typeof activeProject>(
        'POST',
        `/users/@me/projects/${activeProject.id}/regenerate-keys`,
      );

      // Update the active project in context
      setActiveProject(updatedProject);

      // Refresh projects list
      await projectsMutate();

      setSuccessMessage('API keys regenerated');
      setDialog({type: 'none'});

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t regenerate your API keys. Try again.'));
      setDialog({type: 'none'});
    }
  };

  const promptRegenerateKeys = () => {
    setDialog({type: 'regenerate'});
  };

  const handleStartSubscription = async (currency: string = 'auto') => {
    if (!activeProject) return;
    if (!billingEnabled) {
      setErrorMessage(t('Billing is disabled on this instance.'));
      return;
    }

    try {
      setIsLoadingBilling(true);
      setErrorMessage(null);

      // Build URL with optional currency parameter
      const url =
        currency === 'auto'
          ? `/users/@me/projects/${activeProject.id}/checkout`
          : `/users/@me/projects/${activeProject.id}/checkout?currency=${currency}`;

      const response = await network.fetch<{url: string}>('POST', url);

      // Redirect to Stripe checkout
      if (response.url) {
        window.location.href = response.url;
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t open checkout. Try again in a moment.'));
      setIsLoadingBilling(false);
    }
  };

  const handleManageBilling = async () => {
    if (!activeProject) return;
    if (!billingEnabled) {
      setErrorMessage(t('Billing is disabled on this instance.'));
      return;
    }

    try {
      setIsLoadingBilling(true);
      setErrorMessage(null);

      const response = await network.fetch<{url: string}>(
        'POST',
        `/users/@me/projects/${activeProject.id}/billing-portal`,
      );

      // Redirect to Stripe billing portal
      if (response.url) {
        window.location.href = response.url;
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t open the billing portal. Try again in a moment.'));
      setIsLoadingBilling(false);
    }
  };

  const handleResetProject = async () => {
    if (!activeProject) return;

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      await network.fetch('POST', `/users/@me/projects/${activeProject.id}/reset`);

      setSuccessMessage(t('Project reset. All campaigns, contacts, workflows, templates, and events are gone.'));
      setDialog({type: 'none'});

      // Refresh the page to reload data
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t reset the project. Try again.'));
      setDialog({type: 'none'});
    }
  };

  const handleDeleteProject = async () => {
    if (!activeProject) return;

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      await network.fetch('DELETE', `/users/@me/projects/${activeProject.id}`);

      setSuccessMessage(t('Project deleted. Redirecting…'));
      setDialog({type: 'none'});

      // Refresh projects list and redirect to dashboard
      await projectsMutate();

      // Redirect to dashboard after a short delay
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('Couldn’t delete the project. Try again.'));
      setDialog({type: 'none'});
    }
  };

  if (!activeProject) {
    return (
      <>
        <NextSeo title={t('Settings')} />
        <DashboardLayout>
          <div className="flex items-center justify-center h-96">
            <p className="text-neutral-500">{t('No project selected')}</p>
          </div>
        </DashboardLayout>
      </>
    );
  }

  return (
    <>
      <NextSeo title={t('Settings')} />
      <DashboardLayout>
        <div className="space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('Settings')}</h1>
            <p className="text-neutral-500 mt-2">{t('Settings for this project.')}</p>
          </div>

          {/* Tabs */}
          <Tabs value={currentTab} onValueChange={handleTabChange} className="max-w-4xl">
            <TabsList>
              {buildTabs({billingEnabled, smtpEnabled, whatsappEnabled}).map(tab => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.id} value={tab.id} className="flex items-center gap-2" title={tab.label}>
                    <Icon className="h-4 w-4" />
                    <span className="hidden md:inline">{tab.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general">
              <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('Project settings')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({field}) => (
                          <FormItem>
                            <FormLabel>{t('Project name')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('e.g., Acme')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Email Tracking Mode - only show if feature is available */}
                      {trackingToggleEnabled && (
                        <FormField
                          control={form.control}
                          name="tracking"
                          render={({field}) => (
                            <FormItem>
                              <FormLabel>{t('Email tracking')}</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={t('Select tracking mode')} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItemWithDescription
                                    value={TrackingMode.ENABLED}
                                    title={t('Enabled')}
                                    description={t('Track opens and clicks for all emails')}
                                  />
                                  <SelectItemWithDescription
                                    value={TrackingMode.DISABLED}
                                    title={t('Disabled')}
                                    description={t('No tracking for any emails')}
                                  />
                                  <SelectItemWithDescription
                                    value={TrackingMode.MARKETING_ONLY}
                                    title={t('Marketing only')}
                                    description={t('Track only campaigns and workflow emails, not transactional')}
                                  />
                                </SelectContent>
                              </Select>
                              <FormDescription>
                                {t('Control how email opens and clicks are tracked for this project. Templates and campaigns can override it.')}
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Language Selection */}
                      <FormField
                        control={form.control}
                        name="language"
                        render={({field}) => (
                          <FormItem>
                            <FormLabel>{t('Customer language')}</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value || 'en'}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder={t('Select language')} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {SUPPORTED_LANGUAGES.map(lang => (
                                  <SelectItem key={lang.code} value={lang.code}>
                                    <div className="flex items-center gap-2">
                                      <span>{lang.flag}</span>
                                      <span>{lang.nativeName}</span>
                                      <span className="text-neutral-500 text-xs">({lang.name})</span>
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              {t('Language for customer-facing pages (unsubscribe, preferences) and email footers.')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Success/Error Messages */}
                      <AnimatePresence mode="wait">
                        {successMessage && (
                          <motion.div
                            initial={{opacity: 0, y: -10}}
                            animate={{opacity: 1, y: 0}}
                            exit={{opacity: 0}}
                            className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800"
                          >
                            {successMessage}
                          </motion.div>
                        )}
                        {errorMessage && (
                          <motion.div
                            initial={{opacity: 0, y: -10}}
                            animate={{opacity: 1, y: 0}}
                            exit={{opacity: 0}}
                            className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
                          >
                            {errorMessage}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex justify-end">
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                          {form.formState.isSubmitting ? t('Saving…') : t('Save Changes')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              {/* API Keys - Separate Card */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{t('API keys')}</CardTitle>
                      <CardDescription>{t('Use these keys to integrate with the Plunk API')}</CardDescription>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={promptRegenerateKeys}>
                      {t('Regenerate keys')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ApiKeyDisplay
                    label={t('Public key')}
                    value={activeProject.public}
                    description={t('Use this key for client-side integrations')}
                  />
                  <ApiKeyDisplay
                    label={t('Secret key')}
                    value={activeProject.secret}
                    description={t('Keep this key secure and never expose it publicly')}
                    isSecret
                  />
                </CardContent>
              </Card>

              {/* Danger Zone - Separate Card */}
              <Card className="border-red-200">
                <CardHeader className="border-b border-red-100 bg-red-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-lg shadow-sm border border-red-200">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-red-900">{t('Danger zone')}</CardTitle>
                      <CardDescription className="text-red-700">
                        {t('Irreversible actions that affect your project data')}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-neutral-100">
                    {/* Reset Project */}
                    <div className="flex items-start justify-between gap-4 px-6 py-5">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Database className="h-4 w-4 text-amber-700" />
                          <h4 className="font-semibold text-neutral-900">{t('Reset project data')}</h4>
                        </div>
                        <p className="text-sm text-neutral-600 mb-3">
                          {t('Clear all campaigns, contacts, workflows, templates, and events.')}
                        </p>
                        <div className="flex items-start gap-2 text-xs text-neutral-500">
                          <span className="font-medium">{t('Preserved:')}</span>
                          <span>{t('API keys, domains, billing information')}</span>
                        </div>
                      </div>
                      <Button type="button" variant="outline" onClick={() => setDialog({type: 'reset'})} className="shrink-0">
                        {t('Reset data')}
                      </Button>
                    </div>

                    {/* Delete Project */}
                    <div className="flex items-start justify-between gap-4 px-6 py-5 bg-red-50/40">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <h4 className="font-semibold text-red-900">{t('Delete project')}</h4>
                        </div>
                        <p className="text-sm text-red-800 mb-3">
                          {t('Permanently delete this project and all associated data. This action')}{' '}
                          <strong>{t('cannot be undone')}</strong>.
                          {activeProject?.subscription && t(' Your subscription will be canceled.')}
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="px-2 py-1 bg-red-100 text-red-700 rounded font-medium">
                            {t('Permanent deletion')}
                          </span>
                          <span className="text-red-600">{t('All data will be lost')}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setDialog({type: 'delete'})}
                        className="shrink-0"
                      >
                        {t('Delete project')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              </div>
            </TabsContent>

            {/* Billing Tab */}
            <TabsContent value="billing">
              <div className="space-y-6">
                {/* Unpaid Invoice Banner */}
                <UnpaidInvoiceBanner projectId={activeProject.id} hasSubscription={!!activeProject.subscription} />

                <Card>
                  <CardHeader>
                    <CardTitle>{t('Billing')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* Success/Error Messages */}
                      <AnimatePresence mode="wait">
                        {successMessage && (
                          <motion.div
                            initial={{opacity: 0, y: -10}}
                            animate={{opacity: 1, y: 0}}
                            exit={{opacity: 0}}
                            className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800"
                          >
                            {successMessage}
                          </motion.div>
                        )}
                        {errorMessage && (
                          <motion.div
                            initial={{opacity: 0, y: -10}}
                            animate={{opacity: 1, y: 0}}
                            exit={{opacity: 0}}
                            className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
                          >
                            {errorMessage}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {activeProject.subscription ? (
                        // Has subscription - show billing portal button
                        <div className="space-y-4">
                          {billingPause ? (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                              <div className="flex items-center gap-2 text-amber-900 mb-2">
                                <CreditCard className="h-5 w-5" />
                                <span className="font-medium">{t('Sending paused: update your card')}</span>
                              </div>
                              <p className="text-sm text-amber-800">{billingPause}</p>
                            </div>
                          ) : (
                            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                              <div className="flex items-center gap-2 text-green-800 mb-2">
                                <CreditCard className="h-5 w-5" />
                                <span className="font-medium">{t('Active subscription')}</span>
                              </div>
                              <p className="text-sm text-green-700">
                                {t('Your subscription is active. Manage your billing details, update payment methods, or cancel your subscription through the billing portal.')}
                              </p>
                            </div>
                          )}

                          <div className="flex justify-start">
                            <Button onClick={handleManageBilling} disabled={isLoadingBilling}>
                              {isLoadingBilling ? t('Loading…') : billingPause ? t('Update card') : t('Manage Billing')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        // No subscription - show start subscription button
                        <div className="space-y-4">
                          <div className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
                            <div className="flex items-center gap-2 text-neutral-800 mb-2">
                              <CreditCard className="h-5 w-5" />
                              <span className="font-medium">{t('No active subscription')}</span>
                            </div>
                            <p className="text-sm text-neutral-600">
                              {t('Activation places one charge of 2.00 on your card, credited back in full to your usage.')}
                            </p>
                            <details className="group mt-2">
                              <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-700 transition-colors list-none">
                                {t('Why the charge?')}
                              </summary>
                              <p className="mt-2 text-xs text-neutral-500">
                                {t('It runs right after checkout to confirm your card accepts automatic monthly billing. Prepaid, virtual, and single-use cards often accept a payment you approve yourself but refuse recurring charges later, so we check now rather than a month in.')}
                              </p>
                            </details>
                          </div>

                          <div className="flex flex-col gap-2">
                            <div className="flex justify-start">
                              <Button
                                onClick={() => handleStartSubscription(selectedCurrency)}
                                disabled={isLoadingBilling}
                              >
                                {isLoadingBilling ? t('Loading…') : t('Start Subscription')}
                              </Button>
                            </div>

                            <div className="flex flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => setShowCurrencySelector(!showCurrencySelector)}
                                className="text-xs text-neutral-500 hover:text-neutral-700 transition-colors w-fit"
                              >
                                {showCurrencySelector ? t('Hide currency options') : t('Select a different currency')}
                              </button>

                              <AnimatePresence>
                                {showCurrencySelector && (
                                  <motion.div
                                    initial={{opacity: 0, height: 0}}
                                    animate={{opacity: 1, height: 'auto'}}
                                    exit={{opacity: 0, height: 0}}
                                    transition={{duration: 0.2}}
                                    className="overflow-hidden"
                                  >
                                    <div className="flex items-center gap-3 pt-1">
                                      <label className="text-sm font-medium text-neutral-600">{t('Currency:')}</label>
                                      <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
                                        <SelectTrigger className="w-[200px]">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="auto">{t('Auto-detect')}</SelectItem>
                                          <SelectItem value="usd">{t('USD ($) - US Dollar')}</SelectItem>
                                          <SelectItem value="eur">{t('EUR (€) - Euro')}</SelectItem>
                                          <SelectItem value="gbp">{t('GBP (£) - British Pound')}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Billing Limits */}
                <BillingLimits
                  projectId={activeProject.id}
                  tier={activeProject.subscription ? 'paid' : 'free'}
                  billingEnabled={billingEnabled}
                />

                {/* Current Month Consumption */}
                <BillingConsumption projectId={activeProject.id} hasSubscription={!!activeProject.subscription} />

                {/* Past Invoices */}
                <BillingInvoices
                  projectId={activeProject.id}
                  hasSubscription={!!activeProject.subscription}
                  onManageBilling={handleManageBilling}
                />
              </div>
            </TabsContent>

            {/* Team Tab */}
            <TabsContent value="team">
              <TeamSettings
                projectId={activeProject.id}
                currentUserRole={currentUserRole}
                currentUserId={user?.id || ''}
              />
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security">
              {securityMetrics ? (
                <SecuritySettings metrics={securityMetrics} isLoading={isLoadingSecurityMetrics} />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('Security overview')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-neutral-500">
                      {isLoadingSecurityMetrics ? t('Loading…') : t('Unable to load security metrics')}
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Domains Tab */}
            <TabsContent value="domains">
              <DomainsSettings projectId={activeProject.id} />
            </TabsContent>

            {/* SMTP Tab */}
            <TabsContent value="smtp">
              <SmtpSettings smtpConfig={smtpConfig} />
            </TabsContent>

            {/* WhatsApp Tab */}
            <TabsContent value="whatsapp">
              <WhatsAppSettings canManage={currentUserRole === 'OWNER' || currentUserRole === 'ADMIN'} />
            </TabsContent>

            {/* Data Management Tab */}
            <TabsContent value="data">
              <DataManagementSettings />
            </TabsContent>
          </Tabs>
        </div>

        <ConfirmDialog
          open={dialog.type === 'regenerate'}
          onOpenChange={open => !open && setDialog({type: 'none'})}
          onConfirm={handleRegenerateKeys}
          title={t('Regenerate API keys?')}
          description={t('Your current keys stop working immediately. Every integration using them fails until you swap in the new ones.')}
          icon={KeyRound}
          confirmText={t('Regenerate keys')}
          loadingText={t('Regenerating…')}
          variant="destructive"
        />

        <ConfirmDialog
          open={dialog.type === 'reset'}
          onOpenChange={open => !open && setDialog({type: 'none'})}
          onConfirm={handleResetProject}
          title={t('Reset project data?')}
          description={t('Every campaign, contact, workflow, template and event in this project is deleted. Your API keys, domains and billing stay as they are.')}
          icon={RotateCcw}
          confirmPhrase="RESET"
          confirmText={t('Reset data')}
          loadingText={t('Resetting…')}
          variant="destructive"
        />

        <ConfirmDialog
          open={dialog.type === 'delete'}
          onOpenChange={open => !open && setDialog({type: 'none'})}
          onConfirm={handleDeleteProject}
          title={t('Delete {name}?', {name: activeProject.name})}
          description={
            activeProject.subscription
              ? t('This permanently deletes the project and everything in it, and cancels its subscription. It cannot be undone.')
              : t('This permanently deletes the project and everything in it. It cannot be undone.')
          }
          confirmPhrase="DELETE"
          confirmText={t('Delete project')}
          loadingText={t('Deleting…')}
          variant="destructive"
        />

      </DashboardLayout>
    </>
  );
}
