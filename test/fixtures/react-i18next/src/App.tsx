import { Trans, useTranslation } from 'react-i18next';

export function App({ user, status, count }: { user: string; status: string; count: number }) {
  const { t } = useTranslation('common');
  // t('commented.out') must not count
  return (
    <main title={t('title', { name: user })}>
      <Trans i18nKey="welcome" values={{ name: user, count }} components={{ 1: <b /> }} />
      <p>{t('items', { count })}</p>
      <p>{t(`status.${status}`)}</p>
      <p>Don't forget: {t('nav.home')}</p>
      <a href="/settings">{t('nav.settings')}</a>
      <footer>{t('footer')}</footer>
      <button type="button">{t('auth:logout')}</button>
      <span>{t('missing.in.base')}</span>
    </main>
  );
}
