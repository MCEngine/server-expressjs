/**
 * Cosine similarity between two vectors of the same length, in [-1, 1].
 *
 * Zero when either is all zeros or the lengths differ: two embeddings of
 * different sizes came from different models, and comparing them would rank
 * noise.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Reads a stored embedding, or an empty vector when the text is not one. */
export function parseVector(text: string): number[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every((n) => typeof n === 'number') ? value : [];
  } catch {
    return [];
  }
}

/** Keeps the `limit` highest-scoring items, best first. */
export function topK<T>(items: Iterable<T>, score: (item: T) => number, limit: number): { item: T; score: number }[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) scored.push({ item, score: score(item) });
  return scored.sort((x, y) => y.score - x.score).slice(0, limit);
}
