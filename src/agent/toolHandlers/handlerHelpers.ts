/**
 * src/agent/toolHandlers/handlerHelpers.ts — shared plumbing used by every
 * handlers/*.ts module: arg validation against tools.ts's Zod schemas, and
 * turning an unexpected throw from data/scoring into a structured refusal
 * (src/agent/CLAUDE.md "Error handling" — every tool result reaching the
 * orchestrator is a valid payload or a structured refusal, never a raw
 * stack trace).
 */

import type { z } from "zod";
import { TOOLS, refusal, type ToolRefusal, type ToolName } from "../tools/tools.js";

function toolSchema(name: ToolName): z.ZodTypeAny {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`toolHandlers: no schema registered for "${name}"`);
  return tool.schema;
}

/** Parses `args` against the named tool's Zod schema, returning either the
 * parsed value or an `invalid_arguments` refusal — never throws. */
export function parseArgs<T>(
  name: ToolName,
  args: unknown
): { ok: true; value: T } | { ok: false; refusal: ToolRefusal } {
  const result = toolSchema(name).safeParse(args);
  if (!result.success) {
    return {
      ok: false,
      refusal: refusal(
        "invalid_arguments",
        `Arguments for "${name}" failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
        { issues: result.error.issues }
      ),
    };
  }
  return { ok: true, value: result.data as T };
}

/** Wraps a handler body so any unexpected throw from data/scoring becomes a
 * structured refusal — the message text only, never a stack trace. */
export function guarded<T>(fn: () => T | ToolRefusal): T | ToolRefusal {
  try {
    return fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return refusal("no_data", "An unexpected error occurred while computing this result.", {
      error: message,
    });
  }
}
