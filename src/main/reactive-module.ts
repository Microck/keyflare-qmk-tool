import { z } from "zod";

import {
  channelIds,
  channelIdSchema,
  type ChannelId,
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
});

export function renderReactiveModuleConfig(input: {
  channels: Array<Pick<DeclaredChannel, "id" | "kind">>;
  indicatorLeds?:
    | { scroll_lock?: number | undefined; caps_lock?: number | undefined }
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
        const led = input.indicatorLeds?.[id as "caps_lock" | "scroll_lock"];
        if (led === undefined) {
          throw new Error(`Select an indicator LED for ${id}`);
        }
        return [
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB`,
          `#define KEYFLARE_REACTIVE_${id.toUpperCase()}_RGB_LED ${led}`,
        ];
      }
      return [`#define KEYFLARE_REACTIVE_${id.toUpperCase()}`];
    })
    .flat();

  // QMK compiles RGB Matrix effects only when their ENABLE_ flag is defined
  // before the config chain closes. The module config.h is part of that
  // chain, so selecting the channel guarantees the reactive effect exists.
  const rgbEffect = selected.has("rgb_matrix")
    ? [
        "",
        "#ifdef KEYFLARE_REACTIVE_RGB_MATRIX",
        "#    define ENABLE_RGB_MATRIX_TYPING_HEATMAP",
        "#endif",
      ]
    : [];

  return `#pragma once\n\n${[...definitions, ...rgbEffect].join("\n")}\n`;
}
