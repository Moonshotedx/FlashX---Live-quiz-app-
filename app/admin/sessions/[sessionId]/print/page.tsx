import { notFound, redirect } from 'next/navigation';
import { getAdmin } from '@/lib/server/auth';
import { loadOwnedSession, syncSession } from '@/lib/server/session';
import { buildResults, eventDate } from '@/lib/server/results';
import { resolveTheme } from '@/lib/theme';
import { formatDuration } from '@/lib/client-api';
import { PrintToolbar } from '@/components/admin/PrintToolbar';
import { FlashXMark } from '@/components/brand/FlashXLogo';

export const dynamic = 'force-dynamic';

const PODIUM_BADGE: Record<number, { label: string; ring: string; bg: string; medal: string }> = {
  1: { label: '1st Place', ring: 'border-amber-400', bg: 'bg-amber-50', medal: '🥇' },
  2: { label: '2nd Place', ring: 'border-slate-400', bg: 'bg-slate-50', medal: '🥈' },
  3: { label: '3rd Place', ring: 'border-orange-400', bg: 'bg-orange-50', medal: '🥉' },
};

export default async function PrintResultsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const admin = await getAdmin();
  if (!admin) redirect('/admin/login');

  let session = await loadOwnedSession(sessionId, admin.id).catch(() => null);
  if (!session) notFound();
  session = await syncSession(session);

  const results = await buildResults(session);
  const theme = resolveTheme(session.quizzes.theme);
  const eventTitle = theme.eventTitle || session.quizzes.title;
  const dateStr = eventDate(session.started_at ?? session.created_at);
  const maxScore = results.snapshot.questions.reduce((acc, q) => acc + q.points, 0);
  const showRoll = results.rows.some((r) => !!(r.rollNumber && r.rollNumber.trim()));
  const top3 = results.rows.slice(0, 3);

  return (
    <div>
      <PrintToolbar sessionId={sessionId} />

      <article className="mx-auto max-w-[210mm] rounded-xl bg-white p-8 text-slate-900 shadow-2xl print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {/* Header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Official Leaderboard Results</p>
            <h1 className="mt-1 text-3xl font-extrabold text-slate-900">{eventTitle}</h1>
            {theme.eventTitle && theme.eventTitle !== session.quizzes.title && (
              <p className="mt-0.5 text-sm font-medium text-slate-600">{session.quizzes.title}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-600">
            {theme.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.logoUrl} alt="" className="ml-auto mb-2 max-h-12 max-w-[140px] object-contain" />
            )}
            <div className="font-semibold text-slate-900">Date: {dateStr}</div>
            <div>
              Join code: <span className="font-mono font-bold">{session.join_code}</span>
            </div>
          </div>
        </header>

        {/* Summary strip */}
        <section className="mt-5 grid grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Submitted</div>
            <div className="text-xl font-extrabold text-slate-900">{results.summary.total}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Questions</div>
            <div className="text-xl font-extrabold text-slate-900">
              {results.totalQuestions} ({maxScore} pts)
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Average Score</div>
            <div className="text-xl font-extrabold text-slate-900">{results.summary.averageScore}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Highest Score</div>
            <div className="text-xl font-extrabold text-slate-900">{results.summary.highestScore}</div>
          </div>
        </section>

        {/* Top 3 highlighted */}
        {top3.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-600">Top Performers</h2>
            <div className="grid grid-cols-3 gap-3">
              {top3.map((r) => {
                const style = PODIUM_BADGE[r.rank] ?? PODIUM_BADGE[3];
                return (
                  <div key={r.participantId} className={`break-inside-avoid rounded-xl border-2 p-4 ${style.ring} ${style.bg}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">{style.label}</span>
                      <span className="text-2xl" aria-hidden>
                        {style.medal}
                      </span>
                    </div>
                    <div className="mt-2 truncate text-lg font-extrabold text-slate-900">{r.name}</div>
                    {r.team && <div className="truncate text-xs font-semibold text-slate-600">{r.team}</div>}
                    {showRoll && r.rollNumber && <div className="truncate font-mono text-xs text-slate-600">{r.rollNumber}</div>}
                    <div className="mt-2 flex items-baseline justify-between border-t border-slate-200/80 pt-2 text-sm">
                      <span className="font-extrabold text-slate-900">
                        {r.score} pts <span className="font-normal text-slate-500">({r.correctCount}/{results.totalQuestions})</span>
                      </span>
                      <span className="font-mono text-xs text-slate-600">{formatDuration(r.timeTakenMs, true)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Full ranked list */}
        <section className="mt-7">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-600">Full Ranked Standings</h2>
          {results.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No submitted attempts recorded yet.</p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b-2 border-slate-900 text-[11px] uppercase tracking-wider text-slate-600">
                  <th className="py-2 pr-3">Rank</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Team</th>
                  {showRoll && <th className="py-2 pr-3">Roll No.</th>}
                  <th className="py-2 pr-3 text-right">Score</th>
                  <th className="py-2 pr-3 text-right">Correct</th>
                  <th className="py-2 pl-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {results.rows.map((r) => (
                  <tr key={r.participantId} className={`break-inside-avoid ${r.rank <= 3 ? 'bg-amber-50/40 font-semibold' : ''}`}>
                    <td className="py-2 pr-3 font-mono font-bold text-slate-900">#{r.rank}</td>
                    <td className="py-2 pr-3 text-slate-900">{r.name}</td>
                    <td className="py-2 pr-3 text-slate-700">{r.team ?? '–'}</td>
                    {showRoll && <td className="py-2 pr-3 font-mono text-slate-700">{r.rollNumber ?? '–'}</td>}
                    <td className="py-2 pr-3 text-right font-mono font-bold text-slate-900">{r.score}</td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-700">
                      {r.correctCount}/{results.totalQuestions}
                    </td>
                    <td className="py-2 pl-3 text-right font-mono text-slate-700">{formatDuration(r.timeTakenMs, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-8 flex items-center justify-center gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
          <FlashXMark variant="light" size={16} />
          <span>Generated by FlashX by Xcelerator</span>
        </footer>
      </article>
    </div>
  );
}
