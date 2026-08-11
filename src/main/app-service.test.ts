import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BuildRequest, BuildResult } from "./firmware-build";
import type { EnvironmentStatus } from "../shared/keyflare-api";
import type { TargetCapabilities } from "../shared/keyflare-contract";
import {
  KeyflareService,
  type FirmwareBuilder,
  readQmkMsysRootSetting,
} from "./app-service";

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
  readonly qmkMsysRoots: string[] = [];
  readonly requests: BuildRequest[] = [];

  constructor(
    private readonly environment: EnvironmentStatus,
    private readonly artifactName: string,
  ) {}

  async inspectEnvironment(): Promise<EnvironmentStatus> {
    return this.environment;
  }

  async initializeSource(): Promise<void> {}

  validateQmkMsysRoot(root: string): string {
    if (root === "D:\\Invalid") {
      throw new Error(
        "Choose the QMK_MSYS folder that contains usr\\bin\\bash.exe",
      );
    }
    return root;
  }

  setValidatedQmkMsysRoot(root: string): void {
    this.qmkMsysRoots.push(root);
  }

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
  it("validates and remembers a selected QMK MSYS folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const builder = new RecordingBuilder(readyEnvironment(root), "unused.hex");
    const service = new KeyflareService({ builder });
    const settingPath = join(root, "qmk-msys-root.txt");

    await expect(
      service.selectQmkMsysRoot(async () => "D:\\Tools\\QMK_MSYS", settingPath),
    ).resolves.toEqual(readyEnvironment(root));

    expect(builder.qmkMsysRoots).toEqual(["D:\\Tools\\QMK_MSYS"]);
    await expect(readQmkMsysRootSetting(settingPath)).resolves.toBe(
      "D:\\Tools\\QMK_MSYS",
    );
  });

  it("does not change settings when folder selection is canceled", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const builder = new RecordingBuilder(readyEnvironment(root), "unused.hex");
    const service = new KeyflareService({ builder });
    const settingPath = join(root, "qmk-msys-root.txt");

    await expect(
      service.selectQmkMsysRoot(async () => null, settingPath),
    ).resolves.toBeNull();
    expect(builder.qmkMsysRoots).toEqual([]);
    await expect(readQmkMsysRootSetting(settingPath)).resolves.toBeUndefined();
  });

  it("does not remember an invalid QMK MSYS folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const builder = new RecordingBuilder(readyEnvironment(root), "unused.hex");
    const service = new KeyflareService({ builder });
    const settingPath = join(root, "qmk-msys-root.txt");

    await expect(
      service.selectQmkMsysRoot(async () => "D:\\Invalid", settingPath),
    ).rejects.toThrow(
      "Choose the QMK_MSYS folder that contains usr\\bin\\bash.exe",
    );
    await expect(readQmkMsysRootSetting(settingPath)).resolves.toBeUndefined();
  });

  it("keeps the active and saved roots when persistence fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-service-"));
    temporaryDirectories.push(root);
    const settingPath = join(root, "qmk-msys-root.txt");
    const previousRoot = "E:\\QMK_MSYS";
    const builder = new RecordingBuilder(readyEnvironment(root), "unused.hex");
    builder.setValidatedQmkMsysRoot(previousRoot);
    await writeFile(settingPath, previousRoot, "utf8");
    const service = new KeyflareService({
      builder,
      saveQmkMsysRootSetting: async () => {
        throw new Error("disk full");
      },
    });

    await expect(
      service.selectQmkMsysRoot(async () => "D:\\Tools\\QMK_MSYS", settingPath),
    ).rejects.toThrow("disk full");

    expect(builder.qmkMsysRoots).toEqual([previousRoot]);
    await expect(readQmkMsysRootSetting(settingPath)).resolves.toBe(
      previousRoot,
    );
  });

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
    canSelectQmkMsysRoot: false,
    summary: "QMK build environment ready",
    details: "qmk doctor passed.",
    qmkHome,
    qmkRef: "test-ref",
  };
}
