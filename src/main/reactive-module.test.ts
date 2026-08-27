import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { renderReactiveModuleConfig } from "./reactive-module";

describe("renderReactiveModuleConfig", () => {
  it("generates only the selected declared channel flags", () => {
    expect(
      renderReactiveModuleConfig({
        channels: [
          { id: "backlight", kind: "backlight" },
          { id: "scroll_lock", kind: "indicator" },
        ],
      }),
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
    expect(
      renderReactiveModuleConfig({
        channels: [{ id: "rgb_matrix", kind: "rgb" }],
      }),
    ).toMatchInlineSnapshot(`
      "#pragma once

      #define KEYFLARE_REACTIVE_RGB_MATRIX

      #ifdef KEYFLARE_REACTIVE_RGB_MATRIX
      #    define ENABLE_RGB_MATRIX_FRAMEBUFFER_EFFECTS
      #    define ENABLE_RGB_MATRIX_TYPING_HEATMAP
      #endif
      "
    `);
  });

  it("renders RGB indicator LED defines for rgb-indicator channels", () => {
    expect(
      renderReactiveModuleConfig({
        channels: [
          { id: "rgb_matrix", kind: "rgb" },
          { id: "caps_lock", kind: "rgb-indicator" },
          { id: "scroll_lock", kind: "rgb-indicator" },
        ],
        indicatorLeds: { scroll_lock: 3, caps_lock: 7 },
      }),
    ).toMatchInlineSnapshot(`
      "#pragma once

      #define KEYFLARE_REACTIVE_RGB_MATRIX
      #define KEYFLARE_REACTIVE_CAPS_LOCK_RGB
      #define KEYFLARE_REACTIVE_CAPS_LOCK_RGB_LED 7
      #define KEYFLARE_REACTIVE_CAPS_LOCK_RGB_COLOR_R 229
      #define KEYFLARE_REACTIVE_CAPS_LOCK_RGB_COLOR_G 72
      #define KEYFLARE_REACTIVE_CAPS_LOCK_RGB_COLOR_B 77
      #define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB
      #define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_LED 3
      #define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_COLOR_R 63
      #define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_COLOR_G 185
      #define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_COLOR_B 80

      #ifdef KEYFLARE_REACTIVE_RGB_MATRIX
      #    define ENABLE_RGB_MATRIX_FRAMEBUFFER_EFFECTS
      #    define ENABLE_RGB_MATRIX_TYPING_HEATMAP
      #endif
      "
    `);
  });

  it("defaults the indicator LED to 0 for rgb-indicator channels", () => {
    expect(
      renderReactiveModuleConfig({
        channels: [{ id: "scroll_lock", kind: "rgb-indicator" }],
      }),
    ).toContain("#define KEYFLARE_REACTIVE_SCROLL_LOCK_RGB_LED 0");
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
