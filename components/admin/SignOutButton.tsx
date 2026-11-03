'use client';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace('/admin/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

