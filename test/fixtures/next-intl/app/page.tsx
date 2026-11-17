import { useTranslations } from 'next-intl';

export default function HomePage({ count, place }: { count: number; place: number }) {
  const t = useTranslations('Home');
  return (
    <main>
      <h1>{t('title', { name: 'Saizul' })}</h1>
      <p>{t('cart', { count })}</p>
      <p>{t.rich('terms', { link: (chunks) => <a href="/terms">{chunks}</a> })}</p>
      <p>{t('rank', { place })}</p>
    </main>
  );
}
