/**
 * src/obs/trace.ts — write-only reasoning-trace recorder (ADR 0008,
 * src/obs/CLAUDE.md). orchestrator.ts is the only writer; src/interface/
 * is the only reader (for display, e.g. a --trace flag or a /why
 * follow-up). Never a source of truth for an answer, no side effects on
 * scoring or data.
 */

export interface TraceEvent {
  tool: string;
  args: unknown;
  result: unknown;
  timestamp: string; // ISO 8601
}

export interface Trace {
  record(event: Omit<TraceEvent, "timestamp">): void;
  events(): TraceEvent[];
  clear(): void;
}

export function createTrace(): Trace {
  let log: TraceEvent[] = [];

  return {
    record(event) {
      log.push({ ...event, timestamp: new Date().toISOString() });
    },
    events() {
      // A copy, so a caller can't mutate the recorder's internal state.
      return [...log];
    },
    clear() {
      log = [];
    },
  };
}
