import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
  FirmwareBuildModule,
  createCommandRunner,
  findFirmwareArtifact,
  parseKeyboardTargets,
  prepareKeymapDocument,
  resolveToolCommands,
  validateQmkMsysRoot,
} from "./firmware-build";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createCommandRunner", () => {
  it("accepts explicitly allowed warning exit codes", async () => {
    await expect(
      createCommandRunner().run({
        command: process.execPath,
        args: ["-e", "process.stdout.write('minor warning'); process.exit(1)"],
        acceptedExitCodes: [0, 1],
      }),
    ).resolves.toEqual({ stdout: "minor warning", stderr: "" });
  });
});

describe("resolveToolCommands", () => {
  it("uses a configured QMK MSYS installation outside the default path", () => {
    expect(
      resolveToolCommands({
        platform: "win32",
        qmkMsysRoot: "D:\\Tools\\QMK_MSYS",
        readTextFile: () => "set MSYSTEM=MINGW64\r\n",
        pathEnv: "C:\\Windows\\System32",
        pathExists: () => true,
      }),
    ).toEqual({
      qmk: {
        command: "D:\\Tools\\QMK_MSYS\\usr\\bin\\bash.exe",
        argsPrefix: [
          "--noprofile",
          "--norc",
          "-c",
          'export PYTHONUTF8=1; export MAKE=make; exec qmk "$@"',
          "keyflare-qmk",
        ],
        env: {
          MSYSTEM: "MINGW64",
          MSYS2_PATH_TYPE: "inherit",
          PATH: "D:\\Tools\\QMK_MSYS\\mingw64\\bin;D:\\Tools\\QMK_MSYS\\usr\\bin;C:\\Windows\\System32",
        },
      },
      git: {
        command: "D:\\Tools\\QMK_MSYS\\usr\\bin\\bash.exe",
        argsPrefix: [
          "--noprofile",
          "--norc",
          "-c",
          'export PYTHONUTF8=1; export MAKE=make; exec git "$@"',
          "keyflare-git",
        ],
        env: {
          MSYSTEM: "MINGW64",
          MSYS2_PATH_TYPE: "inherit",
          PATH: "D:\\Tools\\QMK_MSYS\\mingw64\\bin;D:\\Tools\\QMK_MSYS\\usr\\bin;C:\\Windows\\System32",
        },
      },
    });
  });

  it("uses the official QMK MSYS shell when it is installed on Windows", () => {
    const bashPath = "C:\\QMK_MSYS\\usr\\bin\\bash.exe";
    const releasePath = "C:\\QMK_MSYS\\etc\\qmk-release";
    const connectorPath = "C:\\QMK_MSYS\\shell_connector.cmd";
    const qmkMsysPath =
      "/opt/qmk/bin:/opt/uv/tools/bin:/ucrt64/bin:/usr/local/bin:/usr/bin:/bin:$PATH";

    expect(
      resolveToolCommands({
        platform: "win32",
        systemDrive: "C:",
        pathEnv: "C:\\Windows\\System32",
        pathExists: (path) =>
          [bashPath, releasePath, connectorPath].includes(path),
        readTextFile: () => "@echo off\r\nset MSYSTEM=UCRT64\r\n",
      }),
    ).toEqual({
      qmk: {
        command: bashPath,
        argsPrefix: [
          "--noprofile",
          "--norc",
          "-c",
          `export PATH=${qmkMsysPath}; export QMK_DISTRIB_DIR=/opt/qmk; export PYTHONUTF8=1; export MAKE=make; exec qmk "$@"`,
          "keyflare-qmk",
        ],
        env: {
          MSYSTEM: "UCRT64",
          MSYS2_PATH_TYPE: "inherit",
          PATH: "C:\\QMK_MSYS\\opt\\qmk\\bin;C:\\QMK_MSYS\\opt\\uv\\tools\\bin;C:\\QMK_MSYS\\ucrt64\\bin;C:\\QMK_MSYS\\usr\\bin;C:\\Windows\\System32",
        },
      },
      git: {
        command: bashPath,
        argsPrefix: [
          "--noprofile",
          "--norc",
          "-c",
          `export PATH=${qmkMsysPath}; export QMK_DISTRIB_DIR=/opt/qmk; export PYTHONUTF8=1; export MAKE=make; exec git "$@"`,
          "keyflare-git",
        ],
        env: {
          MSYSTEM: "UCRT64",
          MSYS2_PATH_TYPE: "inherit",
          PATH: "C:\\QMK_MSYS\\opt\\qmk\\bin;C:\\QMK_MSYS\\opt\\uv\\tools\\bin;C:\\QMK_MSYS\\ucrt64\\bin;C:\\QMK_MSYS\\usr\\bin;C:\\Windows\\System32",
        },
      },
    });
  });

  it("uses commands from PATH when QMK MSYS is not installed", () => {
    expect(
      resolveToolCommands({
        platform: "win32",
        pathExists: () => false,
      }),
    ).toEqual({
      qmk: { command: "qmk", argsPrefix: [] },
      git: { command: "git", argsPrefix: [] },
    });
  });

  it("rejects a configured path that is no longer QMK MSYS", () => {
    expect(() =>
      resolveToolCommands({
        platform: "win32",
        qmkMsysRoot: "D:\\Removed-QMK_MSYS",
        pathExists: () => false,
      }),
    ).toThrow("Choose the QMK MSYS installation folder");
  });

  it("rejects a folder that is not a QMK MSYS installation", () => {
    expect(() =>
      validateQmkMsysRoot("D:\\Wrong", {
        pathExists: () => false,
      }),
    ).toThrow("Choose the QMK MSYS installation folder");
  });

  it("rejects Git Bash even though it contains usr\\bin\\bash.exe", () => {
    expect(() =>
      validateQmkMsysRoot("C:\\Program Files\\Git", {
        pathExists: (path) => path.endsWith("usr\\bin\\bash.exe"),
      }),
    ).toThrow("Choose the QMK MSYS installation folder");
  });
});

describe("prepareKeymapDocument", () => {
  it("preserves the keymap and adds the Keyflare module once", () => {
    const source = {
      version: 1,
      keyboard: "tgr/jane/v2",
      keymap: "default",
      layout: "LAYOUT_tkl_ansi",
      layers: [["KC_ESC", "KC_F1"]],
      modules: ["vendor/existing", "keyflare/reactive"],
    };

    expect(prepareKeymapDocument({ source, target: "tgr/jane/v2" })).toEqual(
      source,
    );
  });

  it("rejects a keymap for another target", () => {
    expect(() =>
      prepareKeymapDocument({
        source: {
          version: 1,
          keyboard: "other/board",
          keymap: "default",
          layout: "LAYOUT",
          layers: [[]],
        },
        target: "tgr/jane/v2",
      }),
    ).toThrow("belongs to other/board, not tgr/jane/v2");
  });
});

describe("parseKeyboardTargets", () => {
  it("normalizes, sorts, and de-duplicates QMK output", () => {
    expect(
      parseKeyboardTargets("zeta/board\nalpha/board\nzeta/board\n\n"),
    ).toEqual(["alpha/board", "zeta/board"]);
  });
});

describe("FirmwareBuildModule source setup", () => {
  it("detects QMK MSYS after installation without an app restart", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-retry-"));
    temporaryDirectories.push(appDataPath);
    const runner = new RecordingCommandRunner();
    let qmkMsysInstalled = false;
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: runner,
      toolCommandResolver: () =>
        resolveToolCommands({
          platform: "win32",
          systemDrive: "C:",
          pathExists: () => qmkMsysInstalled,
          readTextFile: () => "set MSYSTEM=UCRT64\r\n",
        }),
    });

    await builder.inspectEnvironment();
    qmkMsysInstalled = true;
    await builder.inspectEnvironment();

    expect(runner.requests[0]).toMatchObject({ command: "qmk" });
    expect(runner.requests.at(-2)).toMatchObject({
      command: "C:\\QMK_MSYS\\usr\\bin\\bash.exe",
      args: [
        "--noprofile",
        "--norc",
        "-c",
        expect.stringContaining("exec qmk"),
        "keyflare-qmk",
        "--version",
      ],
    });
  });

  it("synchronizes the pinned checkout submodules", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-source-"));
    temporaryDirectories.push(appDataPath);
    const runner = new RecordingCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: runner,
    });

    await builder.initializeSource();

    expect(runner.requests).toContainEqual({
      command: "git",
      args: [
        "remote",
        "add",
        "origin",
        "https://github.com/qmk/qmk_firmware.git",
      ],
      cwd: builder.qmkHome,
    });
    expect(runner.requests.at(-1)).toMatchObject({
      command: "qmk",
      args: ["git-submodule", "--sync"],
      cwd: builder.qmkHome,
    });
  });
});

describe("FirmwareBuildModule target inspection", () => {
  it("reuses the last target metadata instead of running QMK twice", async () => {
    const runner = new CapabilityCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath: "/app-data",
      moduleSourcePath: "/module-source",
      commandRunner: runner,
    });

    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      target: "test/board",
      keyboardName: "Test board",
    });
    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      target: "test/board",
    });

    expect(
      runner.requests.filter(({ args }) => args[0] === "info"),
    ).toHaveLength(1);
  });
});

describe("findFirmwareArtifact", () => {
  it("returns the only firmware file from an isolated build directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyflare-artifacts-"));
    temporaryDirectories.push(directory);

    const freshArtifact = join(directory, "fresh.uf2");
    await Promise.all([
      writeFile(freshArtifact, "fresh"),
      writeFile(join(directory, "build.log"), "not firmware"),
    ]);

    await expect(findFirmwareArtifact(directory)).resolves.toBe(freshArtifact);
  });

  it("fails clearly when QMK produces no firmware file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyflare-artifacts-"));
    temporaryDirectories.push(directory);

    await expect(findFirmwareArtifact(directory)).rejects.toThrow(
      "QMK completed without producing a firmware artifact",
    );
  });

  it("rejects ambiguous isolated output instead of choosing by timestamp", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyflare-artifacts-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(join(directory, "first.hex"), "first"),
      writeFile(join(directory, "second.bin"), "second"),
    ]);

    await expect(findFirmwareArtifact(directory)).rejects.toThrow(
      "QMK produced multiple firmware artifacts",
    );
  });
});

describe("FirmwareBuildModule builds", () => {
  it("resets its build lock when workspace creation fails", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-lock-"));
    temporaryDirectories.push(appDataPath);
    await writeFile(join(appDataPath, "keyflare-work"), "not a directory");
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/unused-before-workspace-creation",
      commandRunner: new RecordingCommandRunner(),
    });
    const request = {
      target: "test/board",
      channels: ["scroll_lock" as const],
      keymap: { kind: "default" as const },
    };

    await expect(builder.build(request)).rejects.not.toThrow(
      "A firmware build is already running",
    );
    await expect(builder.build(request)).rejects.not.toThrow(
      "A firmware build is already running",
    );
  });

  it("keeps QMK build state and firmware inside its temporary userspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-build-"));
    temporaryDirectories.push(root);
    const moduleSourcePath = join(root, "module-source");
    const keymapPath = join(root, "keymap.json");
    await mkdir(moduleSourcePath);
    await Promise.all([
      writeFile(join(moduleSourcePath, "qmk_module.json"), "{}"),
      writeFile(join(moduleSourcePath, "reactive.c"), ""),
      writeFile(
        keymapPath,
        JSON.stringify({
          keyboard: "test/board",
          keymap: "personal/keymap",
          layout: "LAYOUT",
          layers: [["KC_ESC"]],
        }),
      ),
    ]);
    const runner = new IsolatedBuildCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath,
      commandRunner: runner,
    });

    const build = await builder.build({
      target: "test/board",
      channels: ["scroll_lock"],
      keymap: { kind: "file", path: keymapPath },
    });

    expect(build.artifactName).toBe("test_board_personal_keymap.hex");
    expect(new TextDecoder().decode(build.artifact)).toBe("firmware");
    const compile = runner.requests.find(({ args }) => args[0] === "compile");
    expect(compile?.env?.QMK_USERSPACE).toContain("keyflare-work");
    expect(compile?.args).toContain(
      `QMK_USERSPACE=${compile?.env?.QMK_USERSPACE ?? "missing"}`,
    );
  });
});

class RecordingCommandRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return { stdout: "", stderr: "" };
  }
}

class CapabilityCommandRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return {
      stdout: JSON.stringify({
        keyboard_name: "Test board",
        layouts: {
          LAYOUT: {
            layout: [{ matrix: [0, 0], x: 0, y: 0 }],
          },
        },
      }),
      stderr: "",
    };
  }
}

class IsolatedBuildCommandRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    if (request.args[0] === "info") {
      return {
        stdout: JSON.stringify({
          keyboard_name: "Test board",
          indicators: { scroll_lock: "D6" },
          layouts: {
            LAYOUT: {
              layout: [{ matrix: [0, 0], x: 0, y: 0 }],
            },
          },
        }),
        stderr: "",
      };
    }
    if (request.args[0] === "compile") {
      const userspace = request.env?.QMK_USERSPACE;
      if (!userspace) {
        throw new Error("compile did not receive QMK_USERSPACE");
      }
      const keymap = JSON.parse(await readFile(request.args[1]!, "utf8")) as {
        keymap: string;
      };
      await writeFile(
        join(userspace, `test_board_${keymap.keymap}.hex`),
        "firmware",
      );
      await expect(
        readFile(
          join(userspace, "modules", "keyflare", "reactive", "config.h"),
          "utf8",
        ),
      ).resolves.toContain("KEYFLARE_REACTIVE_SCROLL_LOCK");
    }
    return { stdout: "", stderr: "" };
  }
}
