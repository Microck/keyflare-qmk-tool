import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";

import type { BuildRequest, BuildResult } from "./firmware-build";
import type {
  BuildAndSaveInput,
  EnvironmentStatus,
  KeyboardSourceSelection,
  SaveResult,
} from "../shared/keyflare-api";
import type { TargetCapabilities } from "../shared/keyflare-contract";

export interface FirmwareBuilder {
  inspectEnvironment(): Promise<EnvironmentStatus>;
  initializeSource(): Promise<void>;
  validateQmkMsysRoot(root: string): string;
  setValidatedQmkMsysRoot(root: string): void;
  importKeyboardSource(
    sourceDirectory: string,
  ): Promise<KeyboardSourceSelection>;
  inspectTarget(target: string): Promise<TargetCapabilities>;
  build(request: BuildRequest): Promise<BuildResult>;
}

async function saveQmkMsysRootSetting(
  settingPath: string,
  root: string,
): Promise<void> {
  const temporaryPath = `${settingPath}.${randomUUID()}.tmp`;
  try {
    // A same-directory rename replaces the setting atomically, so a failed
    // write cannot truncate the last known-good path.
    await writeFile(temporaryPath, root, "utf8");
    await rename(temporaryPath, settingPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readQmkMsysRootSetting(
  settingPath: string,
): Promise<string | undefined> {
  try {
    return (await readFile(settingPath, "utf8")).trim() || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Owns the complete renderer-to-filesystem workflow. The renderer receives only
 * display names and saved destinations, never an input path that it could forge
 * and send back through IPC.
 */
export class KeyflareService {
  private selectedKeymapPath: string | null = null;

  constructor(
    private readonly dependencies: {
      builder: FirmwareBuilder;
      saveQmkMsysRootSetting?: (
        settingPath: string,
        root: string,
      ) => Promise<void>;
    },
  ) {}

  getEnvironment(): Promise<EnvironmentStatus> {
    return this.dependencies.builder.inspectEnvironment();
  }

  async initializeSource(): Promise<EnvironmentStatus> {
    await this.dependencies.builder.initializeSource();
    return this.dependencies.builder.inspectEnvironment();
  }

  async selectKeyboardSource(
    chooseSource: () => Promise<string | null>,
  ): Promise<KeyboardSourceSelection | null> {
    const sourceDirectory = await chooseSource();
    return sourceDirectory
      ? this.dependencies.builder.importKeyboardSource(sourceDirectory)
      : null;
  }

  inspectTarget(target: string): Promise<TargetCapabilities> {
    return this.dependencies.builder.inspectTarget(target);
  }

  async selectKeymap(
    chooseKeymap: () => Promise<string | null>,
  ): Promise<{ name: string } | null> {
    const path = await chooseKeymap();
    if (!path) {
      return null;
    }

    this.selectedKeymapPath = path;
    return { name: basename(path) };
  }

  async selectQmkMsysRoot(
    chooseRoot: () => Promise<string | null>,
    settingPath: string,
  ): Promise<EnvironmentStatus | null> {
    const root = await chooseRoot();
    if (!root) {
      return null;
    }

    const validatedRoot = this.dependencies.builder.validateQmkMsysRoot(root);
    await (this.dependencies.saveQmkMsysRootSetting ?? saveQmkMsysRootSetting)(
      settingPath,
      validatedRoot,
    );
    this.dependencies.builder.setValidatedQmkMsysRoot(validatedRoot);
    return this.dependencies.builder.inspectEnvironment();
  }

  async buildAndSave(
    input: BuildAndSaveInput,
    chooseArtifactDestination: (
      suggestedName: string,
    ) => Promise<string | null>,
  ): Promise<SaveResult> {
    let keymap: BuildRequest["keymap"];
    if (input.keymap === "default") {
      keymap = { kind: "default" };
    } else {
      const path = this.selectedKeymapPath;
      if (!path) {
        throw new Error("Select a QMK keymap.json file before building");
      }
      keymap = { kind: "file", path };
    }
    const build = await this.dependencies.builder.build({
      target: input.target,
      channels: input.channels,
      keymap,
    });
    const destination = await chooseArtifactDestination(build.artifactName);
    if (!destination) {
      return { kind: "canceled" };
    }

    await writeFile(destination, build.artifact);

    return {
      kind: "saved",
      fileName: basename(destination),
      savedPath: destination,
    };
  }
}
