/**
 * src/interface/anthropicClient.ts — the real LlmClient implementation,
 * wrapping @anthropic-ai/sdk (architecture.md "Where/how AI is used").
 * orchestrator.ts depends only on the locally-defined LlmClient interface
 * (zero SDK import there); this file is the only place in the app that
 * imports @anthropic-ai/sdk, so the loop, audit layer, and refusal paths
 * stay testable with a scripted fake and zero network.
 *
 * Prompt caching (architecture.md "Cost awareness"): systemPrompt.ts's
 * output and tools.ts's schemas are stable for the life of a session, so
 * the last system block and the last tool definition each carry
 * `cache_control: { type: "ephemeral" }`. This is strictly a
 * latency/cost optimization — it does nothing for rate limiting, which a
 * production deployment would still need its own semaphore/backoff for
 * (out of scope here, per architecture.md).
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmAssistantBlock,
  LlmMessage,
  LlmMessageContent,
} from "../agent/orchestrator.js";

// D3 (plan "Independent decisions"): model id and token cap are
// interface-layer constants — no ADR governs the specific model choice.
export const MODEL_ID = "claude-sonnet-5";
export const MAX_TOKENS = 4096;

function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: toAnthropicContent(m.content),
  }));
}

function toAnthropicContent(
  content: LlmMessageContent
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    // tool_result
    return {
      type: "tool_result",
      tool_use_id: block.tool_use_id,
      content: block.content,
    };
  }) as Anthropic.MessageParam["content"];
}

function fromAnthropicContent(
  content: Anthropic.ContentBlock[]
): LlmAssistantBlock[] {
  const blocks: LlmAssistantBlock[] = [];
  for (const block of content) {
    if (block.type === "text") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    }
    // Other block types (e.g. thinking) carry nothing the orchestrator's
    // wire types represent — dropped, not an error.
  }
  return blocks;
}

/**
 * Builds an LlmClient backed by the real Anthropic SDK. Reads
 * ANTHROPIC_API_KEY from process.env and fails fast (at construction, not
 * on the first turn) if it's absent.
 */
export function createAnthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): LlmClient {
  if (!apiKey) {
    throw new Error(
      "createAnthropicClient: ANTHROPIC_API_KEY is not set. Export it before " +
        "running the CLI, e.g. `ANTHROPIC_API_KEY=sk-... npm run cli`."
    );
  }

  const client = new Anthropic({ apiKey });

  return {
    async createMessage(request: LlmRequest): Promise<LlmResponse> {
      const tools = request.tools?.map((t, i, arr) =>
        i === arr.length - 1
          ? { ...t, cache_control: { type: "ephemeral" as const } }
          : t
      );

      const response = await client.messages.create({
        model: MODEL_ID,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: request.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: toAnthropicMessages(request.messages),
        ...(tools ? { tools: tools as unknown as Anthropic.Tool[] } : {}),
      });

      return { content: fromAnthropicContent(response.content) };
    },
  };
}
