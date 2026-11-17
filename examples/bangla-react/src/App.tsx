import { Trans, useTranslation } from 'react-i18next';

type Order = { id: string; status: 'pending' | 'shipped' | 'delivered' };

export function App({ name, count, total, orders }: { name: string; count: number; total: number; orders: Order[] }) {
  const { t } = useTranslation('common');
  return (
    <>
      <header>
        <strong>{t('brand')}</strong>
        <nav>
          <a href="/">{t('nav.home')}</a> <a href="/cart">{t('nav.cart')}</a>{' '}
          <a href="/account">{t('nav.account')}</a>
        </nav>
      </header>
      <h1>{t('hero.title', { name })}</h1>
      <p>
        <Trans i18nKey="hero.subtitle" values={{ days: 3 }} />
      </p>
      <p>{t('cart.items', { count })}</p>
      <p>{t('cart.total', { amount: total })}</p>
      <button type="button">{t('cart.checkout')}</button>
      <ul>
        {orders.map((o) => (
          // A computed key: reported as "dynamic, skipped", and status.* counts as used.
          <li key={o.id}>{t(`status.${o.status}`)}</li>
        ))}
      </ul>
    </>
  );
}
