import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BuildRequest, BuildResult } from "./firmware-build";
import type { EnvironmentStatus } from "../shared/keyflare-api";
import type { TargetCapabilities } from "../shared/keyflare-contract";
import { KeyflareService, type FirmwareBuilder } from "./app-service";

const capabilities: TargetCapabilities = {
  target: "test/board",
  keyboardName: "Test board",
  channels: [
    { id: "scroll_lock", kind: "indicator", label: "Scroll Lock indicator" },
  ],
  layouts: [
    {
      name: "LAYOUT",
      keys: [
        { row: 0, column: 0, x: 0, y: 0, width: 1, height: 1, label: "Esc" },
      ],
    },
  ],
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

class RecordingBuilder implements FirmwareBuilder {
  readonly requests: BuildRequest[] = [];

  constructor(
    private readonly environment: EnvironmentStatus,
    private readonly artifactName: string,
  ) {}

  async inspectEnvironment(): Promise<EnvironmentStatus> {
    return this.environment;
  }

  async initializeSource(): Promise<void> {}

  async listTargets(): Promise<string[]> {
    return ["test/board"];
  }

  async inspectTarget(): Promise<typeof capabilities> {
    return capabilities;
  }

  async build(request: BuildRequest): Promise<BuildResult> {
    this.requests.push(request);
    return {
      artifactName: this.artifactName,
      artifact: new TextEncoder().encode("firmware"),
      stdout: "compiled",
      stderr: "",
    };
  }
}

describe("KeyflareService", () => {
  it("keeps imported file paths out of the renderer contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const keymapPath = join(root, "personal-keymap.json");
    const savePath = join(root, "saved", "firmware.hex");
    await writeFile(keymapPath, "{}", "utf8");

    const builder = new RecordingBuilder(
      readyEnvironment(root),
      "test_board_default.hex",
    );
    const service = new KeyflareService({ builder });

    await expect(service.selectKeymap(async () => keymapPath)).resolves.toEqual(
      {
        name: basename(keymapPath),
      },
    );
    await mkdir(join(root, "saved"));
    await expect(
      service.buildAndSave(
        {
          target: "test/board",
          channels: ["scroll_lock"],
          keymap: "imported",
        },
        async (suggestedName) => {
          expect(suggestedName).toBe("test_board_default.hex");
          return savePath;
        },
      ),
    ).resolves.toEqual({
      kind: "saved",
      fileName: "firmware.hex",
      savedPath: savePath,
    });

    expect(builder.requests).toEqual([
      {
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: { kind: "file", path: keymapPath },
      },
    ]);
    await expect(readFile(savePath, "utf8")).resolves.toBe("firmware");
  });

  it("rejects imported builds until a keymap has been selected", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const builder = new RecordingBuilder(
      readyEnvironment(root),
      "firmware.hex",
    );
    const service = new KeyflareService({ builder });

    await expect(
      service.buildAndSave(
        {
          target: "test/board",
          channels: ["scroll_lock"],
          keymap: "imported",
        },
        async () => null,
      ),
    ).rejects.toThrow("Select a QMK keymap.json file before building");
  });

  it("reports a canceled save without claiming an artifact was saved", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const service = new KeyflareService({
      builder: new RecordingBuilder(
        readyEnvironment(root),
        "test_board_default.hex",
      ),
    });

    await expect(
      service.buildAndSave(
        {
          target: "test/board",
          channels: ["scroll_lock"],
          keymap: "default",
        },
        async () => null,
      ),
    ).resolves.toEqual({ kind: "canceled" });
  });
});

function readyEnvironment(qmkHome: string): EnvironmentStatus {
  return {
    kind: "ready",
    summary: "QMK build environment ready",
    details: "qmk doctor passed.",
    qmkHome,
    qmkRef: "test-ref",
  };
}
