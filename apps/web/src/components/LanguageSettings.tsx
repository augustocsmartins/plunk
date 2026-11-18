import {Card, CardContent, CardDescription, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@plunk/ui';

import {getLocale, type Locale, setLocale, SUPPORTED_LOCALES, t} from '../lib/i18n';

/** Dashboard language for this browser. Changing it reloads the page. */
export function LanguageSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Language')}</CardTitle>
        <CardDescription>{t('Language of the dashboard in this browser.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select value={getLocale()} onValueChange={value => setLocale(value as Locale)}>
          <SelectTrigger className="max-w-xs" aria-label={t('Language')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LOCALES.map(locale => (
              <SelectItem key={locale.code} value={locale.code}>
                {locale.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
