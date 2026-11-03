'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlashXLogo } from '@/components/brand/FlashXLogo';

export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState('');
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#0F0C29] via-[#302B63] to-[#24243E] p-6 text-white">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (c) router.push(`/j/${encodeURIComponent(c)}`);
        }}
        className="w-full max-w-sm space-y-5 text-center"
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
          className="h-16 w-full rounded-2xl border-2 border-white/20 bg-white/10 text-center text-3xl font-extrabold uppercase tracking-[0.3em] placeholder:text-white/30 focus:border-cyan-300 focus:outline-none"
        />
        <button className="h-16 w-full rounded-2xl bg-violet-600 text-xl font-extrabold hover:bg-violet-500">Continue</button>
      </form>
      <Link
        href="/admin/login"
        className="mt-10 text-xs font-medium text-white/50 transition hover:text-white/90"
      >
        Host / Admin login →
      </Link>
    </main>
  );
}
