import { z } from "zod";

import {
  channelIds,
  channelIdSchema,
  type ChannelId,
} from "../shared/keyflare-contract";

const selectionSchema = z.object({
  channels: z
    .array(channelIdSchema)
    .min(1, "Select at least one declared channel"),
});

export function renderReactiveModuleConfig(input: {
  channels: ChannelId[];
}): string {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid channel selection",
    );
  }

  const uniqueChannels = new Set(parsed.data.channels);
  const definitions = channelIds
    .filter((channel) => uniqueChannels.has(channel))
    .map((channel) => `#define KEYFLARE_REACTIVE_${channel.toUpperCase()}`);

  // QMK compiles RGB Matrix effects only when their ENABLE_ flag is defined
  // before the config chain closes. The module config.h is part of that
  // chain, so selecting the channel guarantees the reactive effect exists.
  const rgbEffect = uniqueChannels.has("rgb_matrix")
    ? [
        "",
        "#ifdef KEYFLARE_REACTIVE_RGB_MATRIX",
        "#    define ENABLE_RGB_MATRIX_TYPING_HEATMAP",
        "#endif",
      ]
    : [];

  return `#pragma once\n\n${[...definitions, ...rgbEffect].join("\n")}\n`;
}
