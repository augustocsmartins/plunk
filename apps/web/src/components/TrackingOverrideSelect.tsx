import {TrackingMode} from '@plunk/db';
import {Label, Select, SelectContent, SelectItemWithDescription, SelectTrigger, SelectValue} from '@plunk/ui';
import {useActiveProject} from '../lib/contexts/ActiveProjectProvider';
import {useConfig} from '../lib/hooks/useConfig';
import {t} from '../lib/i18n';

const TRACKING_MODE_LABELS: Record<TrackingMode, string> = {
  [TrackingMode.ENABLED]: t('Enabled'),
  [TrackingMode.DISABLED]: t('Disabled'),
  [TrackingMode.MARKETING_ONLY]: t('Marketing only'),
};

const HELP_TEXT = {
  template: t('Applies wherever this template is sent: API calls and workflow steps.'),
  campaign: t('With tracking off, this campaign\'s results won\'t show opens or clicks.'),
} as const;

interface TrackingOverrideSelectProps {
  /** null follows the project's tracking mode; true/false overrides it */
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  appliesTo: keyof typeof HELP_TEXT;
}

/**
 * Open and click tracking for a single template or campaign. Hidden when the instance has no
 * no-tracking configuration set, like the project setting it overrides.
 */
export function TrackingOverrideSelect({value, onChange, appliesTo}: TrackingOverrideSelectProps) {
  const {data: config} = useConfig();
  const {activeProject} = useActiveProject();

  if (!config?.features.email.trackingToggleEnabled) {
    return null;
  }

  const projectMode = activeProject?.tracking ?? TrackingMode.ENABLED;
  const selected = value === null ? 'project' : value ? 'on' : 'off';

  return (
    <div className="space-y-2">
      <Label htmlFor="tracking">{t('Open and click tracking')}</Label>
      <Select value={selected} onValueChange={v => onChange(v === 'project' ? null : v === 'on')}>
        <SelectTrigger id="tracking">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItemWithDescription
            value="project"
            title={t('Project setting')}
            description={t('Follow the project\'s tracking mode ({value})', {value: TRACKING_MODE_LABELS[projectMode]})}
          />
          <SelectItemWithDescription value="on" title={t('Track')} description={t('Track opens and clicks')} />
          <SelectItemWithDescription
            value="off"
            title={t('Don\'t track')}
            description={t('No tracking pixel or link rewriting')}
          />
        </SelectContent>
      </Select>
      <p className="text-xs text-neutral-500">{HELP_TEXT[appliesTo]}</p>
    </div>
  );
}
