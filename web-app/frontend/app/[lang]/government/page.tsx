import { redirect } from 'next/navigation';

/** Straight to the first operation. The API-key gate lives in the layout, so
 *  it still runs before any of these pages render. */
export default async function GovernmentPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  redirect(`/${lang}/government/import`);
}
