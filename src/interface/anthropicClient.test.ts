import { describe, it, expect, vi, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient } from "./anthropicClient.js";
import { LlmClientError } from "../agent/llmClient/llmClient.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockCreateToThrow(err: unknown) {
  vi.spyOn(Anthropic.Messages.prototype, "create").mockRejectedValue(err);
}

describe("createAnthropicClient", () => {
  it("classifies a 429 as a transient LlmClientError", async () => {
    mockCreateToThrow(
      new Anthropic.APIError(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } }, "rate limited", new Headers())
    );
    const client = createAnthropicClient("fake-key");

    await expect(client.createMessage({ system: "sys", messages: [] })).rejects.toMatchObject({
      name: "LlmClientError",
      transient: true,
      status: 429,
    });
  });

  it("classifies a 401 as a fatal LlmClientError including status and message", async () => {
    mockCreateToThrow(
      new Anthropic.APIError(401, { type: "error", error: { type: "authentication_error", message: "invalid api key" } }, "invalid api key", new Headers())
    );
    const client = createAnthropicClient("fake-key");

    let caught: unknown;
    try {
      await client.createMessage({ system: "sys", messages: [] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(LlmClientError);
    const err = caught as LlmClientError;
    expect(err.transient).toBe(false);
    expect(err.status).toBe(401);
    expect(err.message).toContain("401");
    expect(err.message).toContain("invalid api key");
  });

  it("rethrows a non-APIError unchanged", async () => {
    const networkError = new Error("ECONNRESET");
    mockCreateToThrow(networkError);
    const client = createAnthropicClient("fake-key");

    await expect(client.createMessage({ system: "sys", messages: [] })).rejects.toBe(networkError);
  });
});
