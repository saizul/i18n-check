import { useTranslation } from 'react-i18next';

export function Account() {
  const { t } = useTranslation('account');
  return (
    <section>
      <h2>{t('title')}</h2>
      <p>{t('orders')}</p>
      <button type="button">{t('logout')}</button>
    </section>
  );
}
