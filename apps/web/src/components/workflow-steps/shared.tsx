import {Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label} from '@plunk/ui';
import type {WorkflowStep} from '@plunk/db';
import {WorkflowSchemas} from '@plunk/shared';
import {useState} from 'react';
import {toast} from 'sonner';

import {network} from '../../lib/network';
import {t} from '../../lib/i18n';

export const STEP_TYPE_LABELS: Record<WorkflowStep['type'], string> = {
  TRIGGER:        t('Trigger'),
  SEND_EMAIL:     t('Send Email'),
  SEND_WHATSAPP:  t('Send WhatsApp'),
  DELAY:          t('Delay'),
  WAIT_FOR_EVENT: t('Wait for Event'),
  CONDITION:      t('Condition'),
  EXIT:           t('Exit'),
  WEBHOOK:        t('Webhook'),
  UPDATE_CONTACT: t('Update Contact'),
};

export const STEP_TYPE_DESCRIPTIONS: Record<WorkflowStep['type'], string> = {
  TRIGGER:        t('Starts the workflow when a specific event is received.'),
  SEND_EMAIL:     t('Sends an email to the contact using a template you choose.'),
  SEND_WHATSAPP:  t('Sends a transactional WhatsApp message to the contact\'s phone number.'),
  DELAY:          t('Pauses the workflow for a duration or until a specified date.'),
  WAIT_FOR_EVENT: t('Waits until the contact triggers a specific event, then continues.'),
  CONDITION:      t('Splits the flow based on contact data — each path leads to different steps.'),
  EXIT:           t('Ends the workflow for the contact.'),
  WEBHOOK:        t('Makes an HTTP request to an external URL with the contact\'s data.'),
  UPDATE_CONTACT: t('Sets or updates fields on the contact\'s profile.'),
};

export type StepWithTemplate = WorkflowStep & {
  template?: {id: string; name: string} | null;
};

export interface EditStepDialogProps {
  step: StepWithTemplate;
  workflowId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export interface UpdateStepInput {
  name: string;
  config: Record<string, unknown>;
  templateId?: string;
}

export function useStepUpdate(workflowId: string, stepId: string) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = async (input: UpdateStepInput): Promise<boolean> => {
    setIsSubmitting(true);
    try {
      await network.fetch<WorkflowStep, typeof WorkflowSchemas.updateStep>(
        'PATCH',
        `/workflows/${workflowId}/steps/${stepId}`,
        input as Parameters<typeof network.fetch>[2],
      );
      toast.success(t('Step updated'));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t save the step. Try again.'));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {update, isSubmitting};
}

export function getStepConfig(step: {config: unknown}): Record<string, unknown> {
  return step.config && typeof step.config === 'object' && !Array.isArray(step.config)
    ? (step.config as Record<string, unknown>)
    : {};
}

interface StepDialogShellProps {
  step: StepWithTemplate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSubmitting: boolean;
  children: React.ReactNode;
}

export function StepDialogShell({
  step,
  open,
  onOpenChange,
  name,
  onNameChange,
  onSubmit,
  isSubmitting,
  children,
}: StepDialogShellProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Edit')}{' '}{STEP_TYPE_LABELS[step.type] ?? step.type}</DialogTitle>
          {STEP_TYPE_DESCRIPTIONS[step.type] && (
            <p className="text-sm text-neutral-500 mt-1">{STEP_TYPE_DESCRIPTIONS[step.type]}</p>
          )}
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <Label htmlFor="editStepName">{t('Step name')}</Label>
            <Input
              id="editStepName"
              type="text"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              required
              placeholder={t('e.g., Send Welcome Email')}
              className="mt-1.5"
            />
          </div>

          {children}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('Saving…') : t('Save Changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
