'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FlashXLogo } from '@/components/brand/FlashXLogo';
import { Spinner } from '@/components/ui/Spinner';

export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [isPending, startTransition] = useTransition();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#0F0C29] via-[#302B63] to-[#24243E] p-6 text-white">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (c) {
            const target = `/j/${encodeURIComponent(c)}`;
            router.prefetch(target);
            startTransition(() => router.push(target));
          }
        }}
        className="w-full max-w-sm animate-pageIn space-y-5 text-center"
      >
        <div className="flex justify-center pb-2">
          <FlashXLogo variant="dark" size="lg" />
        </div>
        <h1 className="text-3xl font-extrabold">Join the quiz</h1>
        <p className="opacity-80">Scan the QR code on the screen, or type the join code.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABC123"
          aria-label="Join code"
          className="h-16 w-full rounded-2xl border-2 border-white/20 bg-white/10 text-center text-3xl font-extrabold uppercase tracking-[0.3em] transition-colors duration-150 placeholder:text-white/30 focus:border-cyan-300 focus:outline-none"
        />
        <button
          disabled={isPending || !code.trim()}
          aria-busy={isPending}
          className="inline-flex h-16 w-full select-none items-center justify-center gap-2.5 rounded-2xl bg-violet-600 text-xl font-extrabold shadow-lg shadow-violet-950/50 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] enabled:hover:-translate-y-0.5 enabled:hover:bg-violet-500 enabled:hover:shadow-xl enabled:hover:shadow-violet-500/30 enabled:active:translate-y-0 enabled:active:scale-[0.97] enabled:active:duration-75 disabled:cursor-not-allowed disabled:opacity-50 aria-[busy=true]:opacity-90"
        >
          {isPending ? (
            <>
              <Spinner className="h-5 w-5" />
              Joining…
            </>
          ) : (
            'Continue'
          )}
        </button>
      </form>
      <Link
        href="/admin/login"
        className="mt-10 text-xs font-medium text-white/50 transition-all duration-150 hover:text-white/90 active:scale-[0.97]"
      >
        Host / Admin login →
      </Link>
    </main>
  );
}
