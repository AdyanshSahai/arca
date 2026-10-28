// Dev-only profiling support. Everything here is inert unless the app was
// started with VITE_ARCA_PROFILE=1 (see the README's "Profiling" section):
//
// - useRenderCount(name): counts renders of a component.
// - onRenderCommit: a <Profiler> callback summing React commit time.
// - bump(name): counts arbitrary events (e.g. graph data recomputes).
// - perfLog(obj): writes a JSON line to the Rust process's stderr.

import { invoke } from "@tauri-apps/api/core";

export const PROFILING = import.meta.env.VITE_ARCA_PROFILE === "1";

const counters = new Map<string, number>();
/** Total React commit time (ms) and number of commits since the last reset. */
const commits = { count: 0, ms: 0 };

/** Counts one render of `name` (call at the top of a component). */
export function useRenderCount(name: string): void {
  if (PROFILING) counters.set(`render:${name}`, (counters.get(`render:${name}`) ?? 0) + 1);
}

/**
 * Runs `fn` and, when profiling, adds its duration to the `time:<name>`
 * counter (in microseconds, so the integer counters stay precise).
 */
export function timeIt<T>(name: string, fn: () => T): T {
  if (!PROFILING) return fn();
  const t0 = performance.now();
  const out = fn();
  const key = `time:${name}`;
  counters.set(key, (counters.get(key) ?? 0) + Math.round((performance.now() - t0) * 1000));
  return out;
}

/** Counts one occurrence of an arbitrary event. */
export function bump(name: string): void {
  if (PROFILING) counters.set(name, (counters.get(name) ?? 0) + 1);
}

/** <Profiler onRender> callback: accumulates actual render time per commit. */
export function onRenderCommit(_id: string, _phase: string, actualDuration: number): void {
  commits.count += 1;
  commits.ms += actualDuration;
}

export function resetPerf(): void {
  counters.clear();
  commits.count = 0;
  commits.ms = 0;
}

export function snapshotPerf(): { counters: Record<string, number>; commits: { count: number; ms: number } } {
  return { counters: Object.fromEntries([...counters].sort()), commits: { ...commits } };
}

export function perfLog(obj: unknown): Promise<void> {
  return invoke("perf_log", { line: JSON.stringify(obj) });
}
