import {WhatsAppSchemas} from '@plunk/shared';
import type {WhatsAppConnectionInfo, WhatsAppMessageItem, WhatsAppMessageState} from '@plunk/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Input,
  Label,
  Skeleton,
  Textarea,
} from '@plunk/ui';
import dayjs from 'dayjs';
import {MessageCircle, RefreshCw, Send, Smartphone, Unplug} from 'lucide-react';
import {useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import {API_URI} from '../lib/constants';
import {useTranslation} from '../lib/i18n';
import {network} from '../lib/network';

const STATUS_BADGE: Record<WhatsAppMessageState, 'neutral' | 'secondary' | 'success' | 'destructive'> = {
  QUEUED: 'neutral',
  SENT: 'secondary',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'destructive',
};

const STATUS_LABEL: Record<WhatsAppMessageState, string> = {
  QUEUED: 'Queued',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
};

interface MessagesPage {
  items: WhatsAppMessageItem[];
  nextCursor: string | null;
}

function formatPhone(phone: string): string {
  // 55 41 99786-7919 for Brazilian numbers, +<digits> otherwise
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return br ? `+55 (${br[1]}) ${br[2]}-${br[3]}` : `+${phone}`;
}

export function WhatsAppSettings({canManage}: {canManage: boolean}) {
  const {t} = useTranslation();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testBody, setTestBody] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);

  const {
    data: info,
    error,
    isLoading,
    mutate,
  } = useSWR<WhatsAppConnectionInfo>(canManage ? '/whatsapp' : null, {
    // Poll while waiting for the QR code to be scanned
    refreshInterval: current => (current && current.enabled && current.status !== 'CONNECTED' ? 4000 : 0),
    revalidateOnFocus: true,
  });

  const {
    data: pages,
    size,
    setSize,
    mutate: mutateMessages,
    isValidating: loadingMessages,
  } = useSWRInfinite<MessagesPage>(
    (index, previous: MessagesPage | null) => {
      if (previous && !previous.nextCursor) return null;
      return index === 0 ? '/whatsapp/messages?limit=20' : `/whatsapp/messages?limit=20&cursor=${previous!.nextCursor}`;
    },
    {refreshInterval: 10000},
  );

  const messages = pages?.flatMap(page => page.items) ?? [];
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextCursor);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const next = await network.fetch<WhatsAppConnectionInfo>('POST', '/whatsapp/connect');
      await mutate(next, {revalidate: false});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Could not generate a QR code. Try again.'));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const next = await network.fetch<WhatsAppConnectionInfo>('POST', '/whatsapp/disconnect');
      await mutate(next, {revalidate: true});
      toast.success(t('WhatsApp disconnected'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Could not disconnect. Try again.'));
    } finally {
      setShowDisconnect(false);
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = WhatsAppSchemas.test.safeParse({to: testPhone, body: testBody});
    if (!parsed.success) {
      toast.error(t('Enter a valid phone number and a message'));
      return;
    }

    setIsSendingTest(true);
    try {
      await network.fetch<unknown, typeof WhatsAppSchemas.test>('POST', '/whatsapp/test', parsed.data);
      toast.success(t('Test message queued'));
      setTestBody('');
      await mutateMessages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('Could not send the test message'));
    } finally {
      setIsSendingTest(false);
    }
  };

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            WhatsApp
          </CardTitle>
          <CardDescription>{t('Only project admins can manage the WhatsApp connection.')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
          <Skeleton className="h-48 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (info && !info.enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            WhatsApp
          </CardTitle>
          <CardDescription>{t('WhatsApp is not configured on this instance')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-600">
            {t('Set the {vars} environment variables to connect an Evolution API server.', {
              vars: 'EVOLUTION_BASE_URL / EVOLUTION_ADMIN_TOKEN',
            })}
          </p>
        </CardContent>
      </Card>
    );
  }

  const status = info?.status ?? 'DISCONNECTED';
  const connected = status === 'CONNECTED';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                WhatsApp
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t(
                  'Connect a WhatsApp number to send transactional messages from the API and from workflows. Campaigns are email only.',
                )}
              </CardDescription>
            </div>
            <Badge variant={connected ? 'success' : status === 'ERROR' ? 'destructive' : 'warning'}>
              {connected ? t('Connected') : status === 'ERROR' ? t('Error') : t('Not connected')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || info?.error) && (
            <p className="text-sm text-red-600">
              {t('Could not reach the WhatsApp server:')} {info?.error ?? (error instanceof Error ? error.message : '')}
            </p>
          )}

          {connected ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-green-50 flex items-center justify-center">
                  <Smartphone className="h-5 w-5 text-green-700" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {info?.phone ? formatPhone(info.phone) : t('Number connected')}
                  </p>
                  {info?.connectedAt && (
                    <p className="text-xs text-neutral-500">
                      {t('Connected {when}', {when: dayjs(info.connectedAt).fromNow()})}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowDisconnect(true)}>
                <Unplug className="h-4 w-4" />
                {t('Disconnect')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="h-56 w-56 shrink-0 rounded-lg border border-neutral-200 bg-white flex items-center justify-center overflow-hidden">
                {info?.qrCode ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={info.qrCode} alt={t('WhatsApp pairing QR code')} className="h-full w-full object-contain" />
                ) : (
                  <p className="text-xs text-neutral-500 text-center px-4">{t('Generate a QR code to connect')}</p>
                )}
              </div>
              <div className="space-y-3 text-sm text-neutral-600">
                <ol className="list-decimal pl-4 space-y-1.5">
                  <li>{t('Open WhatsApp on the phone you want to use')}</li>
                  <li>{t('Go to Settings → Linked devices → Link a device')}</li>
                  <li>{t('Scan this QR code. This page updates once the number is connected.')}</li>
                </ol>
                <Button size="sm" variant="outline" onClick={handleConnect} disabled={isConnecting}>
                  <RefreshCw className={`h-4 w-4 ${isConnecting ? 'animate-spin' : ''}`} />
                  {info?.qrCode ? t('New QR code') : t('Generate QR code')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Send a test message')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSendTest} className="space-y-4">
              <div>
                <Label htmlFor="whatsappTestPhone">{t('Phone number')}</Label>
                <Input
                  id="whatsappTestPhone"
                  className="mt-1.5 font-mono"
                  value={testPhone}
                  onChange={e => setTestPhone(e.target.value)}
                  placeholder="(41) 99999-9999"
                />
              </div>
              <div>
                <Label htmlFor="whatsappTestBody">{t('Message')}</Label>
                <Textarea
                  id="whatsappTestBody"
                  className="mt-1.5"
                  rows={3}
                  value={testBody}
                  onChange={e => setTestBody(e.target.value)}
                  placeholder={t('Hi! This is a test message.')}
                />
              </div>
              <Button type="submit" size="sm" disabled={isSendingTest}>
                <Send className="h-4 w-4" />
                {isSendingTest ? t('Sending…') : t('Send test')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Send from the API')}</CardTitle>
          <CardDescription>{t('Use your secret API key. Numbers without +country code are treated as Brazilian.')}</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-neutral-50 p-3 rounded-lg border border-neutral-200 overflow-x-auto">
            {`curl -X POST ${API_URI}/v1/whatsapp/send \\
  -H "Authorization: Bearer sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"to": "+5541999999999", "body": "${t('Your order has shipped!')}"}'`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('Recent messages')}</CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('No WhatsApp messages sent yet.')}</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {messages.map(message => (
                <div key={message.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 font-mono">{formatPhone(message.phone)}</p>
                    <p className="text-sm text-neutral-600 truncate max-w-xl">{message.body}</p>
                    {message.error && <p className="text-xs text-red-600 mt-0.5">{message.error}</p>}
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <Badge variant={STATUS_BADGE[message.status]}>{t(STATUS_LABEL[message.status])}</Badge>
                    <p className="text-xs text-neutral-500">
                      {message.sourceType === 'WORKFLOW' ? t('Workflow') : t('Transactional')} ·{' '}
                      {dayjs(message.createdAt).fromNow()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              disabled={loadingMessages}
              onClick={() => void setSize(size + 1)}
            >
              {t('Load more')}
            </Button>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={showDisconnect}
        onOpenChange={setShowDisconnect}
        onConfirm={handleDisconnect}
        title={t('Disconnect WhatsApp?')}
        description={t('Messages from the API and workflows will fail until a number is connected again.')}
        confirmText={t('Disconnect')}
        variant="destructive"
      />
    </div>
  );
}
