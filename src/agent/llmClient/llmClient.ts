/**
 * src/agent/llmClient/llmClient.ts — a minimal subset of Anthropic's
 * Messages API shape, defined locally so the agent loop
 * (src/agent/orchestrator/orchestrator.ts) has zero SDK dependency.
 *
 * The loop depends only on this narrow, locally-defined LlmClient interface
 * rather than importing @anthropic-ai/sdk directly, so the entire loop —
 * tool rounds, the audit layer, refusal paths — is testable with a scripted
 * fake and zero network. A thin adapter wrapping the real SDK is wired by
 * src/interface/anthropicClient.ts, not built here.
 */

import { anthropicTools } from "../tools/tools.js";

export interface LlmTextBlock {
  type: "text";
  text: string;
}

export interface LlmToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export type LlmAssistantBlock = LlmTextBlock | LlmToolUseBlock;

export interface LlmToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type LlmMessageContent = string | LlmAssistantBlock[] | LlmToolResultBlock[];

export interface LlmMessage {
  role: "user" | "assistant";
  content: LlmMessageContent;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ReturnType<typeof anthropicTools>;
}

export interface LlmResponse {
  content: LlmAssistantBlock[];
}

export interface LlmClient {
  createMessage(request: LlmRequest): Promise<LlmResponse>;
}

export function hasToolUse(response: LlmResponse): boolean {
  return response.content.some((b) => b.type === "tool_use");
}

export function extractText(response: LlmResponse): string {
  return response.content
    .filter((b): b is LlmTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
