import {WHATSAPP_DEFAULT_PHONE_FIELD, WHATSAPP_MAX_MESSAGE_LENGTH, WorkflowStepConfigSchemas} from '@plunk/shared';
import {Input, Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue, Textarea} from '@plunk/ui';
import Link from 'next/link';
import {useState} from 'react';
import {toast} from 'sonner';

import {useTranslation} from '../../lib/i18n';

import {type EditStepDialogProps, getStepConfig, StepDialogShell, useStepUpdate} from './shared';

export function SendWhatsAppStepDialog({step, workflowId, open, onOpenChange, onSuccess}: EditStepDialogProps) {
  const {t} = useTranslation();
  const config = getStepConfig(step);
  const recipient = config.recipient as {type?: string; phoneField?: string; customPhone?: string} | undefined;

  const [name, setName] = useState(step.name);
  const [message, setMessage] = useState(typeof config.message === 'string' ? config.message : '');
  const [recipientType, setRecipientType] = useState<'CONTACT' | 'CUSTOM'>(
    recipient?.type === 'CUSTOM' ? 'CUSTOM' : 'CONTACT',
  );
  const [phoneField, setPhoneField] = useState(recipient?.phoneField ?? WHATSAPP_DEFAULT_PHONE_FIELD);
  const [customPhone, setCustomPhone] = useState(recipient?.customPhone ?? '');

  const {update, isSubmitting} = useStepUpdate(workflowId, step.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextConfig = {
      message: message.trim(),
      recipient: {
        type: recipientType,
        ...(recipientType === 'CONTACT' && {phoneField: phoneField.trim() || WHATSAPP_DEFAULT_PHONE_FIELD}),
        ...(recipientType === 'CUSTOM' && {customPhone: customPhone.trim()}),
      },
    };

    const parsed = WorkflowStepConfigSchemas.sendWhatsApp.safeParse(nextConfig);
    if (!parsed.success) {
      toast.error(
        !nextConfig.message ? t('Please write the message') : t('Please enter the phone number to send to'),
      );
      return;
    }

    const ok = await update({name, config: parsed.data});
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
            <Label htmlFor="editWhatsAppMessage">{t('Message')}</Label>
            <span className="text-xs text-neutral-400">
              {message.length}/{WHATSAPP_MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <Textarea
            id="editWhatsAppMessage"
            className="mt-1.5 font-mono text-sm"
            rows={6}
            maxLength={WHATSAPP_MAX_MESSAGE_LENGTH}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={t('Hi {{firstName}}, your order {{event.orderId}} has shipped!')}
          />
          <p className="text-xs text-neutral-500 mt-1.5">
            {t('Use the same variables as email templates, e.g.')}{' '}
            <code className="font-mono">{'{{firstName}}'}</code>, <code className="font-mono">{'{{event.orderId}}'}</code>.{' '}
            {t('WhatsApp formatting works too: *bold*, _italic_.')}
          </p>
        </div>

        <div>
          <Label htmlFor="editWhatsAppRecipientType">{t('Send to')}</Label>
          <Select value={recipientType} onValueChange={value => setRecipientType(value as 'CONTACT' | 'CUSTOM')}>
            <SelectTrigger id="editWhatsAppRecipientType" className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItemWithDescription
                value="CONTACT"
                title={t('Contact')}
                description={t("Send to the phone number saved on the contact's data")}
              />
              <SelectItemWithDescription
                value="CUSTOM"
                title={t('Custom number')}
                description={t('Send to a fixed number, e.g. your support team')}
              />
            </SelectContent>
          </Select>
        </div>

        {recipientType === 'CONTACT' ? (
          <div>
            <Label htmlFor="editWhatsAppPhoneField">{t('Contact field with the phone number')}</Label>
            <Input
              id="editWhatsAppPhoneField"
              className="mt-1.5 font-mono"
              value={phoneField}
              onChange={e => setPhoneField(e.target.value)}
              placeholder={WHATSAPP_DEFAULT_PHONE_FIELD}
            />
            <p className="text-xs text-neutral-500 mt-1.5">
              {t('Contacts without a valid number in this field are skipped and the workflow continues.')}
            </p>
          </div>
        ) : (
          <div>
            <Label htmlFor="editWhatsAppCustomPhone">{t('Phone number')}</Label>
            <Input
              id="editWhatsAppCustomPhone"
              className="mt-1.5 font-mono"
              value={customPhone}
              onChange={e => setCustomPhone(e.target.value)}
              placeholder="+55 41 99999-9999"
            />
          </div>
        )}

        <p className="text-xs text-neutral-500">
          {t('Messages are sent from the number connected in')}{' '}
          <Link href="/settings?tab=whatsapp" className="underline underline-offset-2" target="_blank">
            {t('Settings → WhatsApp')}
          </Link>
          .
        </p>
      </div>
    </StepDialogShell>
  );
}
