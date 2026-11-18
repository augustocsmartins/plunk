import type {GlobalAnalyticsOverview} from '@plunk/types';
import {NextSeo} from 'next-seo';

import {AnalyticsFilters} from '../../components/analytics/AnalyticsFilters';
import {GlobalAlerts} from '../../components/analytics/global/GlobalAlerts';
import {GlobalProjectsTable} from '../../components/analytics/global/GlobalProjectsTable';
import {GlobalSummary} from '../../components/analytics/global/GlobalSummary';
import {useOpenProject} from '../../components/analytics/global/useOpenProject';
import {DashboardLayout} from '../../components/DashboardLayout';
import {FilterPill} from '../../components/data-table';
import {useProjects} from '../../lib/hooks/useProject';
import {useGlobalAnalyticsData, useGlobalAnalyticsFilters} from '../../lib/hooks/useGlobalAnalytics';
import {t} from '../../lib/i18n';

/**
 * Analytics across every project the user is a member of: the totals, the projects that
 * need attention, and each project side by side.
 */
export default function GlobalAnalyticsPage() {
  const filters = useGlobalAnalyticsFilters();
  const {bounds} = filters;
  const {data: projects} = useProjects();
  const overview = useGlobalAnalyticsData<GlobalAnalyticsOverview>('overview', filters);
  const openProject = useOpenProject(filters);

  const sameYear = bounds.first.year() === bounds.last.year();
  const period =
    bounds.days === 1
      ? t('{value}, compared with the day before.', {value: bounds.last.format('MMMM D, YYYY')})
      : t('{value} to {value2}, compared with the {days} days before.', {value: bounds.first.format(sameYear ? 'MMMM D' : 'MMMM D, YYYY'), value2: bounds.last.format('MMMM D, YYYY'), days: bounds.days});

  const retry = () => void overview.mutate();

  return (
    <>
      <NextSeo title={t('Global analytics')} />
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900">{t('Global analytics')}</h1>
            <p className="mt-2 text-sm text-neutral-500">
              {/* Counted from the response: ids in a shared link may name projects you have since left */}
              {filters.projects.length === 0
                ? t('All your projects')
                : overview.data
                  ? t('{length} selected {value}', {length: overview.data.projects.length, value: overview.data.projects.length === 1 ? 'project' : 'projects'})
                  : t('Selected projects')}
              {' · '}
              {period}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              title={t('Projects')}
              options={(projects ?? []).map(project => ({value: project.id, label: project.name}))}
              selected={filters.projects.filter(id => projects?.some(p => p.id === id) ?? true)}
              onChange={next => void filters.setScope({projects: next})}
            />
            <AnalyticsFilters filters={filters} showStream />
          </div>

          <GlobalSummary filters={filters} />

          {/* Problems first, then every project side by side, given the full width it needs */}
          <GlobalAlerts alerts={overview.data?.alerts} error={!!overview.error} onRetry={retry} onOpen={openProject} />
          <GlobalProjectsTable
            rows={overview.data?.projects}
            alerts={overview.data?.alerts}
            search={filters.search}
            onSearch={q => void filters.setScope({q})}
            narrowed={filters.projects.length > 0}
            error={!!overview.error}
            onRetry={retry}
            onOpen={openProject}
          />
        </div>
      </DashboardLayout>
    </>
  );
}
