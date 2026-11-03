'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

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
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
      setBusy(false);
      return;
    }
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/admin');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="panel w-full max-w-sm space-y-4">
      <div className="text-center">
        <div className="text-4xl">🎯</div>
        <h1 className="mt-2 text-2xl font-bold text-white">Live Quiz Admin</h1>
        <p className="text-sm text-slate-400">Sign in to manage quizzes and run live sessions.</p>
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
      <button disabled={busy} className="btn-primary w-full">{busy ? 'Signing in…' : 'Sign in'}</button>
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

