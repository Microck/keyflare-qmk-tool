import { z } from "zod";

export const channelIds = [
  "backlight",
  "rgb_matrix",
  "num_lock",
  "caps_lock",
  "scroll_lock",
  "compose",
  "kana",
] as const;

export const channelIdSchema = z.enum(channelIds);
export type ChannelId = z.infer<typeof channelIdSchema>;

export interface DeclaredChannel {
  id: ChannelId;
  kind: "backlight" | "rgb" | "indicator" | "rgb-indicator";
  label: string;
}

export interface KeyboardKey {
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  keycode?: string;
}

export interface KeyboardLayout {
  name: string;
  keys: KeyboardKey[];
}

export interface TargetCapabilities {
  target: string;
  keyboardName: string;
  channels: DeclaredChannel[];
  layouts: KeyboardLayout[];

  /**
   * Declared RGB Matrix LED positions, present only when the target exposes
   * the RGB Matrix channel. Drives the RGB indicator LED picker.
   */
  rgbLeds?: { x: number; y: number }[];
  /** True when the imported source ships keymaps/vial/vial.json. */
  hasVialKeymap?: boolean;
}

const pinSchema = z.string().min(1);
const layoutKeySchema = z
  .object({
    matrix: z.tuple([
      z.number().int().nonnegative(),
      z.number().int().nonnegative(),
    ]),
    x: z.number(),
    y: z.number(),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
    label: z.string().optional(),
  })
  .passthrough();

const qmkInfoSchema = z
  .object({
    keyboard_name: z.string().min(1).optional(),
    features: z.record(z.string(), z.boolean()).optional(),
    backlight: z
      .object({
        pin: pinSchema.optional(),
        pins: z.array(pinSchema).min(1).optional(),
      })
      .passthrough()
      .optional(),
    rgb_matrix: z
      .object({
        driver: z.string().min(1).optional(),
        leds: z
          .array(
            z
              .object({
                x: z.number(),
                y: z.number(),
                flags: z.number().optional(),
              })
              .passthrough(),
          )
          .optional(),
        layout: z
          .array(
            z
              .object({
                x: z.number(),
                y: z.number(),
              })
              .passthrough(),
          )
          .optional(),
        led_count: z.number().int().optional(),
      })
      .passthrough()
      .optional(),
    ws2812: z
      .object({
        pin: pinSchema.optional(),
      })
      .passthrough()
      .optional(),
    indicators: z
      .object({
        num_lock: pinSchema.optional(),
        caps_lock: pinSchema.optional(),
        scroll_lock: pinSchema.optional(),
        compose: pinSchema.optional(),
        kana: pinSchema.optional(),
      })
      .passthrough()
      .optional(),
    layout_aliases: z.record(z.string(), z.string()).optional(),
    layouts: z.record(
      z.string(),
      z
        .object({
          layout: z.array(layoutKeySchema).min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const qmkKeymapSchema = z
  .object({
    layout: z.string().min(1),
    layers: z.array(z.array(z.string())).min(1),
  })
  .passthrough();

const indicatorDefinitions = [
  ["num_lock", "Num Lock indicator"],
  ["caps_lock", "Caps Lock indicator"],
  ["scroll_lock", "Scroll Lock indicator"],
  ["compose", "Compose indicator"],
  ["kana", "Kana indicator"],
] as const satisfies ReadonlyArray<
  readonly [Exclude<ChannelId, "backlight" | "rgb_matrix">, string]
>;

export function normalizeQmkInfo({
  target,
  info,
  keymap,
}: {
  target: string;
  info: unknown;
  keymap?: unknown;
}): TargetCapabilities {
  const parsed = qmkInfoSchema.safeParse(info);
  if (!parsed.success) {
    throw new Error(
      `Invalid QMK keyboard metadata: ${z.prettifyError(parsed.error)}`,
    );
  }
  const parsedKeymapResult =
    keymap === undefined ? null : qmkKeymapSchema.safeParse(keymap);
  if (parsedKeymapResult && !parsedKeymapResult.success) {
    throw new Error(
      `Invalid QMK keymap: ${z.prettifyError(parsedKeymapResult.error)}`,
    );
  }
  const parsedKeymap = parsedKeymapResult?.data ?? null;

  const channels: DeclaredChannel[] = [];
  const hasBacklightPin = Boolean(
    parsed.data.backlight?.pin ?? parsed.data.backlight?.pins?.length,
  );
  if (parsed.data.features?.backlight === true && hasBacklightPin) {
    channels.push({ id: "backlight", kind: "backlight", label: "Backlight" });
  }

  const hasRgbMatrixDriver = Boolean(
    parsed.data.rgb_matrix?.driver ?? parsed.data.ws2812?.pin,
  );
  let rgbMatrixLeds: { x: number; y: number }[] | undefined;
  if (parsed.data.features?.rgb_matrix === true && hasRgbMatrixDriver) {
    // QMK's data-driven build cannot address RGB Matrix LEDs without a LED
    // map, so a target without one would fail compilation with an obscure
    // error. Fail here with the recovery step instead.
    const rgbMatrixLedData =
      parsed.data.rgb_matrix?.leds?.length ||
      parsed.data.rgb_matrix?.layout?.length ||
      parsed.data.rgb_matrix?.led_count;
    if (!rgbMatrixLedData) {
      throw new Error(
        "This target declares RGB Matrix but defines no LED map. Add rgb_matrix.leds or rgb_matrix.layout (one entry per LED with x, y, and flags) to its keyboard.json so QMK can address the LEDs.",
      );
    }
    channels.push({
      id: "rgb_matrix",
      kind: "rgb",
      label: "RGB Matrix reactive",
    });
    rgbMatrixLeds = (
      parsed.data.rgb_matrix?.leds ??
      parsed.data.rgb_matrix?.layout ??
      []
    ).map((led) => ({ x: led.x, y: led.y }));
  }

  // Lock indicators normally need a dedicated LED pin. On targets that only
  // have RGB Matrix, Caps and Scroll Lock can still be indicated by lighting
  // a LED from the declared map, so fall back to an RGB indicator channel.
  const rgbIndicatorFallback =
    parsed.data.features?.rgb_matrix === true && hasRgbMatrixDriver;
  for (const [id, label] of indicatorDefinitions) {
    if (id !== "caps_lock" && id !== "scroll_lock") {
      if (parsed.data.indicators?.[id]) {
        channels.push({ id, kind: "indicator", label });
      }
      continue;
    }
    if (parsed.data.indicators?.[id]) {
      channels.push({ id, kind: "indicator", label });
    } else if (rgbIndicatorFallback) {
      channels.push({ id, kind: "rgb-indicator", label: `${label} (RGB)` });
    }
  }

  return {
    target,
    keyboardName: parsed.data.keyboard_name ?? target,
    channels,
    ...(rgbMatrixLeds?.length ? { rgbLeds: rgbMatrixLeds } : {}),
    layouts: Object.entries(parsed.data.layouts).map(([name, layout]) => {
      const keymapLayout = parsedKeymap
        ? (parsed.data.layout_aliases?.[parsedKeymap.layout] ??
          parsedKeymap.layout)
        : undefined;
      const defaultLayer =
        keymapLayout === name ? parsedKeymap?.layers[0] : undefined;
      return {
        name,
        keys: layout.layout.map((key, index) => ({
          row: key.matrix[0],
          column: key.matrix[1],
          x: key.x,
          y: key.y,
          width: key.w ?? 1,
          height: key.h ?? 1,
          label: key.label ?? "",
          ...(defaultLayer?.[index] ? { keycode: defaultLayer[index] } : {}),
        })),
      };
    }),
  };
}
