import {WorkflowStepConfigSchemas, WORKFLOW_DELAY_UNIT_MS, WORKFLOW_MAX_DELAY_MS} from '@plunk/shared';
import {Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@plunk/ui';
import {useState} from 'react';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';
import {t} from '../../lib/i18n';

type DelayUnit = keyof typeof WORKFLOW_DELAY_UNIT_MS;
type DelayMode = 'duration' | 'until';

function isDelayUnit(value: unknown): value is DelayUnit {
  return value === 'minutes' || value === 'hours' || value === 'days';
}

export function DelayStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const config = getStepConfig(step);

  const [name, setName] = useState(step.name);
  const [mode, setMode] = useState<DelayMode>(config.mode === 'until' ? 'until' : 'duration');
  const [until, setUntil] = useState(typeof config.until === 'string' ? config.until : '');
  const [untilError, setUntilError] = useState<string>();
  const [delayAmount, setDelayAmount] = useState(String(config.amount ?? '24'));
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(isDelayUnit(config.unit) ? config.unit : 'hours');
  const maxAmount = WORKFLOW_MAX_DELAY_MS / WORKFLOW_DELAY_UNIT_MS[delayUnit];

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'until') {
      const result = WorkflowStepConfigSchemas.delay.safeParse({mode, until});
      if (!result.success) {
        setUntilError(t(result.error.issues[0]?.message ?? 'Enter an ISO 8601 date with a timezone'));
        return;
      }
    }

    const ok = await update({
      name,
      config: mode === 'until' ? {mode, until: until.trim()} : {amount: parseInt(delayAmount, 10), unit: delayUnit},
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
        <Label htmlFor="editDelayMode">{t('Wait mode')}</Label>
        <Select value={mode} onValueChange={value => setMode(value as DelayMode)}>
          <SelectTrigger id="editDelayMode" className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="duration">{t('For a duration')}</SelectItem>
            <SelectItem value="until">{t('Until the date in')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === 'until' ? (
        <div>
          <Label htmlFor="editDelayUntil">{t('Date or variable')}</Label>
          <Input
            id="editDelayUntil"
            value={until}
            onChange={e => {
              setUntil(e.target.value);
              setUntilError(undefined);
            }}
            required
            aria-invalid={!!untilError}
            aria-describedby={untilError ? 'editDelayUntilHint editDelayUntilError' : 'editDelayUntilHint'}
            className="mt-1.5"
          />
          <p id="editDelayUntilHint" className="mt-1.5 break-words text-sm text-neutral-600">
            {t('Use a variable such as {variable} or an ISO 8601 date with a timezone.', {
              variable: '{{event.whatsapp.enviar_em}}',
            })}
          </p>
          {untilError && (
            <p id="editDelayUntilError" role="alert" className="mt-1.5 text-sm text-red-700">
              {untilError}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="editDelayAmount">{t('Amount')}</Label>
            <Input
              id="editDelayAmount"
              type="number"
              value={delayAmount}
              onChange={e => setDelayAmount(e.target.value)}
              required
              min="1"
              max={maxAmount}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="editDelayUnit">{t('Unit')}</Label>
            <Select value={delayUnit} onValueChange={value => setDelayUnit(value as DelayUnit)}>
              <SelectTrigger id="editDelayUnit" className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">{t('Minutes')}</SelectItem>
                <SelectItem value="hours">{t('Hours')}</SelectItem>
                <SelectItem value="days">{t('Days')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </StepDialogShell>
  );
}
