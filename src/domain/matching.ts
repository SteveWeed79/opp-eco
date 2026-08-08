/**
 * Match scoring.
 *
 * The score sorts opportunities; it never filters a student out of an
 * employer's view. Every score is stored with the factors that produced it and
 * the algorithm version, so "why 94%?" has an answer and an auditor can
 * reconstruct any historical score.
 */

import type { MatchFactor, MatchScore, Posting, Student } from "./types";
import { postingTotalHours } from "./types";

export const ALGORITHM_VERSION = "match-v1";

interface Weights {
  requiredSkills: number;
  preferredSkills: number;
  availability: number;
  locality: number;
}

const WEIGHTS: Weights = {
  requiredSkills: 0.55,
  preferredSkills: 0.15,
  availability: 0.2,
  locality: 0.1,
};

function overlap(a: string[], b: string[]): number {
  if (a.length === 0) return 1;
  const lower = new Set(b.map((s) => s.toLowerCase()));
  const hits = a.filter((s) => lower.has(s.toLowerCase())).length;
  return hits / a.length;
}

/**
 * Whether the student's weekly availability covers what the posting asks for.
 * Micro-internships are self-scheduled against a deadline rather than a weekly
 * commitment, so they're scored on total hours fitting inside the window.
 */
function availabilityFit(student: Student, posting: Posting): number {
  if (posting.track === "micro") {
    const weeks = Math.max(1, (posting.dueWithinDays ?? 14) / 7);
    const impliedWeekly = postingTotalHours(posting) / weeks;
    if (student.availableHoursPerWeek <= 0) return 0;
    return Math.min(1, student.availableHoursPerWeek / impliedWeekly);
  }
  const needed = posting.hoursPerWeek ?? 0;
  if (needed <= 0) return 1;
  return Math.min(1, student.availableHoursPerWeek / needed);
}

export function scoreMatch(
  student: Student,
  posting: Posting,
  studentCounty: string,
): MatchScore {
  const required = overlap(posting.skillsRequired, student.skills);
  const preferred = overlap(posting.skillsPreferred, student.skills);
  const availability = availabilityFit(student, posting);
  const locality = posting.county === studentCounty ? 1 : 0.5;

  const factors: MatchFactor[] = [
    {
      label: "Required skills",
      weight: WEIGHTS.requiredSkills,
      contribution: required * WEIGHTS.requiredSkills,
    },
    {
      label: "Preferred skills",
      weight: WEIGHTS.preferredSkills,
      contribution: preferred * WEIGHTS.preferredSkills,
    },
    {
      label: "Availability",
      weight: WEIGHTS.availability,
      contribution: availability * WEIGHTS.availability,
    },
    {
      label: "Locality",
      weight: WEIGHTS.locality,
      contribution: locality * WEIGHTS.locality,
    },
  ];

  const total = factors.reduce((sum, f) => sum + f.contribution, 0);

  return {
    score: Math.round(total * 100),
    algorithmVersion: ALGORITHM_VERSION,
    factors,
  };
}

/** Human-readable explanation of a stored score, for the "why 94%?" question. */
export function explainScore(score: MatchScore): string[] {
  return score.factors
    .slice()
    .sort((a, b) => b.contribution - a.contribution)
    .map(
      (f) =>
        `${f.label}: ${Math.round((f.contribution / f.weight) * 100)}% fit, contributing ${Math.round(f.contribution * 100)} of ${Math.round(f.weight * 100)} points`,
    );
}
