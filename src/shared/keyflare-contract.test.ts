import { describe, expect, it } from "vitest";

import { normalizeQmkInfo } from "./keyflare-contract";

const janeInfo = {
  keyboard_name: "Jane v2",
  features: { backlight: true },
  backlight: { pin: "D4" },
  indicators: { caps_lock: "D1", scroll_lock: "D6" },
  layout_aliases: { LAYOUT: "LAYOUT_tkl_ansi" },
  layouts: {
    LAYOUT_tkl_ansi: {
      layout: [
        { matrix: [0, 0], x: 0, y: 0, label: "Esc" },
        { matrix: [0, 1], x: 2, y: 0, label: "F1" },
        { matrix: [1, 0], x: 0, y: 1.5, w: 1.5, label: "Tab" },
      ],
    },
  },
};

const janeDefaultKeymap = {
  keyboard: "tgr/jane/v2",
  keymap: "default",
  layout: "LAYOUT",
  layers: [["KC_ESC", "KC_F1", "KC_CAPS"]],
};

describe("normalizeQmkInfo", () => {
  it("exposes only declared channels and keyboard geometry", () => {
    expect(
      normalizeQmkInfo({
        target: "tgr/jane/v2",
        info: janeInfo,
        keymap: janeDefaultKeymap,
      }),
    ).toMatchInlineSnapshot(`
      {
        "channels": [
          {
            "id": "backlight",
            "kind": "backlight",
            "label": "Backlight",
          },
          {
            "id": "caps_lock",
            "kind": "indicator",
            "label": "Caps Lock indicator",
          },
          {
            "id": "scroll_lock",
            "kind": "indicator",
            "label": "Scroll Lock indicator",
          },
        ],
        "keyboardName": "Jane v2",
        "layouts": [
          {
            "keys": [
              {
                "column": 0,
                "height": 1,
                "keycode": "KC_ESC",
                "label": "Esc",
                "row": 0,
                "width": 1,
                "x": 0,
                "y": 0,
              },
              {
                "column": 1,
                "height": 1,
                "keycode": "KC_F1",
                "label": "F1",
                "row": 0,
                "width": 1,
                "x": 2,
                "y": 0,
              },
              {
                "column": 0,
                "height": 1,
                "keycode": "KC_CAPS",
                "label": "Tab",
                "row": 1,
                "width": 1.5,
                "x": 0,
                "y": 1.5,
              },
            ],
            "name": "LAYOUT_tkl_ansi",
          },
        ],
        "target": "tgr/jane/v2",
      }
    `);
  });

  it("does not invent a channel when lighting metadata is absent", () => {
    expect(
      normalizeQmkInfo({
        target: "plain/board",
        info: {
          keyboard_name: "Plain board",
          layouts: janeInfo.layouts,
        },
      }).channels,
    ).toEqual([]);
  });

  it("exposes rgb_matrix only when the feature, a driver pin, and a LED map are declared", () => {
    const layouts = {
      LAYOUT: { layout: [{ matrix: [0, 0], x: 0, y: 0 }] },
    };
    expect(
      normalizeQmkInfo({
        target: "sam/sam80s",
        info: {
          keyboard_name: "SAM80-S",
          features: { rgb_matrix: true },
          rgb_matrix: {
            driver: "ws2812",
            leds: [{ x: 0, y: 0, flags: 15 }],
          },
          ws2812: { pin: "GP8" },
          layouts,
        },
      }).channels,
    ).toEqual([
      { id: "rgb_matrix", kind: "rgb", label: "RGB Matrix reactive" },
    ]);
    expect(
      normalizeQmkInfo({
        target: "sam/sam80s",
        info: {
          keyboard_name: "SAM80-S",
          features: { rgb_matrix: true },
          rgb_matrix: { driver: "ws2812", led_count: 94 },
          layouts,
        },
      }).channels,
    ).toEqual([
      { id: "rgb_matrix", kind: "rgb", label: "RGB Matrix reactive" },
    ]);
    expect(
      normalizeQmkInfo({
        target: "sam/sam80s",
        info: { features: { rgb_matrix: true }, layouts },
      }).channels,
    ).toEqual([]);
  });

  it("rejects rgb_matrix targets that define no LED map", () => {
    expect(() =>
      normalizeQmkInfo({
        target: "sam/sam80s",
        info: {
          keyboard_name: "SAM80-S",
          features: { rgb_matrix: true },
          rgb_matrix: { driver: "ws2812" },
          ws2812: { pin: "GP8" },
          layouts: {
            LAYOUT: { layout: [{ matrix: [0, 0], x: 0, y: 0 }] },
          },
        },
      }),
    ).toThrow(/defines no LED map/u);
  });

  it("adds keycodes only to the layout used by the default keymap", () => {
    const capabilities = normalizeQmkInfo({
      target: "tgr/jane/v2",
      info: {
        ...janeInfo,
        layouts: {
          ...janeInfo.layouts,
          LAYOUT_alternate: {
            layout: [{ matrix: [0, 0], x: 0, y: 0 }],
          },
        },
      },
      keymap: janeDefaultKeymap,
    });

    expect(capabilities.layouts[0]?.keys.map((key) => key.keycode)).toEqual([
      "KC_ESC",
      "KC_F1",
      "KC_CAPS",
    ]);
    expect(capabilities.layouts[1]?.keys[0]?.keycode).toBeUndefined();
  });

  it("rejects malformed matrix coordinates at the metadata seam", () => {
    expect(() =>
      normalizeQmkInfo({
        target: "broken/board",
        info: {
          keyboard_name: "Broken board",
          layouts: {
            LAYOUT: { layout: [{ matrix: [0], x: 0, y: 0 }] },
          },
        },
      }),
    ).toThrow("Invalid QMK keyboard metadata");
  });

  it("reports malformed default keymaps as a Keyflare error", () => {
    expect(() =>
      normalizeQmkInfo({
        target: "broken/board",
        info: janeInfo,
        keymap: { layout: "LAYOUT" },
      }),
    ).toThrow("Invalid QMK keymap");
  });
});
