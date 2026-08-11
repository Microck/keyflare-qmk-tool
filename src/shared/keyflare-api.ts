import { z } from "zod";

import { channelIdSchema, type TargetCapabilities } from "./keyflare-contract";

export { ipcChannels } from "./ipc-channels";

export interface EnvironmentStatus {
  kind: "ready" | "source-required" | "toolchain-required" | "unhealthy";
  canSelectQmkMsysRoot: boolean;
  summary: string;
  details: string;
  qmkHome: string;
  qmkRef: string;
}

export const inspectTargetInputSchema = z.string().min(1);
export const keyboardSourceSelectionSchema = z
  .object({
    name: z.string().min(1),
    targets: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const buildAndSaveInputSchema = z.object({
  target: z.string().min(1),
  channels: z.array(channelIdSchema).min(1),
  keymap: z.enum(["default", "imported"]),
});

export type BuildAndSaveInput = z.infer<typeof buildAndSaveInputSchema>;

export type KeymapSelection = { name: string };
export type KeyboardSourceSelection = z.infer<
  typeof keyboardSourceSelectionSchema
>;

export type SaveResult =
  { kind: "saved"; fileName: string; savedPath: string } | { kind: "canceled" };

export interface KeyflareApi {
  getEnvironment(): Promise<EnvironmentStatus>;
  initializeSource(): Promise<EnvironmentStatus>;
  selectKeyboardSource(): Promise<KeyboardSourceSelection | null>;
  inspectTarget(target: string): Promise<TargetCapabilities>;
  selectKeymap(): Promise<KeymapSelection | null>;
  selectQmkMsysRoot(): Promise<EnvironmentStatus | null>;
  buildAndSave(input: BuildAndSaveInput): Promise<SaveResult>;
  isWindowMaximized(): Promise<boolean>;
  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}
