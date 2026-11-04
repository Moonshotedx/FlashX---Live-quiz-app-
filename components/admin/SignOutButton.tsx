'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Spinner';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-secondary"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/admin/auth/logout', { method: 'POST' }).catch(() => null);
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      {busy ? (
        <>
          <Spinner className="h-3.5 w-3.5" />
          Signing out…
        </>
      ) : (
        'Sign out'
      )}
    </button>
  );
}
