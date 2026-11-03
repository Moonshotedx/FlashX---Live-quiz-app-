import { StudentApp } from '@/components/student/StudentApp';
import { normalizeJoinCode } from '@/lib/join-code';

export const dynamic = 'force-dynamic';

export default async function JoinPage({ params }: { params: Promise<{ joinCode: string }> }) {
  const { joinCode } = await params;
  return <StudentApp code={normalizeJoinCode(joinCode)} />;
}

