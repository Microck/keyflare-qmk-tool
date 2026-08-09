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

  return `#pragma once\n\n${definitions.join("\n")}\n`;
}
