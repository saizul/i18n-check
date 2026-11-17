import { useTranslation } from 'react-i18next';

export function Login() {
  const { t } = useTranslation('auth', { keyPrefix: 'login' });
  const label = t("button");
  return <form aria-label={label}>{t('error')}</form>;
}

// A helper that is not a translation call:
function t(key: string): string {
  return key;
}
export const helper = t;
