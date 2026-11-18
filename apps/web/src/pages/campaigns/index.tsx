import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconSpinner,
} from '@plunk/ui';
import type {Campaign, Template} from '@plunk/db';
import {CampaignStatus} from '@plunk/db';
import {CampaignSchemas} from '@plunk/shared';
import type {CampaignListItem, CampaignListResponse} from '@plunk/types';
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {DashboardLayout} from '../../components/DashboardLayout';
import {TemplateSelectionDialog} from '../../components/TemplateSelectionDialog';
import {CampaignSelectionDialog} from '../../components/CampaignSelectionDialog';
import {
  BulkActionBar,
  DataTable,
  DataTableColumnHeader,
  DataTableViewOptions,
  DataTableViewSwitcher,
  FilterPill,
  NoResultsState,
  SearchInput,
  isDataTableView,
  type DataTableColumnMeta,
  type DataTableView,
} from '../../components/data-table';
import {useShiftClickSelection} from '../../lib/hooks/useShiftClickSelection';
import {network} from '../../lib/network';
import {formatRelativeTime} from '../../lib/dateUtils';
import {
  Archive,
  ArchiveRestore,
  Ban,
  ChevronDown,
  CircleStop,
  Copy,
  FileText,
  Filter,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import {NextSeo} from 'next-seo';
import Link from 'next/link';
import {useRouter} from 'next/router';
import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import useSWR from 'swr';
import dayjs from 'dayjs';
import {useColumnVisibility} from '../../lib/hooks/useColumnVisibility';
import {usePersistentState} from '../../lib/hooks/usePersistentState';
import {t} from '../../lib/i18n';

type StatusFilter = 'ALL' | 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';

const VIEW_STORAGE_KEY = 'plunk:campaigns:view';
const COLUMNS_STORAGE_KEY = 'plunk:campaigns:columns';

// Name + Actions are locked-visible (see lockedColumnIds below). `select` is
// also locked. Everything starts visible.
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  select: true,
  name: true,
  status: true,
  audience: true,
  sent: true,
  opened: true,
  clicked: true,
  // Deliverability columns are opt-in from the Columns menu; the detail page already
  // breaks them down, and most scans of the list are about engagement.
  bounced: false,
  complained: false,
  when: true,
  actions: true,
};

// Fixed-value options for the Status filter pill.
const STATUS_OPTIONS: ReadonlyArray<Exclude<StatusFilter, 'ALL'>> = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'CANCELLED',
];

// Statuses a campaign can be archived from. Mirrors ARCHIVABLE_STATUSES in the API's
// CampaignService: a SCHEDULED or SENDING campaign still needs attention, so the row action
// is hidden for those rather than offering a button the server would reject.
const ARCHIVABLE_STATUSES: ReadonlyArray<CampaignStatus> = [
  CampaignStatus.DRAFT,
  CampaignStatus.SENT,
  CampaignStatus.CANCELLED,
];

const statusBadgeConfig: Record<CampaignStatus, {label: string; variant: 'neutral' | 'default' | 'success'}> = {
  DRAFT: {label: t('Draft'), variant: 'neutral'},
  SCHEDULED: {label: t('Scheduled'), variant: 'default'},
  SENDING: {label: t('Sending'), variant: 'default'},
  SENT: {label: t('Sent'), variant: 'success'},
  CANCELLED: {label: t('Cancelled'), variant: 'neutral'},
};

const getStatusBadge = (status: CampaignStatus) => {
  const {label, variant} = statusBadgeConfig[status];
  return (
    <Badge variant={variant} className="shrink-0">
      {label}
    </Badge>
  );
};

const rate = (count: number, of: number) => (of > 0 ? (count / of) * 100 : 0);

function Audience({campaign, className = ''}: {campaign: CampaignListItem; className?: string}) {
  const Icon = campaign.audienceType === 'FILTERED' ? Filter : Users;
  const label =
    campaign.audienceType === 'SEGMENT'
      ? (campaign.segment?.name ?? t('Deleted segment'))
      : campaign.audienceType === 'FILTERED'
        ? t('Custom filter')
        : t('All contacts');
  return (
    <span className={'inline-flex min-w-0 items-center gap-1.5 text-neutral-500 ' + className}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * The one date that matters for the campaign's state: when it went out, when it will, or when
 * the draft was last touched. `updatedAt` alone says little once a campaign has been sent.
 */
function CampaignTiming({campaign, className = ''}: {campaign: CampaignListItem; className?: string}) {
  let label: string;
  let date: Date | string;
  switch (campaign.status) {
    case 'SCHEDULED':
      date = campaign.scheduledFor ?? campaign.updatedAt;
      label = `Sends ${dayjs(date).format(dayjs(date).isSame(dayjs(), 'year') ? 'MMM D, HH:mm' : 'MMM D YYYY, HH:mm')}`;
      break;
    case 'SENDING':
      date = campaign.sentAt ?? campaign.updatedAt;
      label = t('Sending now');
      break;
    case 'SENT':
      date = campaign.sentAt ?? campaign.updatedAt;
      label = `Sent ${formatRelativeTime(date)}`;
      break;
    case 'CANCELLED':
      date = campaign.updatedAt;
      label = `Cancelled ${formatRelativeTime(date)}`;
      break;
    default:
      date = campaign.updatedAt;
      label = `Edited ${formatRelativeTime(date)}`;
  }
  return (
    <div className={'group relative inline-block cursor-help whitespace-nowrap ' + className}>
      {label}
      <div className="hidden group-hover:block absolute z-10 p-2 bg-neutral-900 text-white text-xs rounded shadow-md bottom-full left-0 mb-1 whitespace-nowrap">
        {dayjs(date).format('DD MMMM YYYY, HH:mm')}
      </div>
    </div>
  );
}

/**
 * The card's figures, per state. Sent campaigns get the full funnel; anything not yet sent shows
 * how many it will reach, and a campaign going out shows its progress.
 */
function CampaignCardStats({campaign}: {campaign: CampaignListItem}) {
  const stat = (value: string, label: string) => (
    <span>
      <strong className="font-semibold text-neutral-900 tabular-nums">{value}</strong>
      <span className="text-neutral-400 ml-1 text-xs">{label}</span>
    </span>
  );
  const divider = <span className="h-3 w-px bg-neutral-200" aria-hidden="true" />;

  if (campaign.status === 'SENDING') {
    const pct = rate(campaign.sentCount, campaign.totalRecipients);
    return (
      <div className="mt-4 text-sm">
        <div className="flex items-baseline justify-between">
          {stat(`${pct.toFixed(0)}%`, 'sent')}
          <span className="text-xs text-neutral-400 tabular-nums">
            {campaign.sentCount.toLocaleString()} {t('of')} {campaign.totalRecipients.toLocaleString()}
          </span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-neutral-100">
          <div className="h-1 rounded-full bg-neutral-900 transition-[width]" style={{width: `${pct}%`}} />
        </div>
      </div>
    );
  }

  if (campaign.status === 'SENT' || (campaign.status === 'CANCELLED' && campaign.sentCount > 0)) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        {stat(campaign.sentCount.toLocaleString(), 'sent')}
        {divider}
        {stat(`${rate(campaign.openedCount, campaign.sentCount).toFixed(1)}%`, 'opened')}
        {divider}
        {stat(`${rate(campaign.clickedCount, campaign.sentCount).toFixed(1)}%`, 'clicked')}
        {campaign.failedCount > 0 && (
          <>
            {divider}
            <span className="text-amber-700">
              <strong className="font-semibold tabular-nums">{campaign.failedCount.toLocaleString()}</strong>
              <span className="ml-1 text-xs">{t('not sent')}</span>
            </span>
          </>
        )}
      </div>
    );
  }

  if (campaign.totalRecipients === 0) return null;
  return (
    <div className="mt-4 text-sm">
      {stat(campaign.totalRecipients.toLocaleString(), campaign.status === 'CANCELLED' ? 'recipients' : 'estimated recipients')}
    </div>
  );
}

/** Rate over sent, with the raw count under it. Nothing to show until something has been sent. */
function MetricCell({value, of, decimals = 1}: {value: number; of: number; decimals?: number}) {
  if (of === 0) return <span className="text-sm text-neutral-300">—</span>;
  return (
    <div className="text-sm tabular-nums">
      <span className="font-semibold text-neutral-900">{rate(value, of).toFixed(decimals)}%</span>
      <span className="block text-xs text-neutral-400">{value.toLocaleString()}</span>
    </div>
  );
}

export default function CampaignsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Status travels with the id: cancelling has two outcomes and the dialog has to
  // name the right one. Deliberately not keyed off the row's `sentCount` -- that
  // column is only written when a send finalizes, so it reads 0 for a campaign that
  // is mid-flight and has in fact already sent thousands.
  const [campaignToCancel, setCampaignToCancel] = useState<{id: string; status: CampaignStatus} | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<string | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkDeleteStatus, setBulkDeleteStatus] = useState<'idle' | 'loading'>('idle');
  // Archive scope. Deliberately NOT persisted, unlike the view and column preferences: an
  // archive scope you don't remember entering looks like a project that lost its campaigns.
  const [showArchived, setShowArchived] = useState(false);
  const [bulkArchiveStatus, setBulkArchiveStatus] = useState<'idle' | 'loading'>('idle');
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showCampaignDialog, setShowCampaignDialog] = useState(false);
  const [view, setView] = usePersistentState<DataTableView>(VIEW_STORAGE_KEY, 'card', isDataTableView);

  // Tanstack table state.
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useColumnVisibility(COLUMNS_STORAGE_KEY, DEFAULT_COLUMN_VISIBILITY);
  // Row-selection state drives the BulkActionBar above the table.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Build the sort query string from tanstack state. The backend is
  // authoritative (`?sort=<field>&dir=asc|desc`); without those params it falls
  // back to its default order. manualSorting is on, so the client only mirrors.
  const sortParam = sorting[0]?.id ?? '';
  const dirParam = sorting[0] ? (sorting[0].desc ? 'desc' : 'asc') : '';

  const {data, mutate, isLoading} = useSWR<CampaignListResponse>(
    `/campaigns?page=${page}&pageSize=20${search ? `&search=${encodeURIComponent(search)}` : ''}${
      statusFilter !== 'ALL' ? `&status=${statusFilter}` : ''
    }${showArchived ? '&archived=true' : ''}${sortParam ? `&sort=${sortParam}&dir=${dirParam}` : ''}`,
    {revalidateOnFocus: false},
  );

  const archivedCount = data?.archivedCount ?? 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Clear row selection whenever the visible data set changes (page, search,
  // status filter). Selections only make sense for currently-visible rows —
  // keeping a stale selection across pagination would let the user bulk-delete
  // campaigns they can no longer see.
  useEffect(() => {
    setRowSelection({});
  }, [page, search, statusFilter, showArchived]);

  // Entering or leaving the archive is a different data set, so restart at page 1 rather
  // than landing on a page number the new scope may not have.
  const handleToggleArchived = (next: boolean) => {
    setShowArchived(next);
    setPage(1);
  };

  const handleCancel = async () => {
    if (!campaignToCancel) return;

    try {
      const res = await network.fetch<{data: {status: CampaignStatus}; revertPending?: boolean}>(
        'POST',
        `/campaigns/${campaignToCancel.id}/cancel`,
      );
      // A campaign stopped mid-send has its unsent emails cleared in the background and
      // only then becomes a draft, so the list reports the stop rather than an outcome
      // it would have to poll for. The next load shows where it landed.
      toast.success(
        res.revertPending
          ? t('Campaign stopped. Clearing its unsent emails, then it returns to draft.')
          : res.data.status === CampaignStatus.DRAFT
            ? t('Campaign stopped and returned to draft')
            : t('Campaign canceled'),
      );
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t cancel the campaign. Try again.'));
    } finally {
      setCampaignToCancel(null);
    }
  };

  const handleDuplicate = async (campaignId: string) => {
    try {
      await network.fetch('POST', `/campaigns/${campaignId}/duplicate`);
      toast.success(t('Campaign duplicated'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t duplicate the campaign. Try again.'));
    }
  };

  const handleUnarchive = async (campaignId: string) => {
    try {
      await network.fetch('POST', `/campaigns/${campaignId}/unarchive`);
      toast.success(t('Campaign restored'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t restore the campaign. Try again.'));
    }
  };

  // No confirmation dialog on purpose: archiving destroys nothing and the undo action on the
  // toast reverses it in one click, which is a cheaper recovery than a modal on every archive.
  const handleArchive = async (campaignId: string) => {
    try {
      await network.fetch('POST', `/campaigns/${campaignId}/archive`);
      toast.success(t('Campaign archived'), {
        action: {label: t('Undo'), onClick: () => void handleUnarchive(campaignId)},
      });
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t archive the campaign. Try again.'));
    }
  };

  const handleDelete = async () => {
    if (!campaignToDelete) return;

    try {
      await network.fetch('DELETE', `/campaigns/${campaignToDelete}`);
      toast.success(t('Campaign deleted'));
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t delete the campaign. Try again.'));
    } finally {
      setCampaignToDelete(null);
    }
  };

  const selectedIds = useMemo(() => Object.keys(rowSelection).filter(id => rowSelection[id]), [rowSelection]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkDeleteStatus('loading');
    try {
      const result = await network.fetch<{deleted?: number}, typeof CampaignSchemas.bulkUpdate>(
        'POST',
        '/campaigns/bulk-update',
        {
          ids: selectedIds,
          delete: true,
        },
      );
      const count = result?.deleted ?? selectedIds.length;
      toast.success(t('{count} campaign{value} deleted', {count: count, value: count === 1 ? '' : 's'}));
      setRowSelection({});
      void mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Couldn’t delete those campaigns. Try again.'));
    } finally {
      // ConfirmDialog closes itself after onConfirm resolves.
      setBulkDeleteStatus('idle');
    }
  };

  const handleBulkArchive = async (archived: boolean) => {
    if (selectedIds.length === 0) return;
    setBulkArchiveStatus('loading');
    try {
      const result = await network.fetch<{updated?: number}, typeof CampaignSchemas.bulkUpdate>(
        'POST',
        '/campaigns/bulk-update',
        {
          ids: selectedIds,
          archived,
        },
      );
      const count = result?.updated ?? selectedIds.length;
      toast.success(t('{count} campaign{value} {value2}', {count: count, value: count === 1 ? '' : 's', value2: archived ? 'archived' : 'restored'}));
      setRowSelection({});
      void mutate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Couldn’t {value} those campaigns. Try again.', {value: archived ? 'archive' : 'restore'}),
      );
    } finally {
      setBulkArchiveStatus('idle');
    }
  };

  const handleSelectTemplate = (
    template: Template,
    selectedFields: {
      subject: boolean;
      body: boolean;
      from: boolean;
      fromName: boolean;
      replyTo: boolean;
    },
  ) => {
    // Navigate to create page with template data as query params
    const query: Record<string, string> = {
      name: `${template.name}`,
    };

    // Only include templateId if body is selected (needed to fetch body content)
    if (selectedFields.body) {
      query.templateId = template.id;
    }

    // Add selected fields to query params
    if (selectedFields.subject) {
      query.subject = template.subject;
    }
    if (selectedFields.from) {
      query.from = template.from;
    }
    if (selectedFields.fromName && template.fromName) {
      query.fromName = template.fromName;
    }
    if (selectedFields.replyTo && template.replyTo) {
      query.replyTo = template.replyTo;
    }

    void router.push({
      pathname: '/campaigns/create',
      query,
    });
  };

  const handleSelectCampaign = (
    campaign: Campaign,
    selectedFields: {
      subject: boolean;
      body: boolean;
      from: boolean;
      fromName: boolean;
      replyTo: boolean;
      audience: boolean;
    },
  ) => {
    // Navigate to create page with campaign data as query params
    const query: Record<string, string> = {
      name: `${campaign.name}`,
    };

    // Only include campaignId if body is selected (needed to fetch body content)
    if (selectedFields.body) {
      query.campaignId = campaign.id;
    }

    // Add selected fields to query params
    if (selectedFields.subject) {
      query.subject = campaign.subject;
    }
    if (selectedFields.from) {
      query.from = campaign.from;
    }
    if (selectedFields.fromName && campaign.fromName) {
      query.fromName = campaign.fromName;
    }
    if (selectedFields.replyTo && campaign.replyTo) {
      query.replyTo = campaign.replyTo;
    }
    if (selectedFields.audience) {
      query.audienceType = campaign.audienceType;
      if (campaign.segmentId) {
        query.segmentId = campaign.segmentId;
      }
    }

    void router.push({
      pathname: '/campaigns/create',
      query,
    });
  };

  // Recipient figure per state: who it reached once sent, who it will reach before that.
  const recipientsCell = (campaign: CampaignListItem) => {
    if (campaign.status === 'SENDING') {
      const pct = rate(campaign.sentCount, campaign.totalRecipients);
      return (
        <div className="ml-auto w-24 text-sm tabular-nums">
          <span className="font-semibold text-neutral-900">{pct.toFixed(0)}%</span>
          <span className="text-xs text-neutral-400"> {t('sent')}</span>
          <div className="mt-1 h-1 rounded-full bg-neutral-100">
            <div className="h-1 rounded-full bg-neutral-900" style={{width: `${pct}%`}} />
          </div>
        </div>
      );
    }
    const count = campaign.status === 'SENT' ? campaign.sentCount : campaign.totalRecipients;
    const showFailed = campaign.status === 'SENT' && campaign.failedCount > 0;
    if (count === 0 && !showFailed) return <span className="text-sm text-neutral-300">—</span>;
    if (showFailed) {
      return (
        <div className="text-sm tabular-nums">
          <span className="font-semibold text-neutral-900">{count.toLocaleString()}</span>
          <div className="text-xs text-amber-700">{campaign.failedCount.toLocaleString()} {t('not sent')}</div>
        </div>
      );
    }
    return (
      <span
        className={
          'text-sm tabular-nums ' +
          (campaign.status === 'SENT' ? 'font-semibold text-neutral-900' : 'text-neutral-500')
        }
        title={campaign.status === 'SENT' ? undefined : t('Estimated, counted when the campaign sends')}
      >
        {count.toLocaleString()}
      </span>
    );
  };

  // One menu per row instead of a row of icon buttons. Which actions appear follows the same
  // rules as before: archive scope is view + restore, delete is drafts only, cancel is for
  // campaigns that are scheduled or going out.
  const actionsMenu = (campaign: CampaignListItem) => {
    const canCancel = campaign.status === 'SCHEDULED' || campaign.status === 'SENDING';
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('Actions for {name}', {name: campaign.name})} title={t('Actions')}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {showArchived ? (
            <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => void handleUnarchive(campaign.id)}>
              <ArchiveRestore className="h-4 w-4" />
              {t('Restore')}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => void handleDuplicate(campaign.id)}>
                <Copy className="h-4 w-4" />
                {t('Duplicate')}
              </DropdownMenuItem>
              {ARCHIVABLE_STATUSES.includes(campaign.status) && (
                <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => void handleArchive(campaign.id)}>
                  <Archive className="h-4 w-4" />
                  {t('Archive')}
                </DropdownMenuItem>
              )}
              {(campaign.status === 'DRAFT' || canCancel) && <DropdownMenuSeparator />}
              {campaign.status === 'DRAFT' && (
                <DropdownMenuItem
                  className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                  onClick={() => {
                    setCampaignToDelete(campaign.id);
                    setShowDeleteDialog(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('Delete')}
                </DropdownMenuItem>
              )}
              {canCancel && (
                <DropdownMenuItem
                  className="gap-2 cursor-pointer text-red-600 focus:text-red-600"
                  onClick={() => {
                    setCampaignToCancel({id: campaign.id, status: campaign.status});
                    setShowCancelDialog(true);
                  }}
                >
                  <Ban className="h-4 w-4" />
                  {campaign.status === 'SCHEDULED' ? t('Stop') : t('Cancel sending')}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const columns = useMemo<Array<ColumnDef<CampaignListItem, unknown>>>(
    () => [
      {
        id: 'select',
        enableSorting: false,
        enableHiding: false, // Selection column is locked-visible.
        meta: {label: t('Select'), headClassName: 'w-10', cellClassName: 'w-10'} satisfies DataTableColumnMeta,
        header: ({table}) => (
          <Checkbox
            aria-label={t('Select all rows on this page')}
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
          />
        ),
        cell: ({row}) => (
          <Checkbox
            aria-label={t('Select {name}', {name: row.original.name})}
            checked={row.getIsSelected()}
            // Capture shift-key state before the toggle, then apply range
            // selection on change (see useShiftClickSelection below).
            onClick={e => {
              e.stopPropagation();
              shiftSelect.onClick(e);
            }}
            onCheckedChange={value => shiftSelect.onCheckedChange(row, value)}
          />
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        enableHiding: false, // Name column is locked-visible.
        meta: {label: t('Name'), cellClassName: 'max-w-[18rem]'} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('Name')}</DataTableColumnHeader>,
        cell: ({row}) => (
          <div className="min-w-0">
            <Link
              href={`/campaigns/${row.original.id}`}
              className="block truncate text-sm font-medium text-neutral-900 hover:text-neutral-700 focus-visible:outline-none focus-visible:underline"
            >
              {row.original.name}
            </Link>
            <p className="truncate text-xs text-neutral-500" title={row.original.subject}>
              {row.original.subject || <span className="italic text-neutral-400">{t('No subject')}</span>}
            </p>
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        enableSorting: false, // Status is faceted-filtered, not sorted.
        meta: {label: t('Status')} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('Status')}</DataTableColumnHeader>,
        cell: ({row}) => getStatusBadge(row.original.status),
      },
      {
        id: 'audience',
        enableSorting: false,
        meta: {label: t('Audience'), cellClassName: 'max-w-[12rem]'} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('Audience')}</DataTableColumnHeader>,
        cell: ({row}) => <Audience campaign={row.original} className="max-w-full text-sm" />,
      },
      {
        id: 'sent',
        enableSorting: false, // No backend sort field for counts.
        meta: {label: t('Recipients'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader column={column} align="right">
            {t('Recipients')}
          </DataTableColumnHeader>
        ),
        cell: ({row}) => recipientsCell(row.original),
      },
      {
        id: 'opened',
        enableSorting: false,
        meta: {label: t('Opened'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader column={column} align="right">
            {t('Opened')}
          </DataTableColumnHeader>
        ),
        cell: ({row}) => <MetricCell value={row.original.openedCount} of={row.original.sentCount} />,
      },
      {
        id: 'clicked',
        enableSorting: false,
        meta: {label: t('Clicked'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader column={column} align="right">
            {t('Clicked')}
          </DataTableColumnHeader>
        ),
        cell: ({row}) => <MetricCell value={row.original.clickedCount} of={row.original.sentCount} />,
      },
      {
        id: 'bounced',
        enableSorting: false,
        meta: {label: t('Bounced'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader column={column} align="right">
            {t('Bounced')}
          </DataTableColumnHeader>
        ),
        cell: ({row}) => <MetricCell value={row.original.bouncedCount} of={row.original.sentCount} />,
      },
      {
        id: 'complained',
        enableSorting: false,
        meta: {label: t('Complaints'), headClassName: 'text-right', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: ({column}) => (
          <DataTableColumnHeader column={column} align="right">
            {t('Complaints')}
          </DataTableColumnHeader>
        ),
        // Two decimals: complaint thresholds sit around 0.1%, which one decimal would flatten.
        cell: ({row}) => <MetricCell value={row.original.complainedCount} of={row.original.sentCount} decimals={2} />,
      },
      {
        id: 'when',
        enableSorting: false, // Mixes sent/scheduled/edited dates, which no single backend field sorts.
        meta: {label: t('Date')} satisfies DataTableColumnMeta,
        header: ({column}) => <DataTableColumnHeader column={column}>{t('Date')}</DataTableColumnHeader>,
        cell: ({row}) => <CampaignTiming campaign={row.original} className="text-sm text-neutral-500" />,
      },
      {
        id: 'actions',
        enableSorting: false,
        enableHiding: false, // Actions column is locked-visible.
        meta: {label: t('Actions'), headClassName: 'text-right w-12', cellClassName: 'text-right'} satisfies DataTableColumnMeta,
        header: () => <span className="sr-only">{t('Actions')}</span>,
        cell: ({row}) => <div className="flex justify-end">{actionsMenu(row.original)}</div>,
      },
    ],
    // Re-creating columns on every render is cheap and avoids stale-closure bugs
    // for the statusFilter-driven facet and cancel/delete/duplicate handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statusFilter],
  );

  const table = useReactTable<CampaignListItem>({
    data: data?.data ?? [],
    columns,
    state: {sorting, columnVisibility, rowSelection},
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    enableMultiSort: false,
    manualSorting: true, // Backend handles sorting; client just exposes ?sort=&dir=.
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
  });

  // Range (shift-click) selection for the checkbox column.
  const shiftSelect = useShiftClickSelection(table);

  const hasData = data && data.data.length > 0;

  // Whether any search/facet filter is currently narrowing the list. Drives the
  // "no results vs first-run empty" distinction below.
  const hasActiveFilters = search !== '' || statusFilter !== 'ALL';

  // Reset everything that can hide rows (search + status + pagination) so the
  // user can recover from a filter combination that matched nothing.
  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatusFilter('ALL');
    setPage(1);
  };

  return (
    <>
      <NextSeo title={t('Campaigns')} />
      <DashboardLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('Campaigns')}</h1>
              <p className="text-neutral-500 mt-2 text-sm sm:text-base">
                {t('One-off emails sent to a list of contacts.')}{' '}{data?.total ? t('{total} total', {total: data.total}) : ''}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="w-full sm:w-auto">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('Create campaign')}</span>
                  <span className="sm:hidden">{t('Create')}</span>
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuItem asChild className="py-3 cursor-pointer">
                  <Link href="/campaigns/create" className="flex items-start gap-3">
                    <Mail className="h-4 w-4 mt-0.5 text-neutral-700" />
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-medium text-sm">{t('Empty campaign')}</span>
                      <span className="text-xs text-neutral-500 leading-snug">
                        {t('Start from scratch with a blank canvas')}
                      </span>
                    </div>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowTemplateDialog(true)} className="py-3 cursor-pointer">
                  <div className="flex items-start gap-3">
                    <FileText className="h-4 w-4 mt-0.5 text-neutral-700" />
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-medium text-sm">{t('From template')}</span>
                      <span className="text-xs text-neutral-500 leading-snug">
                        {t('Use an existing template as a starting point')}
                      </span>
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCampaignDialog(true)} className="py-3 cursor-pointer">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="h-4 w-4 mt-0.5 text-neutral-700" />
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="font-medium text-sm">{t('From previous campaign')}</span>
                      <span className="text-xs text-neutral-500 leading-snug">
                        {t('Copy content and settings from an existing campaign')}
                      </span>
                    </div>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Control row. One aligned cluster of 32px-tall controls:
              - Search input: always present (both views).
              - Status filter: a FilterPill, the same in both views.
              - Columns selector: TABLE VIEW ONLY.
              - A hairline divider separates the data controls (filter/columns)
                from the layout control (view switcher). */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              onClear={() => {
                setSearchInput('');
                setSearch('');
                setPage(1);
              }}
              placeholder={t('Search campaigns…')}
              className="flex-1"
            />
            <div className="flex items-center gap-2 shrink-0">
              <FilterPill
                title={t('Status')}
                multiple={false}
                options={STATUS_OPTIONS.map(s => ({value: s, label: statusBadgeConfig[s].label}))}
                selected={statusFilter === 'ALL' ? [] : [statusFilter]}
                onChange={next => {
                  setStatusFilter((next[0] as StatusFilter) ?? 'ALL');
                  setPage(1);
                }}
              />
              {view === 'table' && (
                <DataTableViewOptions table={table} lockedColumnIds={['select', 'name', 'actions']} />
              )}
              {/* Scope toggle, not a filter: archived is orthogonal to status, so it sits
                  beside the Status control rather than inside it. Hidden entirely until the
                  project has archived something, so a list that never uses the feature pays
                  no chrome for it. */}
              {(archivedCount > 0 || showArchived) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={showArchived}
                  title={showArchived ? t('Back to active campaigns') : t('Show archived campaigns')}
                  onClick={() => handleToggleArchived(!showArchived)}
                  className={'gap-1.5 ' + (showArchived ? 'bg-neutral-100 border-neutral-300' : '')}
                >
                  <Archive className="h-4 w-4 text-neutral-500" />
                  <span>{t('Archived')}</span>
                  {!showArchived && archivedCount > 0 && (
                    <span className="text-neutral-500 tabular-nums">{archivedCount.toLocaleString()}</span>
                  )}
                </Button>
              )}
              <span className="hidden sm:block h-5 w-px bg-neutral-200" aria-hidden="true" />
              <DataTableViewSwitcher view={view} onChange={setView} />
            </div>
          </div>

          {/* Scope indicator. One text row rather than a banner card -- the toggle above
              already carries the state, this just makes it unmissable and offers the exit. */}
          {showArchived && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span>{t('Showing archived campaigns.')}</span>
              <button
                type="button"
                onClick={() => handleToggleArchived(false)}
                className="font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-600 transition-colors"
              >
                {t('Back to active')}
              </button>
            </div>
          )}

          {/* Bulk action bar — table view only (the selection column lives
              there). Wires the delete action; the children slot stays open for
              future bulk operations. */}
          {view === 'table' && (
            <BulkActionBar selectedCount={selectedIds.length} itemNoun="campaign" onClear={() => setRowSelection({})}>
              {showArchived ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBulkArchive(false)}
                  disabled={bulkArchiveStatus === 'loading'}
                >
                  <ArchiveRestore className="h-4 w-4" />
                  {t('Restore selected')}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleBulkArchive(true)}
                    disabled={bulkArchiveStatus === 'loading'}
                  >
                    <Archive className="h-4 w-4" />
                    {t('Archive selected')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowBulkDeleteDialog(true)}
                    disabled={bulkDeleteStatus === 'loading'}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('Delete selected')}
                  </Button>
                </>
              )}
            </BulkActionBar>
          )}

          {/* Campaigns */}
          <div className="space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-center py-12">
                    <IconSpinner />
                  </div>
                </CardContent>
              </Card>
            ) : !hasData ? (
              <Card>
                <CardContent>
                  {hasActiveFilters ? (
                    // Items exist, but the active search/status filters matched
                    // none — offer a one-click recovery. `clearFilters` deliberately
                    // leaves the archive scope alone: the scope is not a filter, and
                    // silently returning the user to the active list would look like
                    // the clear had done something else entirely.
                    <NoResultsState icon={Mail} itemNoun="campaigns" onClear={clearFilters} />
                  ) : showArchived ? (
                    // Archive scope with nothing in it. Reachable after restoring the last
                    // archived campaign without leaving the scope.
                    <EmptyState
                      icon={Archive}
                      title={t('No archived campaigns')}
                      description={t('Archiving hides a campaign from your list without deleting it. Its stats stay available.')}
                      action={
                        <Button variant="outline" onClick={() => handleToggleArchived(false)}>
                          {t('Back to active')}
                        </Button>
                      }
                    />
                  ) : (
                    // Genuinely empty project — first-run state.
                    <EmptyState
                      icon={Mail}
                      title={t('No campaigns yet')}
                      description={t('Send one-off emails to groups of contacts.')}
                      action={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button>
                              <Plus className="h-4 w-4" />
                              {t('Create Campaign')}
                              <ChevronDown className="h-4 w-4 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="w-80">
                            <DropdownMenuItem asChild className="py-3 cursor-pointer">
                              <Link href="/campaigns/create" className="flex items-start gap-3">
                                <Mail className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div className="flex flex-col gap-0.5 flex-1">
                                  <span className="font-medium text-sm">{t('Empty campaign')}</span>
                                  <span className="text-xs text-neutral-500 leading-snug">
                                    {t('Start from scratch with a blank canvas')}
                                  </span>
                                </div>
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setShowTemplateDialog(true)} className="py-3 cursor-pointer">
                              <div className="flex items-start gap-3">
                                <FileText className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div className="flex flex-col gap-0.5 flex-1">
                                  <span className="font-medium text-sm">{t('From template')}</span>
                                  <span className="text-xs text-neutral-500 leading-snug">
                                    {t('Use an existing template as a starting point')}
                                  </span>
                                </div>
                              </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setShowCampaignDialog(true)} className="py-3 cursor-pointer">
                              <div className="flex items-start gap-3">
                                <RefreshCw className="h-4 w-4 mt-0.5 text-neutral-700" />
                                <div className="flex flex-col gap-0.5 flex-1">
                                  <span className="font-medium text-sm">{t('From previous campaign')}</span>
                                  <span className="text-xs text-neutral-500 leading-snug">
                                    {t('Copy content and settings from an existing campaign')}
                                  </span>
                                </div>
                              </div>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {view === 'card' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {data?.data.map(campaign => (
                      <Card
                        key={campaign.id}
                        className="transition-colors hover:border-neutral-300 flex flex-col [&:has([data-card-link]:focus-visible)]:ring-2 [&:has([data-card-link]:focus-visible)]:ring-ring [&:has([data-card-link]:focus-visible)]:ring-offset-2"
                      >
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          data-card-link=""
                          className="flex-1 block p-6 pb-4 hover:bg-neutral-50/50 transition-colors rounded-t-xl focus-visible:outline-none"
                          aria-label={t('Open {name}', {name: campaign.name})}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold text-neutral-900 leading-snug truncate">{campaign.name}</h3>
                            {getStatusBadge(campaign.status)}
                          </div>
                          <p className="mt-0.5 text-sm text-neutral-500 truncate">
                            {campaign.subject || <span className="italic text-neutral-400">{t('No subject')}</span>}
                          </p>
                          <CampaignCardStats campaign={campaign} />
                        </Link>
                        <div className="px-6 py-2 border-t border-neutral-100 flex items-center justify-between gap-3 text-xs text-neutral-400">
                          <div className="flex min-w-0 items-center gap-3">
                            <Audience campaign={campaign} className="text-neutral-400" />
                            <span className="h-3 w-px shrink-0 bg-neutral-200" aria-hidden="true" />
                            <CampaignTiming campaign={campaign} />
                          </div>
                          {actionsMenu(campaign)}
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card>
                    <CardContent className="p-0">
                      <DataTable table={table} />
                    </CardContent>
                  </Card>
                )}

                {/* Pagination — shared by both views, same layout as workflows. */}
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-neutral-500">
                      {t('Showing')}{' '}{(page - 1) * data.pageSize + 1} {t('to')} {Math.min(page * data.pageSize, data.total)} {t('of')}{' '}
                      {data.total} {t('campaigns')}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
                        {t('Previous')}
                      </Button>
                      <span className="text-sm text-neutral-700">
                        {t('Page')}{' '}{page} {t('of')} {data.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page === data.totalPages}
                      >
                        {t('Next')}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={showCancelDialog}
          onOpenChange={setShowCancelDialog}
          onConfirm={handleCancel}
          title={campaignToCancel?.status === CampaignStatus.SCHEDULED ? t('Stop this campaign?') : t('Cancel this campaign?')}
          description={
            campaignToCancel?.status === CampaignStatus.SCHEDULED
              ? t('Nothing has been sent yet, so the campaign returns to draft and stays editable.')
              : t('Sending stops now. If nothing has gone out yet the campaign returns to draft; otherwise it is permanently cancelled and contacts who already received it keep their copy.')
          }
          cancelText={t('Keep sending')}
          icon={CircleStop}
          confirmText={campaignToCancel?.status === CampaignStatus.SCHEDULED ? t('Stop campaign') : t('Cancel campaign')}
          variant="destructive"
        />

        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onConfirm={handleDelete}
          title={t('Delete this draft?')}
          description={t('The draft and its content are gone for good.')}
          confirmText={t('Delete campaign')}
          variant="destructive"
        />

        <ConfirmDialog
          open={showBulkDeleteDialog}
          onOpenChange={setShowBulkDeleteDialog}
          onConfirm={handleBulkDelete}
          title={t('Delete {length} campaign{value}?', {length: selectedIds.length, value: selectedIds.length === 1 ? '' : 's'})}
          description={t('Only drafts can be deleted. If your selection includes a sent or scheduled campaign, nothing will be deleted.')}
          confirmText={t('Delete campaigns')}
          variant="destructive"
          status={bulkDeleteStatus}
        />

        <TemplateSelectionDialog
          open={showTemplateDialog}
          onOpenChange={setShowTemplateDialog}
          onSelectTemplate={handleSelectTemplate}
        />

        <CampaignSelectionDialog
          open={showCampaignDialog}
          onOpenChange={setShowCampaignDialog}
          onSelectCampaign={handleSelectCampaign}
        />
      </DashboardLayout>
    </>
  );
}
