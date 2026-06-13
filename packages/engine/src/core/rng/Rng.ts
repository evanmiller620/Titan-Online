/**
 * Random number seam (Titan engine, module: core/rng).
 *
 * The engine NEVER calls Math.random directly. Every command that needs
 * randomness receives an Rng. This is what makes the engine deterministic
 * and replayable, and what makes server-authoritative dice possible:
 *
 *  - Production (Supabase Edge Function): an Rng seeded from a
 *    crypto-strength source per command; the resulting rolls are recorded
 *    in domain events, which ARE the audit trail.
 *  - Tests: seededRng for reproducibility, scriptedRng to force exact rolls.
 *  - Client optimistic layer: never executes dice commands at all — dice
 *    results only ever arrive from the server. fromMathRandom exists for
 *    local hot-seat / AI experiments and is loudly non-authoritative.
 */

export interface Rng {
  /** One six-sided die: integer in [1, 6]. */
  d6(): number;
  /** Roll n six-sided dice. */
  roll(n: number): number[];
}

function buildRng(next01: () => number): Rng {
  const d6 = () => 1 + Math.floor(next01() * 6);
  return {
    d6,
    roll(n: number): number[] {
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Cannot roll ${n} dice`);
      }
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(d6());
      return out;
    },
  };
}

/**
 * Deterministic PRNG (mulberry32). Identical seed → identical sequence on
 * every platform. NOT cryptographically secure — the SERVER must derive
 * seeds from a crypto source; determinism here is for replay and tests.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return buildRng(() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

/**
 * Test helper: returns exactly the queued die faces, in order, and throws
 * if the queue is exhausted or a value is not a legal face. Lets tests
 * force ties, sixes, time-loss scenarios, etc.
 */
export function scriptedRng(faces: readonly number[]): Rng {
  const queue = faces.slice();
  const d6 = (): number => {
    const v = queue.shift();
    if (v === undefined) {
      throw new Error("scriptedRng exhausted: a command rolled more dice than scripted");
    }
    if (!Number.isInteger(v) || v < 1 || v > 6) {
      throw new Error(`scriptedRng: ${v} is not a d6 face`);
    }
    return v;
  };
  return {
    d6,
    roll(n: number): number[] {
      const out: number[] = [];
      for (let i = 0; i < n; i++) out.push(d6());
      return out;
    },
  };
}

/**
 * Non-authoritative convenience Rng. NEVER use for multiplayer game logic —
 * the server is the only legal dice tower. Suitable for local solo play.
 */
export function fromMathRandom(): Rng {
  return buildRng(Math.random);
}
