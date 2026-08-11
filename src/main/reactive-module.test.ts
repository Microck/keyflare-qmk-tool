import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { renderReactiveModuleConfig } from "./reactive-module";

describe("renderReactiveModuleConfig", () => {
  it("generates only the selected declared channel flags", () => {
    expect(
      renderReactiveModuleConfig({ channels: ["backlight", "scroll_lock"] }),
    ).toMatchInlineSnapshot(`
      "#pragma once

      #define KEYFLARE_REACTIVE_BACKLIGHT
      #define KEYFLARE_REACTIVE_SCROLL_LOCK
      "
    `);
  });

  it("requires at least one channel", () => {
    expect(() => renderReactiveModuleConfig({ channels: [] })).toThrow(
      "Select at least one declared channel",
    );
  });

  it("does not define the indicator helper in backlight-only builds", async () => {
    const source = await readFile(
      new URL(
        "../../resources/qmk-module/keyflare/reactive/reactive.c",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toMatch(
      /#if defined\(KEYFLARE_REACTIVE_NUM_LOCK\)[\s\S]+static void keyflare_write_indicator[\s\S]+#endif/u,
    );
  });
});
