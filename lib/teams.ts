import TEAMS_DATA from './teams.json';

export const HARDCODED_TEAMS: string[] = TEAMS_DATA;

/**
 * Returns the effective team list for joining.
 * If the admin configured specific teams in the quiz settings, those appear first,
 * followed by the full 191 team directory (deduplicated).
 */
export function resolveTeamList(customTeams?: string[] | null): string[] {
  if (!customTeams || customTeams.length === 0) {
    return HARDCODED_TEAMS;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of customTeams) {
    const trimmed = t.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  for (const t of HARDCODED_TEAMS) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

