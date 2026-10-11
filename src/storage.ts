/**
 * Best-score persistence that survives the sandbox. Inside the arcade iframe
 * localStorage throws (opaque origin), so every access is guarded and the game
 * silently falls back to an in-memory value for the session.
 */
const KEY = 'tongue-rush:best';
let memoryBest = 0;

export function loadBest(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(value) && value > memoryBest) memoryBest = value;
  } catch {
    /* storage unavailable: keep memory value */
  }
  return memoryBest;
}

export function saveBest(score: number): number {
  if (score > memoryBest) memoryBest = score;
  try {
    window.localStorage.setItem(KEY, String(memoryBest));
  } catch {
    /* storage unavailable: memory only */
  }
  return memoryBest;
}
