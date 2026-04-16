const DOMAIN_SIGNAL_TOKENS: Array<{ token: string; weight: number }> = [
  { token: 'recovery', weight: 5 },
  { token: 'sleep', weight: 5 },
  { token: 'hrv', weight: 5 },
  { token: 'circadian', weight: 4 },
  { token: 'melatonin', weight: 4 },
  { token: 'training', weight: 4 },
  { token: 'exercise', weight: 4 },
  { token: 'fitness', weight: 4 },
  { token: 'strength', weight: 3 },
  { token: 'endurance', weight: 3 },
  { token: 'zone 2', weight: 3 },
  { token: 'vo2', weight: 3 },
  { token: 'lactate', weight: 3 },
  { token: 'heart rate', weight: 4 },
  { token: 'spo2', weight: 4 },
  { token: 'glucose', weight: 3 },
  { token: 'protein', weight: 3 },
  { token: 'creatine', weight: 4 },
  { token: 'magnesium', weight: 4 },
  { token: 'hydration', weight: 3 },
  { token: 'supplement', weight: 3 },
  { token: 'ring', weight: 2 },
  { token: 'smart ring', weight: 5 },
  { token: 'wearable', weight: 4 },
  { token: 'oura', weight: 3 },
  { token: 'whoop', weight: 3 },
  { token: 'garmin', weight: 3 },
  { token: 'biohack', weight: 3 },
  { token: 'longevity', weight: 3 },
  { token: 'sauna', weight: 4 },
  { token: 'cold plunge', weight: 4 },
  { token: 'breathwork', weight: 4 },
  { token: 'stress', weight: 3 },
  { token: 'injury', weight: 3 },
  { token: 'rehab', weight: 4 },
  { token: 'mobility', weight: 4 },
  { token: 'compression', weight: 3 },
  { token: 'performance', weight: 2 },
  { token: 'athlete', weight: 2 },
];

const DOMAIN_BLOCKLIST_TOKENS: Array<{ token: string; penalty: number }> = [
  { token: 'amber alert', penalty: 100 },
  { token: 'silver alert', penalty: 100 },
  { token: 'missing person', penalty: 100 },
  { token: 'celebrity', penalty: 100 },
  { token: 'kardashian', penalty: 100 },
  { token: 'swift', penalty: 100 },
  { token: 'beyonce', penalty: 100 },
  { token: 'drake', penalty: 100 },
  { token: 'election', penalty: 100 },
  { token: 'president', penalty: 100 },
  { token: 'congress', penalty: 100 },
  { token: 'stock market', penalty: 100 },
  { token: 'crypto', penalty: 100 },
  { token: 'bitcoin', penalty: 100 },
  { token: 'nft', penalty: 100 },
  { token: 'ethereum', penalty: 100 },
  { token: 'super bowl', penalty: 100 },
  { token: 'game 7', penalty: 100 },
  { token: 'traded to', penalty: 100 },
];

const OFF_TOPIC_NEWS_HINTS = ['arrested', 'dead', 'shooting', 'earthquake', 'war', 'tariffs', 'movie', 'album'];
const SOURCE_BONUS: Record<string, number> = {
  reddit: 1,
  gtrends: 0,
};

export function assessTrendRelevance(term: string, source?: string) {
  const lower = term.toLowerCase();
  let score = SOURCE_BONUS[source ?? ''] ?? 0;
  const matches: string[] = [];
  const blockedBy: string[] = [];

  for (const { token, penalty } of DOMAIN_BLOCKLIST_TOKENS) {
    if (lower.includes(token)) {
      score -= penalty;
      blockedBy.push(token);
    }
  }

  for (const hint of OFF_TOPIC_NEWS_HINTS) {
    if (lower.includes(hint)) {
      score -= 5;
      blockedBy.push(hint);
    }
  }

  for (const { token, weight } of DOMAIN_SIGNAL_TOKENS) {
    if (lower.includes(token)) {
      score += weight;
      matches.push(token);
    }
  }

  const tokenCount = lower.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 6) score -= Math.min(4, tokenCount - 6);
  if (/\d{4}/.test(lower)) score -= 2;

  return {
    relevant: blockedBy.length === 0 && score >= 4 && matches.length > 0,
    score,
    matches,
    blockedBy,
  };
}
