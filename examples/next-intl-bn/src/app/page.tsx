import { useTranslations } from 'next-intl';

export default function Page({ count }: { count: number }) {
  const t = useTranslations('Home');
  return (
    <main>
      <h1>{t('title', { name: 'সাইজুল' })}</h1>
      <p>{t('unread', { count })}</p>
      <p>{t.rich('terms', { link: (chunks) => <a href="/terms">{chunks}</a> })}</p>
      <p>{t('updated', { date: new Date() })}</p>
    </main>
  );
}
