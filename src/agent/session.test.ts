import { describe, it, expect } from "vitest";
import { createSessionStore, MAX_HISTORY_TURNS } from "./session.js";

describe("createSessionStore", () => {
  it("returns an empty history for an unknown session", () => {
    const store = createSessionStore();
    expect(store.getHistory("nope")).toEqual([]);
  });

  it("history is per-sessionId and isolated", () => {
    const store = createSessionStore();
    store.appendTurn("a", { role: "user", content: "hi from a" });
    store.appendTurn("b", { role: "user", content: "hi from b" });

    expect(store.getHistory("a")).toEqual([{ role: "user", content: "hi from a" }]);
    expect(store.getHistory("b")).toEqual([{ role: "user", content: "hi from b" }]);
  });

  it("appendTurn preserves call order", () => {
    const store = createSessionStore();
    store.appendTurn("s", { role: "user", content: "1" });
    store.appendTurn("s", { role: "assistant", content: "2" });
    store.appendTurn("s", { role: "user", content: "3" });

    expect(store.getHistory("s").map((t) => t.content)).toEqual(["1", "2", "3"]);
  });

  it("trims to the most recent maxTurns entries", () => {
    const store = createSessionStore(3);
    for (let i = 0; i < 5; i++) {
      store.appendTurn("s", { role: "user", content: i });
    }
    expect(store.getHistory("s").map((t) => t.content)).toEqual([2, 3, 4]);
  });

  it("uses MAX_HISTORY_TURNS as the default cap", () => {
    const store = createSessionStore();
    for (let i = 0; i < MAX_HISTORY_TURNS + 5; i++) {
      store.appendTurn("s", { role: "user", content: i });
    }
    expect(store.getHistory("s")).toHaveLength(MAX_HISTORY_TURNS);
  });

  it("clear empties one session without touching another", () => {
    const store = createSessionStore();
    store.appendTurn("a", { role: "user", content: "1" });
    store.appendTurn("b", { role: "user", content: "1" });

    store.clear("a");

    expect(store.getHistory("a")).toEqual([]);
    expect(store.getHistory("b")).toHaveLength(1);
  });

  it("getHistory returns a copy — mutating it does not affect the store", () => {
    const store = createSessionStore();
    store.appendTurn("s", { role: "user", content: "1" });
    const history = store.getHistory("s");
    history.push({ role: "assistant", content: "injected" });

    expect(store.getHistory("s")).toHaveLength(1);
  });
});
