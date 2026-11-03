import { notFound, redirect } from 'next/navigation';
import { PresenterClient } from '@/components/presenter/PresenterClient';
import { getAdmin, presenterToken, validPresenterToken } from '@/lib/server/auth';
import { db } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/** Presenter view: needs an admin login or the session's unguessable presenter token (?t=). */
export default async function PresentPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ t?: string }> }) {
  const { sessionId } = await params;
  const { t } = await searchParams;
  let allowed = validPresenterToken(sessionId, t);
  if (!allowed) {
    const admin = await getAdmin();
    allowed = !!admin;
  }
  if (!allowed) redirect(`/admin/login?next=${encodeURIComponent(`/present/${sessionId}`)}`);
  const { data } = await db().from('sessions').select('id').eq('id', sessionId).maybeSingle();
  if (!data) notFound();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return <PresenterClient sessionId={sessionId} token={t ?? presenterToken(sessionId)} appUrl={appUrl} />;
}
