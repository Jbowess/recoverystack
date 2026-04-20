import type { RecoveryStackScorecard } from '@/lib/recoverystack-score';

function scoreToneClass(score: number) {
  if (score >= 82) return 'is-strong';
  if (score >= 70) return 'is-good';
  return 'is-caution';
}

export default function RecoveryStackScorecard({ scorecard }: { scorecard: RecoveryStackScorecard }) {
  return (
    <section className="rs-scorecard rs-card" aria-labelledby="scorecard-heading">
      <div className="rs-scorecard-top">
        <div>
          <p className="rs-scorecard-label">RecoveryStack Score</p>
          <h2 id="scorecard-heading">{scorecard.label}</h2>
          <p className="rs-scorecard-summary">{scorecard.summary}</p>
        </div>

        <div className={`rs-score-orb ${scoreToneClass(scorecard.overall)}`} aria-label={`RecoveryStack score ${scorecard.overall} out of 100`}>
          <strong>{scorecard.overall}</strong>
          <span>/100</span>
        </div>
      </div>

      <div className="rs-score-grid">
        {scorecard.dimensions.map((dimension) => (
          <article className="rs-score-metric" key={dimension.id}>
            <div className="rs-score-metric-head">
              <span>{dimension.label}</span>
              <strong>{dimension.score}</strong>
            </div>
            <div className="rs-score-meter" aria-hidden="true">
              <span style={{ width: `${dimension.score}%` }} />
            </div>
            <p>{dimension.rationale}</p>
          </article>
        ))}
      </div>

      <div className="rs-score-verdict">
        <article>
          <h3>Best for</h3>
          <p>{scorecard.verdict.bestFor}</p>
        </article>
        <article>
          <h3>Avoid if</h3>
          <p>{scorecard.verdict.avoidIf}</p>
        </article>
        <article>
          <h3>Bottom line</h3>
          <p>{scorecard.verdict.bottomLine}</p>
        </article>
      </div>
    </section>
  );
}
