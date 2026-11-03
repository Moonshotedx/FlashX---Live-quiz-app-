import { seededShuffle } from './rng';
import type { PublicQuestion, Snapshot } from './types';

/**
 * The ONLY place where questions are converted for participants.
 * It builds objects from an explicit allow list, so correctness data can never leak by accident.
 * Shuffling is per participant and stable across rejoin (seeded with the participant id).
 */
export function toPublicQuestions(
  snapshot: Snapshot,
  opts: { shuffleQuestions: boolean; shuffleOptions: boolean; participantId: string },
): PublicQuestion[] {
  const ordered = [...snapshot.questions].sort((a, b) => a.position - b.position);
  const qs = opts.shuffleQuestions ? seededShuffle(ordered, `q:${opts.participantId}`) : ordered;
  return qs.map((q) => {
    const options = [...q.options].sort((a, b) => a.position - b.position);
    const shown = opts.shuffleOptions ? seededShuffle(options, `o:${opts.participantId}:${q.id}`) : options;
    return {
      id: q.id,
      text: q.text,
      imageUrl: q.image_url,
      points: q.points,
      options: shown.map((o) => ({ id: o.id, text: o.text })),
    };
  });
}

