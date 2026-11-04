'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FlashXLogo } from '@/components/brand/FlashXLogo';
import { Spinner } from '@/components/ui/Spinner';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        setError(payload.message || 'Wrong email or password.');
        setBusy(false);
        return;
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin');
      router.refresh();
    } catch {
      setError('Could not reach server. Please try again.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm animate-pageIn space-y-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <FlashXLogo variant="dark" size="md" />
        <h1 className="sr-only">Admin sign in</h1>
        <p className="text-sm text-slate-400">Sign in to manage quizzes and view responses.</p>
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field" />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-sm text-red-300">{error}</p>}
      <button disabled={busy} aria-busy={busy} className="btn-primary w-full">
        {busy ? (
          <>
            <Spinner />
            Signing in…
          </>
        ) : (
          'Sign in'
        )}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
