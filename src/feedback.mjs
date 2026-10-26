import fs from 'node:fs';
import path from 'node:path';
import { LOG_ROOT } from './paths.mjs';

const feedbackPath = path.join(LOG_ROOT, 'feedback.jsonl');
let cachedMtime = -1;
let cached = new Map();

export function computeFeedbackCalibration(entries, policy = {}) {
  const minimumSamples = policy.minimumSamples ?? 5;
  const boostMinimumSamples = policy.boostMinimumSamples ?? 10;
  const boostLowerBound = policy.boostLowerBound ?? 0.75;
  const penaltySuccessRate = policy.penaltySuccessRate ?? 0.4;
  const maxBoost = policy.maxBoost ?? 2;
  const maxPenalty = policy.maxPenalty ?? 3;
  const stats = new Map();
  for (const entry of entries) {
    if (entry.outcome === 'missing') continue;
    const ids = entry.affectedSkillId ? [entry.affectedSkillId] : (entry.selectedIds || []).length === 1 ? entry.selectedIds : [];
    for (const id of ids) {
      const item = stats.get(id) || {samples: 0, helpful: 0, negative: 0};
      item.samples += 1;
      if (entry.outcome === 'helpful') item.helpful += 1;
      if (entry.outcome === 'wrong' || entry.outcome === 'unnecessary') item.negative += 1;
      stats.set(id, item);
    }
  }
  const result = new Map();
  for (const [id, item] of stats) {
    const successRate = item.helpful / item.samples;
    const z = 1.645;
    const denominator = 1 + z * z / item.samples;
    const center = successRate + z * z / (2 * item.samples);
    const spread = z * Math.sqrt((successRate * (1 - successRate) + z * z / (4 * item.samples)) / item.samples);
    const lowerBound = (center - spread) / denominator;
    let adjustment = 0;
    if (item.samples >= boostMinimumSamples && lowerBound >= boostLowerBound) adjustment = lowerBound >= 0.9 ? maxBoost : 1;
    else if (item.samples >= minimumSamples && successRate <= penaltySuccessRate) adjustment = -Math.min(maxPenalty, successRate <= 0.15 ? 3 : successRate <= 0.3 ? 2 : 1);
    result.set(id, {...item, successRate, lowerBound, adjustment});
  }
  return result;
}

export function loadFeedbackCalibration(policy = {}) {
  if (!fs.existsSync(feedbackPath)) return new Map();
  const mtime = fs.statSync(feedbackPath).mtimeMs;
  if (mtime === cachedMtime) return cached;
  const entries = fs.readFileSync(feedbackPath, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  cachedMtime = mtime;
  cached = computeFeedbackCalibration(entries, policy);
  return cached;
}

export function feedbackSummary(policy = {}) {
  return [...loadFeedbackCalibration(policy).entries()].map(([id, value]) => ({id, ...value}));
}
