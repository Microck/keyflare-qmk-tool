import { describe, expect, it } from "vitest";

import {
  buildAndSaveInputSchema,
  inspectTargetInputSchema,
} from "./keyflare-api";

describe("Keyflare IPC inputs", () => {
  it("accepts a declared channel build request", () => {
    expect(
      buildAndSaveInputSchema.parse({
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: "default",
      }),
    ).toEqual({
      target: "test/board",
      channels: ["scroll_lock"],
      keymap: "default",
    });
  });

  it("rejects renderer-provided file paths", () => {
    expect(() =>
      buildAndSaveInputSchema.parse({
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: { kind: "file", path: "/tmp/untrusted.json" },
      }),
    ).toThrow();
  });

  it("rejects empty target names", () => {
    expect(() => inspectTargetInputSchema.parse("")).toThrow();
  });
});
