import { createHash } from "crypto";

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function normalizeForRisk(input: string): string {
  return tokenize(input).join(" ").trim();
}

export function buildSimilarityKey(input: string): string {
  return createHash("sha256").update(normalizeForRisk(input)).digest("hex").slice(0, 24);
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isTooSimilar(input: string, existing: string[], threshold = 0.86): boolean {
  for (const item of existing) {
    if (jaccardSimilarity(input, item) >= threshold) {
      return true;
    }
  }
  return false;
}
