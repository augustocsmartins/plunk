import {Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label} from '@plunk/ui';
import {NextSeo} from 'next-seo';
import {DashboardLayout} from '../../components/DashboardLayout';
import {SegmentFilterBuilder} from '../../components/SegmentFilterBuilder';
import {ContactPicker} from '../../components/ContactPicker';
import {network} from '../../lib/network';
import {ArrowLeft, Save} from 'lucide-react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useState} from 'react';
import {toast} from 'sonner';
import type {FilterCondition} from '@plunk/types';
import type {Segment} from '@plunk/db';
import {SegmentSchemas} from '@plunk/shared';
import {t} from '../../lib/i18n';

type SegmentType = 'DYNAMIC' | 'STATIC';

export default function NewSegmentPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [segmentType, setSegmentType] = useState<SegmentType>('DYNAMIC');
  const [trackMembership, setTrackMembership] = useState(false);
  const [condition, setCondition] = useState<FilterCondition>({
    logic: 'AND',
    groups: [
      {
        filters: [{field: 'subscribed', operator: 'equals', value: true}],
      },
    ],
  });
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const segment = await network.fetch<Segment, typeof SegmentSchemas.create>('POST', '/segments', {
        name,
        description: description || undefined,
        type: segmentType,
        condition: segmentType === 'DYNAMIC' ? condition : undefined,
        trackMembership,
      });

      // For static segments with pre-selected contacts, add them now
      if (segmentType === 'STATIC' && selectedContacts.length > 0) {
        try {
          const result = await network.fetch<{added: number; created: number; notFound: string[]}, typeof SegmentSchemas.members>(
            'POST',
            `/segments/${segment.id}/members`,
            {emails: selectedContacts, createMissing: true},
          );
          const msg = result.created > 0
            ? t('Segment created with {added} contact{value} ({created} new)', {added: result.added, value: result.added !== 1 ? 's' : '', created: result.created})
            : t('Segment created with {added} contact{value}', {added: result.added, value: result.added !== 1 ? 's' : ''});
          toast.success(msg);
        } catch {
          // Segment was created; just warn about members
          toast.warning(t('Segment created, but some contacts could not be added'));
        }
      } else {
        toast.success(t('Segment created'));
      }

      void router.push('/segments');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t create the segment. Try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <NextSeo title={t('Create segment')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Button asChild variant="outline" size="sm">
              <Link href="/segments"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('Create segment')}</h1>
              <p className="text-neutral-500 mt-1">
                {segmentType === 'DYNAMIC'
                  ? t('Build complex audience filters with AND/OR logic')
                  : t('Manually curate a list of contacts')}
              </p>
            </div>
          </div>

          {/* Type Toggle */}
          <div className="flex gap-2 p-1 bg-neutral-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setSegmentType('DYNAMIC')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                segmentType === 'DYNAMIC'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t('Dynamic')}
            </button>
            <button
              type="button"
              onClick={() => setSegmentType('STATIC')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                segmentType === 'STATIC'
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {t('Static')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <Card>
              <CardHeader>
                <CardTitle>{t('Segment details')}</CardTitle>
                <CardDescription>{t('Give your segment a name and description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="name">{t('Segment name')}
            <span className="text-red-500"> *</span>
          </Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    placeholder={t('e.g., VIP Customers or Recent High Spenders')}
                    maxLength={100}
                  />
                </div>

                <div>
                  <Label htmlFor="description">{t('Description')}</Label>
                  <Input
                    id="description"
                    type="text"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t('e.g., Users on VIP plan OR recent signups who spent $1000+')}
                    maxLength={500}
                  />
                </div>

                <div className="flex items-start gap-3 p-4 bg-neutral-50 rounded-lg border border-neutral-200">
                  <input
                    id="trackMembership"
                    type="checkbox"
                    checked={trackMembership}
                    onChange={e => setTrackMembership(e.target.checked)}
                    className="mt-1 h-4 w-4 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border-neutral-300 rounded"
                  />
                  <div className="flex-1">
                    <Label htmlFor="trackMembership" className="font-medium cursor-pointer">
                      {t('Track membership changes')}
                    </Label>
                    <p className="text-xs text-neutral-500 mt-1">
                      {t('When enabled, segment entry and exit events will be tracked for use in workflows and analytics')}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Filter Builder or Contact Picker */}
            {segmentType === 'DYNAMIC' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('Filter conditions')}</CardTitle>
                  <CardDescription>{t('Build complex audience filters with AND/OR logic')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <SegmentFilterBuilder condition={condition} onChange={setCondition} />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{t('Initial members')}</CardTitle>
                  <CardDescription>
                    {t('Optionally add contacts now — you can always add or remove members later')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ContactPicker
                    selected={selectedContacts}
                    onChange={setSelectedContacts}
                    onAdd={async (emails, _subscribed) => setSelectedContacts(prev => [...new Set([...prev, ...emails])])}
                    placeholder={t('Search and select contacts…')}
                  />
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <Button asChild variant="outline" disabled={isSubmitting}>
                <Link href="/segments">{t('Cancel')}</Link>
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                <Save className="h-4 w-4 mr-2" />
                {isSubmitting ? t('Creating…') : t('Create Segment')}
              </Button>
            </div>
          </form>
        </div>
      </DashboardLayout>
    </>
  );
}
