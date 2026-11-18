import {Alert, AlertDescription, AlertTitle, Card, CardContent, CardDescription, CardHeader, CardTitle} from '@plunk/ui';
import {AlertCircle, AlertTriangle, CheckCircle, Shield} from 'lucide-react';
import type {ProjectSecurityMetrics, SecurityLevel} from '@plunk/types';
import {t} from '../lib/i18n';

interface SecuritySettingsProps {
  metrics: ProjectSecurityMetrics;
  isLoading: boolean;
}

const STATUS_CONFIG: Record<SecurityLevel, {color: string; icon: typeof CheckCircle; bg: string; label: string}> = {
  healthy: {color: 'text-green-600', icon: CheckCircle, bg: 'bg-green-100', label: t('Healthy')},
  warning: {color: 'text-amber-700', icon: AlertTriangle, bg: 'bg-amber-100', label: t('Warning')},
  critical: {color: 'text-red-600', icon: AlertCircle, bg: 'bg-red-100', label: t('Critical')},
};

function getOverallLevel(status: ProjectSecurityMetrics['status']): SecurityLevel {
  if (status.violations.length > 0) return 'critical';
  if (status.warnings.length > 0) return 'warning';
  return 'healthy';
}

export function SecuritySettings({metrics, isLoading}: SecuritySettingsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('Security overview')}</CardTitle>
          <CardDescription>{t('Monitor your project\'s email health and reputation')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-neutral-500">{t('Loading security metrics...')}</p>
        </CardContent>
      </Card>
    );
  }

  const {status, levels, isDisabled} = metrics;
  const overallLevel = getOverallLevel(status);
  const overallConfig = STATUS_CONFIG[overallLevel];

  return (
    <div className="space-y-6">
      {/* Overall Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${overallConfig.bg}`}>
              <Shield className={`h-5 w-5 ${overallConfig.color}`} />
            </div>
            <div>
              <CardTitle>{t('Security overview')}</CardTitle>
              <CardDescription>
                {overallLevel === 'healthy' && t('Your project is in good standing')}
                {overallLevel === 'warning' && t('Your email health needs attention')}
                {overallLevel === 'critical' && t('Action required to maintain project health')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isDisabled && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('Project disabled')}</AlertTitle>
              <AlertDescription>
                {t('This project has been disabled. Please contact support for more details.')}
              </AlertDescription>
            </Alert>
          )}

          {overallLevel === 'critical' && !isDisabled && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t('Critical')}</AlertTitle>
              <AlertDescription>
                {t('Your account requires immediate attention. Please contact support or review your sending practices to avoid suspension.')}
              </AlertDescription>
            </Alert>
          )}

          {overallLevel === 'warning' && (
            <Alert variant="warning" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('Warning')}</AlertTitle>
              <AlertDescription>
                {t('Your account health needs attention. Review your contact lists and sending practices to maintain good standing.')}
              </AlertDescription>
            </Alert>
          )}

          {overallLevel === 'healthy' && !isDisabled && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription>
                {t('Bounce and complaint rates are within limits.')}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Bounce Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>{t('Bounce rate')}</CardTitle>
          <CardDescription>{t('Hard bounces indicate invalid or non-existent email addresses')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-neutral-100">
            <HealthMetric
              label={t('Last 7 days')}
              level={levels.bounce7Day}
              detail={t('{value}% bounce rate ({value2} of {value3} emails)', {value: status.sevenDay.bounceRate.toFixed(2), value2: status.sevenDay.bounces.toLocaleString(), value3: status.sevenDay.total.toLocaleString()})}
            />
            <HealthMetric
              label={t('All time')}
              level={levels.bounceAllTime}
              detail={t('{value}% bounce rate ({value2} of {value3} emails)', {value: status.allTime.bounceRate.toFixed(2), value2: status.allTime.bounces.toLocaleString(), value3: status.allTime.total.toLocaleString()})}
            />
          </div>
        </CardContent>
      </Card>

      {/* Complaint Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>{t('Complaint rate')}</CardTitle>
          <CardDescription>{t('Complaints occur when recipients mark emails as spam')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-neutral-100">
            <HealthMetric
              label={t('Last 7 days')}
              level={levels.complaint7Day}
              detail={t('{value}% complaint rate ({value2} of {value3} emails)', {value: status.sevenDay.complaintRate.toFixed(3), value2: status.sevenDay.complaints.toLocaleString(), value3: status.sevenDay.total.toLocaleString()})}
            />
            <HealthMetric
              label={t('All time')}
              level={levels.complaintAllTime}
              detail={t('{value}% complaint rate ({value2} of {value3} emails)', {value: status.allTime.complaintRate.toFixed(3), value2: status.allTime.complaints.toLocaleString(), value3: status.allTime.total.toLocaleString()})}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface HealthMetricProps {
  label: string;
  level: SecurityLevel;
  detail: string;
}

function HealthMetric({label, level, detail}: HealthMetricProps) {
  const config = STATUS_CONFIG[level];
  const Icon = config.icon;

  return (
    <div className="flex items-center justify-between px-6 py-4">
      <div>
        <h3 className="font-medium text-neutral-900">{label}</h3>
        <p className="text-sm text-neutral-600 mt-0.5">{detail}</p>
      </div>
      <div className={`flex items-center gap-2 ${config.color}`}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{config.label}</span>
      </div>
    </div>
  );
}
