/**
 * Lightweight text similarity for duplicate-content detection.
 * Character-trigram Jaccard: language-agnostic (works equally on Hinglish),
 * robust to small wording changes, zero dependencies.
 *
 * ~0.0 = completely different, 1.0 = identical.
 * In practice: reworded same idea lands ~0.4-0.7; unrelated topics < 0.2.
 */

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // strip punctuation/emoji, keep letters+digits (any script)
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text) {
  const t = normalize(text);
  const grams = new Set();
  for (let i = 0; i <= t.length - 3; i++) grams.add(t.slice(i, i + 3));
  return grams;
}

function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Compare one text against a list; returns the closest match.
 * @returns {{ max: number, match: string|null }}
 */
function closestMatch(text, previousTexts) {
  let max = 0, match = null;
  for (const prev of previousTexts) {
    const s = similarity(text, prev);
    if (s > max) { max = s; match = prev; }
  }
  return { max, match };
}

module.exports = { similarity, closestMatch };
