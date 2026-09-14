import { redirect } from 'next/navigation';

/** The resident portal has no dashboard of its own; lookup is the default view. */
export default async function ResidentPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  redirect(`/${lang}/resident/lookup`);
}
