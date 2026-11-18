import {Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue, Input} from '@plunk/ui';
import {ExternalLink} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';

import {TemplateSearchPicker} from '../TemplateSearchPicker';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';
import {t} from '../../lib/i18n';

export function SendEmailStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const config = getStepConfig(step);
  const recipient = config.recipient as {type?: string; customEmail?: string} | undefined;

  const [name, setName] = useState(step.name);
  const [templateId, setTemplateId] = useState(step.template?.id ?? '');
  const [recipientType, setRecipientType] = useState<'CONTACT' | 'CUSTOM'>(
    recipient?.type === 'CUSTOM' ? 'CUSTOM' : 'CONTACT',
  );
  const [customEmail, setCustomEmail] = useState(recipient?.customEmail ?? '');

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!templateId) {
      toast.error(t('Please select a template'));
      return;
    }

    if (recipientType === 'CUSTOM') {
      if (!customEmail.trim()) {
        toast.error(t('Please enter a custom email address'));
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customEmail)) {
        toast.error(t('Please enter a valid email address'));
        return;
      }
    }

    const ok = await update({
      name,
      templateId,
      config: {
        templateId,
        recipient: {
          type: recipientType,
          ...(recipientType === 'CUSTOM' && {customEmail: customEmail.trim()}),
        },
      },
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
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="editTemplate">{t('Email template')}</Label>
            {templateId && (
              <a
                href={`/templates/${templateId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-blue-600 transition-colors"
              >
                {t('Edit template')}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <TemplateSearchPicker value={templateId} initialName={step.template?.name} onChange={setTemplateId} />
        </div>

        <div>
          <Label htmlFor="editRecipientType">{t('Send to')}</Label>
          <Select value={recipientType} onValueChange={value => setRecipientType(value as 'CONTACT' | 'CUSTOM')}>
            <SelectTrigger id="editRecipientType" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItemWithDescription
                value="CONTACT"
                title={t('Contact')}
                description={t('Send to the contact that triggered the workflow')}
              />
              <SelectItemWithDescription
                value="CUSTOM"
                title={t('Custom email')}
                description={t('Send to a specific email address')}
              />
            </SelectContent>
          </Select>
        </div>

        {recipientType === 'CUSTOM' && (
          <div>
            <Label htmlFor="editCustomEmail">{t('Email address')}</Label>
            <Input
              id="editCustomEmail"
              type="email"
              value={customEmail}
              onChange={e => setCustomEmail(e.target.value)}
              required
              placeholder={t('e.g., admin@example.com')}
              className="mt-1.5"
            />
          </div>
        )}
      </div>
    </StepDialogShell>
  );
}
