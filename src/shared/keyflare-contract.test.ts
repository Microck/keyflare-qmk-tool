import { describe, expect, it } from "vitest";

import { normalizeQmkInfo } from "./keyflare-contract";

const janeInfo = {
  keyboard_name: "Jane v2",
  features: { backlight: true },
  backlight: { pin: "D4" },
  indicators: { caps_lock: "D1", scroll_lock: "D6" },
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

describe("normalizeQmkInfo", () => {
  it("exposes only declared channels and keyboard geometry", () => {
    expect(normalizeQmkInfo({ target: "tgr/jane/v2", info: janeInfo }))
      .toMatchInlineSnapshot(`
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
                "label": "Esc",
                "row": 0,
                "width": 1,
                "x": 0,
                "y": 0,
              },
              {
                "column": 1,
                "height": 1,
                "label": "F1",
                "row": 0,
                "width": 1,
                "x": 2,
                "y": 0,
              },
              {
                "column": 0,
                "height": 1,
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
});
