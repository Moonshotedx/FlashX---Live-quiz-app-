import Link from 'next/link';
import { authClient, isAdminUser } from '@/lib/server/auth';
import { SignOutButton } from '@/components/admin/SignOutButton';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sb = await authClient();
  const { data } = await sb.auth.getUser();
  const user = data.user;

  // Login page (no user) renders bare.
  if (!user) return <>{children}</>;

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="panel max-w-md space-y-3 text-center">
          <h1 className="text-xl font-bold text-white">Not an admin account</h1>
          <p className="text-sm text-slate-400">{user.email} does not have admin access. Ask an administrator to add it.</p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 print:min-h-0 print:bg-white print:text-black">
      <header className="no-print sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2 text-lg font-bold text-white">
            <span>🎯</span> Live Quiz
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span className="hidden sm:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
