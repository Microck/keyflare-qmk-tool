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
});
