import { getTranslations } from 'next-intl/server';

export default async function AboutPage() {
  const t = await getTranslations({ locale: 'en', namespace: 'About' });
  const common = await getTranslations();
  return (
    <section>
      <h1>{t('title')}</h1>
      <p>{t('since', { year: 2020 })}</p>
      <p>{common('Home.title', { name: 'x' })}</p>
      <p>{t('missing')}</p>
    </section>
  );
}
