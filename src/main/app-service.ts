import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

import type { BuildRequest, BuildResult } from "./firmware-build";
import type {
  BuildAndSaveInput,
  EnvironmentStatus,
  SaveResult,
} from "../shared/keyflare-api";
import type { TargetCapabilities } from "../shared/keyflare-contract";

export interface FirmwareBuilder {
  inspectEnvironment(): Promise<EnvironmentStatus>;
  initializeSource(): Promise<void>;
  listTargets(): Promise<string[]>;
  inspectTarget(target: string): Promise<TargetCapabilities>;
  build(request: BuildRequest): Promise<BuildResult>;
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
    },
  ) {}

  getEnvironment(): Promise<EnvironmentStatus> {
    return this.dependencies.builder.inspectEnvironment();
  }

  async initializeSource(): Promise<EnvironmentStatus> {
    await this.dependencies.builder.initializeSource();
    return this.dependencies.builder.inspectEnvironment();
  }

  listTargets(): Promise<string[]> {
    return this.dependencies.builder.listTargets();
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
