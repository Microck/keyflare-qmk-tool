import { describe, expect, it } from "vitest";

import {
  buildAndSaveInputSchema,
  inspectTargetInputSchema,
  keyboardSourceSelectionSchema,
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

  it("accepts a Vial keymap build request", () => {
    expect(
      buildAndSaveInputSchema.parse({
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: "vial",
      }),
    ).toEqual({
      target: "test/board",
      channels: ["scroll_lock"],
      keymap: "vial",
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

  it("keeps imported keyboard paths out of the renderer contract", () => {
    expect(
      keyboardSourceSelectionSchema.parse({
        name: "my-keyboard",
        targets: ["keyflare_imported/my-keyboard"],
      }),
    ).toEqual({
      name: "my-keyboard",
      targets: ["keyflare_imported/my-keyboard"],
    });
    expect(() =>
      keyboardSourceSelectionSchema.parse({
        name: "my-keyboard",
        path: "C:\\Users\\me\\keyboard",
        targets: ["keyflare_imported/my-keyboard"],
      }),
    ).toThrow();
  });
});
