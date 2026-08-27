import { z } from "zod";

import {
  channelIds,
  channelIdSchema,
  type DeclaredChannel,
} from "../shared/keyflare-contract";

const selectionSchema = z.object({
  channels: z
    .array(
      z.object({
        id: channelIdSchema,
        kind: z.enum(["backlight", "rgb", "indicator", "rgb-indicator"]),
      }),
    )
    .min(1, "Select at least one declared channel"),
  indicatorLeds: z.record(z.string(), z.number().int().min(0)).optional(),
  indicatorColors: z
    .record(z.string(), z.string().regex(/^#[0-9a-f]{6}$/iu))
    .optional(),
});

function parseHexColor(
  value: string | undefined,
  id: string,
): { r: number; g: number; b: number } {
  const hex = value ?? (id === "caps_lock" ? "#e5484d" : "#3fb950");
  const match = /^#([0-9a-f]{6})$/iu.exec(hex);
  if (!match) {
    throw new Error(`Invalid indicator color for ${id}: ${hex}`);
  }
  const int = Number.parseInt(match[1]!, 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

export function renderReactiveModuleConfig(input: {
  channels: Array<Pick<DeclaredChannel, "id" | "kind">>;
  indicatorLeds?:
    | { scroll_lock?: number | undefined; caps_lock?: number | undefined }
    | undefined;
  indicatorColors?:
    | { scroll_lock?: string | undefined; caps_lock?: string | undefined }
    | undefined;
}): string {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid channel selection",
    );
  }

  const selected = new Map(
    parsed.data.channels.map((channel) => [channel.id, channel.kind]),
  );
  const definitions = channelIds
    .filter((id) => selected.has(id))
    .map((id) => {
      // RGB indicator channels light an LED from the declared map instead of
      // a dedicated pin, so they must not enable the pin-based helper.
      if (selected.get(id) === "rgb-indicator") {
        const led =
          input.indicatorLeds?.[id as "caps_lock" | "scroll_lock"] ?? 0;
        const color = parseHexColor(
          input.indicatorColors?.[id as "caps_lock" | "scroll_lock"],
          id,
        );
        return [
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB`,
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB_LED ${led}`,
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB_COLOR_R ${color.r}`,
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB_COLOR_G ${color.g}`,
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB_COLOR_B ${color.b}`,
        ];
      }
      return [`#define KEYFLARE_REACTIVE_${id.toUpperCase()}`];
    })
    .flat();

  // QMK compiles RGB Matrix effects only when their ENABLE_ flag is defined
  // before the config chain closes. The module config.h is part of that
  // chain, so selecting the channel guarantees the reactive effect exists.
  // Typing heatmap is a framebuffer effect, so the framebuffer has to be
  // enabled as well or QMK builds the firmware without the effect.
  const rgbEffect = selected.has("rgb_matrix")
    ? [
        "",
        "#ifdef KEYFLARE_REACTIVE_RGB_MATRIX",
        "#    define ENABLE_RGB_MATRIX_FRAMEBUFFER_EFFECTS",
        "#    define ENABLE_RGB_MATRIX_TYPING_HEATMAP",
        "#endif",
      ]
    : [];

  return `#pragma once\n\n${[...definitions, ...rgbEffect].join("\n")}\n`;
}
