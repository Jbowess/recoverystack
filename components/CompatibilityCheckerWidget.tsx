'use client';

import { useMemo, useState } from 'react';
import { NEWSLETTER_URL } from '@/lib/brand';

type Props = {
  pageSlug: string;
  pageTemplate: string;
};

type RecoveryPriority = 'sleep' | 'stress' | 'performance';
type BudgetBand = 'low' | 'medium' | 'high';
type WearableUsage = 'none' | 'basic' | 'daily';

type CompatibilityAnswers = {
  priority: RecoveryPriority;
  budget: BudgetBand;
  wearableUsage: WearableUsage;
};

type CompatibilityResult = {
  score: number;
  recommendation: string;
};

const defaultAnswers: CompatibilityAnswers = {
  priority: 'sleep',
  budget: 'medium',
  wearableUsage: 'basic',
};

function calculateCompatibility(answers: CompatibilityAnswers): CompatibilityResult {
  let score = 35;

  if (answers.priority === 'sleep') score += 25;
  if (answers.priority === 'stress') score += 20;
  if (answers.priority === 'performance') score += 18;

  if (answers.budget === 'high') score += 20;
  if (answers.budget === 'medium') score += 12;
  if (answers.budget === 'low') score += 6;

  if (answers.wearableUsage === 'daily') score += 20;
  if (answers.wearableUsage === 'basic') score += 12;
  if (answers.wearableUsage === 'none') score += 4;

  const clamped = Math.max(0, Math.min(100, score));

  if (clamped >= 80) {
    return {
      score: clamped,
      recommendation: 'Strong fit. Use RecoveryStack News to compare tools and decide when to move on a full stack.',
    };
  }

  if (clamped >= 60) {
    return {
      score: clamped,
      recommendation: 'Good fit. Follow RecoveryStack News for practical guidance before committing to more gear.',
    };
  }

  return {
    score: clamped,
    recommendation: 'Early fit. Start with the newsletter and build your recovery stack with better context.',
  };
}

function buildHref(pageSlug: string, pageTemplate: string) {
  const url = new URL(NEWSLETTER_URL);
  url.searchParams.set('utm_source', 'compatibility_checker');
  url.searchParams.set('utm_medium', 'organic-site');
  url.searchParams.set('utm_campaign', 'recoverystack-seo');
  url.searchParams.set('utm_content', `${pageTemplate}:${pageSlug}`);
  return url.toString();
}

export default function CompatibilityCheckerWidget({ pageSlug, pageTemplate }: Props) {
  const [answers, setAnswers] = useState<CompatibilityAnswers>(defaultAnswers);
  const result = useMemo(() => calculateCompatibility(answers), [answers]);
  const href = buildHref(pageSlug, pageTemplate);

  return (
    <aside>
      <h2>Compatibility checker</h2>
      <p>Answer three quick questions to see how strongly this category fits your current routine.</p>

      <label>
        What is your top priority?
        <select
          className="rs-select"
          value={answers.priority}
          onChange={(e) => setAnswers((prev) => ({ ...prev, priority: e.target.value as RecoveryPriority }))}
        >
          <option value="sleep">Better sleep</option>
          <option value="stress">Lower stress</option>
          <option value="performance">Training performance</option>
        </select>
      </label>

      <label>
        Monthly budget for recovery tools?
        <select
          className="rs-select"
          value={answers.budget}
          onChange={(e) => setAnswers((prev) => ({ ...prev, budget: e.target.value as BudgetBand }))}
        >
          <option value="low">Under $50</option>
          <option value="medium">$50 - $150</option>
          <option value="high">$150+</option>
        </select>
      </label>

      <label>
        How often do you use wearables today?
        <select
          className="rs-select"
          value={answers.wearableUsage}
          onChange={(e) => setAnswers((prev) => ({ ...prev, wearableUsage: e.target.value as WearableUsage }))}
        >
          <option value="none">Never</option>
          <option value="basic">A few times a week</option>
          <option value="daily">Daily</option>
        </select>
      </label>

      <p>
        <strong>Compatibility score: {result.score}/100</strong>
      </p>
      <p>{result.recommendation}</p>
      <a className="rs-btn-primary rs-btn-link" href={href} target="_blank" rel="noopener noreferrer">
        Continue to RecoveryStack News
      </a>
    </aside>
  );
}
