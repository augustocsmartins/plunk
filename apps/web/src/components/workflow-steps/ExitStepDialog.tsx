import {Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue} from '@plunk/ui';
import {useState} from 'react';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';
import {t} from '../../lib/i18n';

export function ExitStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const config = getStepConfig(step);

  const [name, setName] = useState(step.name);
  const [exitReason, setExitReason] = useState(String(config.reason ?? 'completed'));

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const ok = await update({
      name,
      config: {reason: exitReason},
    });

    if (ok) {
      onOpenChange(false);
      onSuccess();
    }
  };

  return (
    <StepDialogShell
      step={step}
      open={open}
      onOpenChange={onOpenChange}
      name={name}
      onNameChange={setName}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    >
      <div>
        <Label htmlFor="editExitReason">{t('Exit reason (optional)')}</Label>
        <Select value={exitReason} onValueChange={setExitReason}>
          <SelectTrigger id="editExitReason" className="mt-1.5">
            <SelectValue placeholder={t('Select exit reason…')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItemWithDescription value="completed" title={t('Completed')} description={t('Contact reached the end of the workflow')} />
            <SelectItemWithDescription value="unsubscribed" title={t('Unsubscribed')} description={t('Contact unsubscribed from communications')} />
            <SelectItemWithDescription value="not_eligible" title={t('Not eligible')} description={t('Contact doesn\'t meet the required criteria')} />
            <SelectItemWithDescription value="opted_out" title={t('Opted out')} description={t('Contact opted out of this workflow')} />
            <SelectItemWithDescription value="goal_achieved" title={t('Goal achieved')} description={t('Workflow goal was met before completion')} />
            <SelectItemWithDescription value="duplicate" title={t('Duplicate')} description={t('Contact was already in this workflow')} />
            <SelectItemWithDescription value="error" title={t('Error')} description={t('A technical issue occurred')} />
            <SelectItemWithDescription value="other" title={t('Other')} description={t('Custom or unlisted reason')} />
          </SelectContent>
        </Select>
      </div>
    </StepDialogShell>
  );
}
