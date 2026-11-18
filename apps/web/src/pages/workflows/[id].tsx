/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  IconSpinner,
} from '@plunk/ui';
import type {Workflow, WorkflowExecution, WorkflowStep, WorkflowTransition} from '@plunk/db';
import {DashboardLayout} from '../../components/DashboardLayout';
import {
  entryRuleError,
  entryRuleOf,
  entryRulePayload,
  type EntryRulePayload,
  WorkflowEntryRules,
} from '../../components/WorkflowEntryRules';
import {network} from '../../lib/network';
import {
  AlertTriangle,
  ArrowLeft,
  CircleStop,
  Info,
  Power,
  PowerOff,
  Settings,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import {NextSeo} from 'next-seo';
import {WorkflowBuilder} from '../../components/WorkflowBuilder';
import {EditStepDialog} from '../../components/workflow-steps';
import {ReactFlowProvider} from '@xyflow/react';
import {WorkflowSchemas} from '@plunk/shared';
import dayjs from 'dayjs';
import {t as tx} from '../../lib/i18n';

interface WorkflowWithDetails extends Workflow {
  steps: (WorkflowStep & {
    template?: {id: string; name: string} | null;
    outgoingTransitions: WorkflowTransition[];
    incomingTransitions: WorkflowTransition[];
  })[];
}

interface PaginatedExecutions {
  executions: (WorkflowExecution & {
    contact: {id: string; email: string};
    currentStep?: {id: string; name: string; type: string} | null;
  })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function WorkflowEditorPage() {
  const router = useRouter();
  const {id} = router.query;
  const [activeTab, setActiveTab] = useState<'builder' | 'executions'>('builder');

  type WorkflowDialog =
    | {type: 'none'}
    | {type: 'settings'}
    | {type: 'cancelAll'; cancelling: boolean}
    | {type: 'cancelOne'; executionId: string; cancelling: boolean}
    | {type: 'editStep'; step: WorkflowStep}
    | {type: 'delete'};

  const [dialog, setDialog] = useState<WorkflowDialog>({type: 'none'});

  const {data: workflow, mutate} = useSWR<WorkflowWithDetails>(id ? `/workflows/${id}` : null, {
    revalidateOnFocus: false,
  });

  const {data: executionsData} = useSWR<PaginatedExecutions>(
    id && activeTab === 'executions' ? `/workflows/${id}/executions?page=1&pageSize=10` : null,
    {revalidateOnFocus: false},
  );

  // Always fetch a summary of active executions to show warnings (regardless of enabled status)
  const {data: activeExecutionsData} = useSWR<PaginatedExecutions>(
    id ? `/workflows/${id}/executions?page=1&pageSize=1&status=RUNNING` : null,
    {revalidateOnFocus: false, refreshInterval: 10000},
  );

  const {data: waitingExecutionsData} = useSWR<PaginatedExecutions>(
    id ? `/workflows/${id}/executions?page=1&pageSize=1&status=WAITING` : null,
    {revalidateOnFocus: false, refreshInterval: 10000},
  );

  // Check for active executions
  const activeExecutionsCount = (activeExecutionsData?.total || 0) + (waitingExecutionsData?.total || 0);

  // Handler for cancelling a single execution
  const handleCancelExecution = async (executionId: string) => {
    setDialog({type: 'cancelOne', executionId, cancelling: true});
    try {
      await network.fetch('DELETE', `/workflows/${id}/executions/${executionId}`);
      toast.success(tx('Execution canceled'));
      setDialog({type: 'none'});
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx('Couldn’t cancel the execution. Try again.'));
      setDialog({type: 'cancelOne', executionId, cancelling: false});
    }
  };

  // Handler for cancelling all executions
  const handleCancelAllExecutions = async () => {
    setDialog(d => (d.type === 'cancelAll' ? {...d, cancelling: true} : d));
    try {
      const result = await network.fetch<{cancelled: number}>('POST', `/workflows/${id}/executions/cancel-all`);
      toast.success(tx('Canceled {cancelled} execution{value}', {cancelled: result.cancelled, value: result.cancelled === 1 ? '' : 's'}));
      setDialog({type: 'none'});
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx('Couldn’t cancel those executions. Try again.'));
      setDialog(d => (d.type === 'cancelAll' ? {...d, cancelling: false} : d));
    }
  };

  // Validate workflow configuration
  const validateWorkflow = (workflow: WorkflowWithDetails): {valid: boolean; errors: string[]} => {
    const errors: string[] = [];

    // Check if there are any steps
    if (workflow.steps.length === 0) {
      errors.push(tx('Workflow must have at least one step'));
      return {valid: false, errors};
    }

    // Validate each step
    workflow.steps.forEach(step => {
      const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config : {};

      switch (step.type) {
        case 'SEND_EMAIL':
          if (!step.templateId) {
            errors.push(tx('"{name}" step is missing an email template', {name: step.name}));
          }
          break;

        case 'DELAY':
          if (config.mode === 'until') {
            if (typeof config.until !== 'string' || !config.until.trim()) {
              errors.push(tx('"{name}" step is missing the date to wait until', {name: step.name}));
            }
          } else if (!config.amount || !config.unit) {
            errors.push(tx('"{name}" step is missing delay configuration (amount or unit)', {name: step.name}));
          }
          break;

        case 'CONDITION':
          if (config.mode === 'multi') {
            // Multi-branch validation
            if (!config.field) {
              errors.push(tx('"{name}" step is missing condition field', {name: step.name}));
            }
            if (!Array.isArray(config.branches) || config.branches.length === 0) {
              errors.push(tx('"{name}" step needs at least one branch', {name: step.name}));
            }
          } else {
            // Extract field name from both legacy format (object) and new format (string)
            let fieldValue = '';
            if (config.field) {
              if (typeof config.field === 'object' && config.field !== null && 'field' in config.field) {
                fieldValue = String(config.field.field || '');
              } else {
                fieldValue = String(config.field);
              }
            }

            if (!fieldValue || !config.operator) {
              errors.push(tx('"{name}" step is missing condition configuration (field or operator)', {name: step.name}));
            }
            // Check if value is required for this operator
            const operatorNeedsValue = !['exists', 'notExists'].includes(String(config.operator || ''));
            if (operatorNeedsValue && (config.value === undefined || config.value === null || config.value === '')) {
              errors.push(tx('"{name}" step is missing a value for the condition', {name: step.name}));
            }
          }
          break;

        case 'WAIT_FOR_EVENT':
          if (!config.eventName) {
            errors.push(tx('"{name}" step is missing event name', {name: step.name}));
          }
          break;

        case 'SEND_WHATSAPP': {
          const message = typeof config.message === 'string' ? config.message.trim() : '';
          if (!message) {
            errors.push(tx('"{name}" step is missing a message', {name: step.name}));
          }
          const recipient =
            config.recipient && typeof config.recipient === 'object' ? (config.recipient as Record<string, unknown>) : {};
          if (recipient.type === 'CUSTOM' && !recipient.customPhone) {
            errors.push(tx('"{name}" step is missing a phone number', {name: step.name}));
          }
          break;
        }

        case 'WEBHOOK':
          if (!config.url) {
            errors.push(tx('"{name}" step is missing webhook URL', {name: step.name}));
          }
          break;

        case 'UPDATE_CONTACT': {
          const hasUpdates =
            config.updates && typeof config.updates === 'object' && Object.keys(config.updates).length > 0;
          const hasSubscriptionAction =
            typeof config.subscriptionAction === 'string' &&
            config.subscriptionAction !== 'none' &&
            config.subscriptionAction !== '';
          if (!hasUpdates && !hasSubscriptionAction) {
            errors.push(tx('"{name}" step is missing contact updates or a subscription action', {name: step.name}));
          }
          break;
        }
      }
    });

    // Check for orphaned steps (steps with no incoming or outgoing transitions, except TRIGGER and EXIT)
    const triggerSteps = workflow.steps.filter(s => s.type === 'TRIGGER');

    workflow.steps.forEach(step => {
      if (step.type !== 'TRIGGER' && step.type !== 'EXIT') {
        const hasIncoming = step.incomingTransitions && step.incomingTransitions.length > 0;
        const hasOutgoing = step.outgoingTransitions && step.outgoingTransitions.length > 0;

        if (!hasIncoming && !hasOutgoing) {
          errors.push(tx('"{name}" step is not connected to the workflow', {name: step.name}));
        }
      }
    });

    // Check if there's a TRIGGER step
    if (triggerSteps.length === 0) {
      errors.push(tx('Workflow must have a trigger step'));
    }

    // Check for CONDITION steps that don't have all required branches connected
    workflow.steps.forEach(step => {
      if (step.type === 'CONDITION' && step.outgoingTransitions) {
        const config = step.config && typeof step.config === 'object' && !Array.isArray(step.config) ? step.config : {};

        // Determine expected branches based on mode
        let expectedBranches: string[];
        if ((config as any).mode === 'multi' && Array.isArray((config as any).branches)) {
          expectedBranches = [...(config as any).branches.map((b: any) => b.id), 'default'];
        } else {
          expectedBranches = ['yes', 'no'];
        }

        const missingBranches = expectedBranches.filter(branchId => {
          return !step.outgoingTransitions.some(t => {
            const condition = t.condition;
            return condition && typeof condition === 'object' && 'branch' in condition && condition.branch === branchId;
          });
        });

        if (missingBranches.length > 0) {
          if ((config as any).mode === 'multi') {
            const branchNames = missingBranches.map(id => {
              if (id === 'default') return tx('Default');
              const branch = (config as any).branches?.find((b: any) => b.id === id);
              return branch?.name || id;
            });
            errors.push(tx('"{name}" condition step is missing connections for: {value}', {name: step.name, value: branchNames.join(', ')}));
          } else {
            errors.push(tx('"{name}" condition step must have both YES and NO branches connected', {name: step.name}));
          }
        }
      }
    });

    return {valid: errors.length === 0, errors};
  };

  const handleToggleEnabled = async () => {
    if (!workflow) return;

    // If trying to enable, validate first
    if (!workflow.enabled) {
      const validation = validateWorkflow(workflow);
      if (!validation.valid) {
        toast.error(
          <div>
            <div className="font-semibold mb-1">{tx('Cannot enable workflow')}</div>
            <ul className="list-disc list-inside text-sm">
              {validation.errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>,
          {duration: 8000},
        );
        return;
      }
    }

    try {
      await network.fetch<Workflow, typeof WorkflowSchemas.update>('PATCH', `/workflows/${id}`, {
        enabled: !workflow.enabled,
      });
      toast.success(tx('Workflow {value}', {value: !workflow.enabled ? 'enabled' : 'disabled'}));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx('Couldn’t change the workflow. Try again.'));
    }
  };

  const handleUpdateSettings = async (data: {
    name: string;
    description?: string;
    triggerConfig?: {eventName: string};
  } & EntryRulePayload) => {
    try {
      await network.fetch<Workflow, typeof WorkflowSchemas.update>('PATCH', `/workflows/${id}`, data);
      toast.success(tx('Workflow updated'));
      void mutate();
      setDialog({type: 'none'});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx('Couldn’t save the workflow. Try again.'));
    }
  };

  const handleDelete = async () => {
    try {
      await network.fetch('DELETE', `/workflows/${id}`);
      toast.success(tx('Workflow deleted'));
      void router.push('/workflows');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tx('Couldn’t delete the workflow. Try again.'));
    }
  };

  // Listen for edit step events from the WorkflowBuilder
  useEffect(() => {
    const handleEditStepEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{stepId?: string}>;
      const stepId = customEvent.detail?.stepId;
      if (stepId && workflow) {
        const step = workflow.steps.find(s => s.id === stepId);
        if (step) {
          setDialog({type: 'editStep', step});
        }
      }
    };

    const handleOpenSettingsEvent = () => {
      setDialog({type: 'settings'});
    };

    window.addEventListener('workflow-edit-step', handleEditStepEvent);
    window.addEventListener('workflow-open-settings', handleOpenSettingsEvent);
    return () => {
      window.removeEventListener('workflow-edit-step', handleEditStepEvent);
      window.removeEventListener('workflow-open-settings', handleOpenSettingsEvent);
    };
  }, [workflow]);

  if (!workflow) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <IconSpinner />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <NextSeo title={workflow.name} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/workflows"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 truncate">{workflow.name}</h1>
              <span
                className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                  workflow.enabled ? 'bg-green-100 text-green-800' : 'bg-neutral-100 text-neutral-800'
                }`}
              >
                {workflow.enabled ? (
                  <>
                    <Power className="h-3 w-3 sm:mr-1" />
                    <span className="hidden sm:inline">{tx('Active')}</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="h-3 w-3 sm:mr-1" />
                    <span className="hidden sm:inline">{tx('Disabled')}</span>
                  </>
                )}
              </span>
            </div>
            {workflow.description && (
              <p className="text-neutral-500 mt-1 text-sm sm:text-base">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button variant="ghost" size="icon" onClick={() => setDialog({type: 'settings'})} aria-label={tx('Settings')}>
              <Settings className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDialog({type: 'delete'})}
              aria-label={tx('Delete workflow')}
              className="text-neutral-400 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="h-5 w-px bg-neutral-200 mx-1" />
            <Button variant={workflow.enabled ? 'outline' : 'default'} onClick={handleToggleEnabled}>
              {workflow.enabled ? (
                <>
                  <PowerOff className="h-4 w-4" />
                  {tx('Disable')}
                </>
              ) : (
                <>
                  <Power className="h-4 w-4" />
                  {tx('Enable')}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Active Executions Warning Banner */}
        {activeExecutionsCount > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>
              {workflow.enabled ? tx('Workflow is active with running executions') : tx('Workflow has active executions')}
            </AlertTitle>
            <AlertDescription>
              <p>
                <strong>{activeExecutionsCount}</strong>{' '}
                {activeExecutionsCount !== 1
                  ? tx('contacts are part way through this workflow')
                  : tx('contact is part way through this workflow')}
                {!workflow.enabled && tx(', and disabling it does not stop them')}. {tx("Until they finish, you can't:")}
              </p>
              <ul className="list-disc list-inside space-y-1 mt-2">
                <li>{tx('Delete steps or transitions')}</li>
                <li>{tx('Change step settings, such as templates or conditions')}</li>
                <li>{tx('Change the trigger')}</li>
              </ul>
              <p className="mt-2">
                {tx('Renaming and repositioning steps still works. To change anything else, wait them out or cancel them from the Executions tab.')}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Validation Warning Banner / Ready-to-enable Banner */}
        {!workflow.enabled &&
          (() => {
            const validation = validateWorkflow(workflow);
            if (!validation.valid) {
              return (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{tx('Workflow has validation errors')}</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">{tx('Fix the following issues before enabling this workflow:')}</p>
                    <ul className="list-disc list-inside space-y-1">
                      {validation.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              );
            }
            if (workflow.steps.length > 0) {
              return (
                <Alert>
                  <Power className="h-4 w-4" />
                  <AlertTitle>{tx('Workflow is disabled')}</AlertTitle>
                  <AlertDescription className="flex items-center justify-between gap-4">
                    <span>{tx('Contacts won\'t be processed until this workflow is enabled.')}</span>
                    <Button size="sm" onClick={handleToggleEnabled} className="shrink-0">
                      <Power className="h-3.5 w-3.5" />
                      {tx('Enable')}
                    </Button>
                  </AlertDescription>
                </Alert>
              );
            }
            return null;
          })()}

        {/* Tabs */}
        <div className="border-b border-neutral-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('builder')}
              className={`py-2 px-1 border-b-2 font-medium text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                activeTab === 'builder'
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              {tx('Workflow builder')}
            </button>
            <button
              onClick={() => setActiveTab('executions')}
              className={`py-2 px-1 border-b-2 font-medium text-sm rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                activeTab === 'executions'
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
              }`}
            >
              {tx('Executions')}
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'builder' ? (
          <Card>
            <CardHeader>
              <CardTitle>{tx('Workflow builder')}</CardTitle>
              <CardDescription>
                {tx('Click the')}{' '}<strong>+</strong> {tx('buttons to add and connect steps to your workflow.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ReactFlowProvider>
                <WorkflowBuilder workflowId={id as string} steps={workflow.steps} onUpdate={() => mutate()} />
              </ReactFlowProvider>
            </CardContent>
          </Card>
        ) : activeTab === 'executions' ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{tx('Workflow executions')}</CardTitle>
                  <CardDescription>{tx('View and manage all executions of this workflow')}</CardDescription>
                </div>
                {activeExecutionsCount > 0 && (
                  <Button variant="outline" onClick={() => setDialog({type: 'cancelAll', cancelling: false})}>
                    {tx('Cancel All Active (')}{activeExecutionsCount})
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!executionsData?.executions.length ? (
                <EmptyState
                  icon={Users}
                  title={tx('No executions yet')}
                  description={tx('This workflow hasn\'t been executed yet. Enable it to start processing contacts.')}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-neutral-50 border-b border-neutral-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {tx('Contact')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {tx('Status')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {tx('Current step')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {tx('Started')}
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                          {tx('Actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-neutral-200">
                      {executionsData.executions.map(execution => (
                        <tr key={execution.id} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-neutral-900">
                            {execution.contact.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge
                              variant={
                                execution.status === 'COMPLETED'
                                  ? 'success'
                                  : execution.status === 'FAILED'
                                    ? 'destructive'
                                    : execution.status === 'WAITING'
                                      ? 'warning'
                                      : execution.status === 'RUNNING'
                                        ? 'default'
                                        : 'neutral'
                              }
                            >
                              {execution.status}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                            {execution.currentStep?.name ?? '-'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-neutral-500">
                            <div className="group relative inline-block cursor-help">
                              {dayjs(execution.startedAt).fromNow()}
                              <div className="hidden group-hover:block absolute z-10 w-48 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-1/2 transform -translate-x-1/2 mb-1 whitespace-nowrap">
                                {dayjs(execution.startedAt).format('DD MMMM YYYY, hh:mm')}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            {(execution.status === 'RUNNING' || execution.status === 'WAITING') && (
                              <Button
                                variant="destructiveGhost"
                                size="sm"
                                onClick={() => setDialog({type: 'cancelOne', executionId: execution.id, cancelling: false})}
                                disabled={dialog.type === 'cancelOne' && dialog.cancelling}
                              >
                                {tx('Cancel')}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Dialogs */}
      {workflow && (
        <>
          <SettingsDialog
            workflow={workflow}
            open={dialog.type === 'settings'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onSave={handleUpdateSettings}
          />
          {dialog.type === 'editStep' && (
            <EditStepDialog
              step={dialog.step}
              workflowId={id as string}
              open={true}
              onOpenChange={open => !open && setDialog({type: 'none'})}
              onSuccess={() => mutate()}
            />
          )}

          {/* Cancel Single Execution Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'cancelOne'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={() => {
              if (dialog.type === 'cancelOne') {
                return handleCancelExecution(dialog.executionId);
              }
            }}
            title={tx('Cancel this execution?')}
            icon={CircleStop}
            description={
              dialog.type === 'cancelOne' && executionsData?.executions ? (
                <>
                  {tx('Stops this workflow for')}{' '}
                  <strong>
                    {executionsData.executions.find(e => e.id === dialog.executionId)?.contact.email || tx('this contact')}
                  </strong>
                  {tx('. They won\'t receive any remaining emails or actions from it. This can\'t be undone.')}
                </>
              ) : (
                tx('The contact won\'t receive any remaining emails or actions from this workflow. This can\'t be undone.')
              )
            }
            confirmText={tx('Cancel execution')}
            cancelText={tx('Keep running')}
            variant="destructive"
            status={dialog.type === 'cancelOne' && dialog.cancelling ? 'loading' : 'idle'}
          />

          {/* Cancel All Executions Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'cancelAll'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={handleCancelAllExecutions}
            title={tx('Cancel every active execution?')}
            icon={CircleStop}
            description={
              <>
                {tx('Stops this workflow for all')}{' '}<strong>{activeExecutionsCount}</strong> {tx('contact')}
                {activeExecutionsCount !== 1 ? 's' : ''} {tx('currently in it. They won\'t receive any remaining emails or actions. This can\'t be undone.')}
              </>
            }
            confirmText={tx('Cancel {activeExecutionsCount} execution{value}', {activeExecutionsCount: activeExecutionsCount, value: activeExecutionsCount !== 1 ? 's' : ''})}
            cancelText={tx('Keep running')}
            variant="destructive"
            status={dialog.type === 'cancelAll' && dialog.cancelling ? 'loading' : 'idle'}
          />

          {/* Delete Workflow Confirmation */}
          <ConfirmDialog
            open={dialog.type === 'delete'}
            onOpenChange={open => !open && setDialog({type: 'none'})}
            onConfirm={handleDelete}
            title={tx('Delete {name}?', {name: workflow.name})}
            description={tx('Its steps and execution history are deleted too. This can\'t be undone.')}
            confirmText={tx('Delete workflow')}
            variant="destructive"
          />
        </>
      )}
    </DashboardLayout>
  );
}

// Settings Dialog Component
interface SettingsDialogProps {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    name: string;
    description?: string;
    triggerConfig?: {eventName: string};
  } & EntryRulePayload) => Promise<void>;
}

function SettingsDialog({workflow, open, onOpenChange, onSave}: SettingsDialogProps) {
  const triggerConfig = workflow.triggerConfig as {eventName?: string} | null;
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [entryRule, setEntryRule] = useState(() => entryRuleOf(workflow));
  const [eventName, setEventName] = useState(triggerConfig?.eventName ?? '');
  const [eventPopoverOpen, setEventPopoverOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync state when workflow changes or dialog opens
  useEffect(() => {
    if (open) {
      setName(workflow.name);
      setDescription(workflow.description ?? '');
      setEntryRule(entryRuleOf(workflow));
      const config = workflow.triggerConfig as {eventName?: string} | null;
      setEventName(config?.eventName ?? '');
    }
  }, [open, workflow]);

  // Fetch available event names
  const {data: eventNamesData} = useSWR<{eventNames: string[]}>(open ? '/events/names' : null, {
    revalidateOnFocus: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await onSave({
        name,
        description: description || undefined,
        ...entryRulePayload(entryRule),
        triggerConfig: eventName.trim() ? {eventName: eventName.trim()} : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tx('Workflow settings')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">{tx('Name')}
            <span className="text-red-500"> *</span>
          </Label>
            <Input id="name" type="text" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div>
            <Label htmlFor="description">{tx('Description')}</Label>
            <textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm"
              rows={3}
            />
          </div>

          <div>
            <Label htmlFor="eventName">{tx('Trigger event')}
            <span className="text-red-500"> *</span>
          </Label>
            <div className="relative">
              <Input
                id="eventName"
                type="text"
                value={eventName}
                onChange={e => {
                  setEventName(e.target.value);
                  setEventPopoverOpen(true);
                }}
                onFocus={() => setEventPopoverOpen(true)}
                onBlur={() => {
                  setTimeout(() => setEventPopoverOpen(false), 150);
                }}
                placeholder={tx('e.g., user.signup, email.open')}
                required
                autoComplete="off"
              />
              {eventPopoverOpen && ((eventNamesData?.eventNames?.length ?? 0) > 0 || eventName?.trim()) && (
                <div className="absolute z-50 w-full mt-1 rounded-md border border-neutral-200 bg-white shadow-md">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        {eventNamesData?.eventNames
                          ?.filter(n => !eventName || n.toLowerCase().includes(eventName.toLowerCase()))
                          .map(n => (
                            <CommandItem key={n} value={n} onSelect={() => { setEventName(n); setEventPopoverOpen(false); }}>
                              {n}
                            </CommandItem>
                          ))}
                        {eventName?.trim() && !eventNamesData?.eventNames?.some(n => n === eventName.trim()) && (
                          <CommandItem
                            key="__custom__"
                            value={eventName.trim()}
                            onSelect={() => { setEventName(eventName.trim()); setEventPopoverOpen(false); }}
                          >
                            {tx('Use “')}{eventName.trim()}&rdquo;
                          </CommandItem>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </div>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              {tx('The event that triggers this workflow to start for a contact')}
            </p>
          </div>

          <WorkflowEntryRules value={entryRule} onChange={setEntryRule} eventName={eventName} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {tx('Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || entryRuleError(entryRule) !== null}>
              {isSubmitting ? tx('Saving…') : tx('Save Changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

