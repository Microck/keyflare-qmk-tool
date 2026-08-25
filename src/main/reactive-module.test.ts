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

  it("enables the typing heatmap effect for rgb_matrix builds", () => {
    expect(renderReactiveModuleConfig({ channels: ["rgb_matrix"] }))
      .toMatchInlineSnapshot(`
        "#pragma once

        #define KEYFLARE_REACTIVE_RGB_MATRIX

        #ifdef KEYFLARE_REACTIVE_RGB_MATRIX
        #    define ENABLE_RGB_MATRIX_TYPING_HEATMAP
        #endif
        "
      `);
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

  it("ends the active override when an RGB control key is pressed", async () => {
    const source = await readFile(
      new URL(
        "../../resources/qmk-module/keyflare/reactive/reactive.c",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toMatch(
      /IS_RGB_MATRIX_KEYCODE\(keycode\) \|\| IS_RGB_KEYCODE\(keycode\)[\s\S]+keyflare_apply_reactive_state\(false\);[\s\S]+return true;/u,
    );
  });
});
