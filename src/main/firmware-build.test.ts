import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  prepareKeymapDocument,
  qmkFirmwareRef,
  qmkFirmwareUrl,
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
          'export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; exec qmk "$@"',
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
          'export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; exec git "$@"',
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
          `export PATH=${qmkMsysPath}; export QMK_DISTRIB_DIR=/opt/qmk; export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; exec qmk "$@"`,
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
          `export PATH=${qmkMsysPath}; export QMK_DISTRIB_DIR=/opt/qmk; export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; exec git "$@"`,
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
      args: ["remote", "add", "origin", qmkFirmwareUrl],
      cwd: builder.qmkHome,
    });
    expect(runner.requests).toContainEqual({
      command: "git",
      args: ["sparse-checkout", "set", "--no-cone", "/*", "!/keyboards/"],
      cwd: builder.qmkHome,
    });
    expect(runner.requests).toContainEqual({
      command: "git",
      args: [
        "fetch",
        "--depth",
        "1",
        "--filter=blob:none",
        "origin",
        qmkFirmwareRef,
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

describe("FirmwareBuildModule keyboard source import", () => {
  it("imports one keyboard family and returns only its declared targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-"));
    temporaryDirectories.push(root);
    const source = join(root, "my-board");
    await mkdir(join(source, "revisions", "v2"), { recursive: true });
    await mkdir(join(source, "keymaps", "default"), { recursive: true });
    await Promise.all([
      writeFile(join(source, "keyboard.json"), "{}"),
      writeFile(join(source, "revisions", "v2", "keyboard.json"), "{}"),
      writeFile(join(source, "keymaps", "default", "keyboard.json"), "{}"),
    ]);
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
    });

    await expect(builder.importKeyboardSource(source)).resolves.toEqual({
      name: "my-board",
      targets: [
        "keyflare_imported/my-board",
        "keyflare_imported/my-board/revisions/v2",
      ],
    });
    await expect(
      readFile(
        join(
          builder.qmkHome,
          "keyboards",
          "keyflare_imported",
          "my-board",
          "keyboard.json",
        ),
        "utf8",
      ),
    ).resolves.toBe(
      JSON.stringify({ modules: ["keyflare/reactive"] }, null, 4) + "\n",
    );
  });

  it("rejects a folder without a QMK keyboard definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-invalid-"));
    temporaryDirectories.push(root);
    const source = join(root, "not-a-keyboard");
    await mkdir(source);
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
    });

    await expect(builder.importKeyboardSource(source)).rejects.toThrow(
      "Choose a QMK keyboard source folder that contains keyboard.json",
    );
  });

  it("rejects source folders that contain the managed import directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-ancestor-"));
    temporaryDirectories.push(root);
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
    });

    await expect(builder.importKeyboardSource(builder.qmkHome)).rejects.toThrow(
      "Choose the original QMK keyboard source folder",
    );
  });

  it("rejects keyboard source folders that contain symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-symlink-"));
    temporaryDirectories.push(root);
    const source = join(root, "board");
    const linkedDirectory = join(root, "linked");
    await Promise.all([mkdir(source), mkdir(linkedDirectory)]);
    await writeFile(join(source, "keyboard.json"), "{}");
    await symlink(
      linkedDirectory,
      join(source, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
    });

    await expect(builder.importKeyboardSource(source)).rejects.toThrow(
      "QMK keyboard source folders cannot contain symlinks",
    );
  });

  it("keeps the current imported source when the replacement copy fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-failure-"));
    temporaryDirectories.push(root);
    const source = join(root, "replacement");
    await mkdir(source);
    await writeFile(join(source, "keyboard.json"), "{}");
    const currentDefinition = join(
      root,
      "qmk_firmware",
      "keyboards",
      "keyflare_imported",
      "current",
      "keyboard.json",
    );
    await mkdir(join(currentDefinition, ".."), { recursive: true });
    await writeFile(currentDefinition, '{"keyboard_name":"Current"}');
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
      copyDirectory: async () => {
        throw new Error("copy failed");
      },
    });

    await expect(builder.importKeyboardSource(source)).rejects.toThrow(
      "copy failed",
    );
    await expect(readFile(currentDefinition, "utf8")).resolves.toBe(
      '{"keyboard_name":"Current"}',
    );
  });

  it("accepts a committed replacement when old-backup cleanup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-import-cleanup-"));
    temporaryDirectories.push(root);
    const source = join(root, "replacement");
    await mkdir(source);
    await writeFile(join(source, "keyboard.json"), '{"keyboard_name":"New"}');
    const importedRoot = join(
      root,
      "qmk_firmware",
      "keyboards",
      "keyflare_imported",
    );
    await mkdir(join(importedRoot, "current"), { recursive: true });
    await writeFile(join(importedRoot, "current", "keyboard.json"), "{}");
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath: "/unused-in-this-test",
      commandRunner: new RecordingCommandRunner(),
      removeDirectory: async () => {
        throw new Error("cleanup failed");
      },
    });

    await expect(builder.importKeyboardSource(source)).resolves.toMatchObject({
      name: "replacement",
    });
    await expect(
      readFile(join(importedRoot, "replacement", "keyboard.json"), "utf8").then(
        JSON.parse,
      ),
    ).resolves.toEqual({
      keyboard_name: "New",
      modules: ["keyflare/reactive"],
    });
  });
});

describe("FirmwareBuildModule target inspection", () => {
  it("loads keyboard metadata when no default keymap exists", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-no-default-"));
    temporaryDirectories.push(appDataPath);
    const runner = new MissingDefaultCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/module-source",
      commandRunner: runner,
    });

    const inspected = await builder.inspectTarget("test/board");
    expect(inspected).toMatchObject({
      target: "test/board",
      keyboardName: "Test board",
      layouts: [{ keys: [{ row: 0, column: 0 }] }],
    });
    expect(inspected.layouts[0]?.keys[0]?.keycode).toBeUndefined();
  });

  it("reads JSON defaults directly and reuses the last target metadata", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-inspect-"));
    temporaryDirectories.push(appDataPath);
    const runner = new CapabilityCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/module-source",
      commandRunner: runner,
    });
    const defaultKeymapDirectory = join(
      builder.qmkHome,
      "keyboards",
      "test",
      "board",
      "keymaps",
      "default",
    );
    await mkdir(defaultKeymapDirectory, { recursive: true });
    await writeFile(
      join(defaultKeymapDirectory, "keymap.json"),
      JSON.stringify({
        keyboard: "original/vendor-board",
        keymap: "default",
        layout: "LAYOUT",
        layers: [["KC_SCRL"]],
      }),
    );

    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      target: "test/board",
      keyboardName: "Test board",
      layouts: [{ keys: [{ keycode: "KC_SCRL" }] }],
    });
    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      target: "test/board",
    });

    expect(
      runner.requests.filter(({ args }) => args[0] === "info"),
    ).toHaveLength(1);
    expect(
      runner.requests.filter(({ args }) => args[0] === "c2json"),
    ).toHaveLength(0);
  });

  it("uses QMK to convert a C default keymap", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-inspect-c-"));
    temporaryDirectories.push(appDataPath);
    const runner = new CapabilityCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/module-source",
      commandRunner: runner,
    });
    const defaultKeymapDirectory = join(
      builder.qmkHome,
      "keyboards",
      "test",
      "board",
      "keymaps",
      "default",
    );
    await mkdir(defaultKeymapDirectory, { recursive: true });
    await writeFile(join(defaultKeymapDirectory, "keymap.c"), "");

    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      layouts: [{ keys: [{ keycode: "KC_SCRL" }] }],
    });
    expect(
      runner.requests.filter(({ args }) => args[0] === "c2json"),
    ).toHaveLength(1);
  });

  it("reports when the imported source ships a Vial keymap", async () => {
    const appDataPath = await mkdtemp(join(tmpdir(), "keyflare-inspect-vial-"));
    temporaryDirectories.push(appDataPath);
    const runner = new CapabilityCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath,
      moduleSourcePath: "/module-source",
      commandRunner: runner,
    });
    const vialDirectory = join(
      builder.qmkHome,
      "keyboards",
      "test",
      "board",
      "keymaps",
      "vial",
    );
    await mkdir(vialDirectory, { recursive: true });
    await writeFile(join(vialDirectory, "vial.json"), "{}");

    await expect(builder.inspectTarget("test/board")).resolves.toMatchObject({
      hasVialKeymap: true,
    });
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

  it("retargets an imported JSON default keymap before compiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-build-default-"));
    temporaryDirectories.push(root);
    const moduleSourcePath = join(root, "module-source");
    await mkdir(moduleSourcePath);
    await Promise.all([
      writeFile(join(moduleSourcePath, "qmk_module.json"), "{}"),
      writeFile(join(moduleSourcePath, "reactive.c"), ""),
    ]);
    const runner = new IsolatedBuildCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath,
      commandRunner: runner,
    });
    const defaultKeymapDirectory = join(
      builder.qmkHome,
      "keyboards",
      "test",
      "board",
      "keymaps",
      "default",
    );
    await mkdir(defaultKeymapDirectory, { recursive: true });
    await writeFile(
      join(defaultKeymapDirectory, "keymap.json"),
      JSON.stringify({
        keyboard: "original/vendor-board",
        keymap: "default",
        layout: "LAYOUT",
        layers: [["KC_SCRL"]],
      }),
    );

    await expect(
      builder.build({
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: { kind: "default" },
      }),
    ).resolves.toMatchObject({ artifactName: "test_board_default.hex" });
    expect(runner.compiledKeymaps[0]).toMatchObject({
      keyboard: "test/board",
    });
  });

  it("retargets an imported keymap file before compiling", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-build-imported-"));
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
          keyboard: "vendor/board",
          keymap: "personal",
          layout: "LAYOUT",
          layers: [["KC_SCRL"]],
        }),
      ),
    ]);
    const runner = new IsolatedBuildCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath,
      commandRunner: runner,
    });

    await builder.build({
      target: "keyflare_imported/board",
      channels: ["scroll_lock"],
      keymap: { kind: "file", path: keymapPath },
    });

    expect(runner.compiledKeymaps[0]).toMatchObject({
      keyboard: "keyflare_imported/board",
      keymap: expect.stringMatching(/^keyflare_/u),
    });
  });

  it("compiles a native Vial keymap instead of converting it to JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyflare-build-vial-"));
    temporaryDirectories.push(root);
    const moduleSourcePath = join(root, "module-source");
    await mkdir(moduleSourcePath);
    await Promise.all([
      writeFile(join(moduleSourcePath, "qmk_module.json"), "{}"),
      writeFile(join(moduleSourcePath, "reactive.c"), ""),
    ]);
    const runner = new IsolatedBuildCommandRunner();
    const builder = new FirmwareBuildModule({
      appDataPath: root,
      moduleSourcePath,
      commandRunner: runner,
    });
    const vialDirectory = join(
      builder.qmkHome,
      "keyboards",
      "test",
      "board",
      "keymaps",
      "vial",
    );
    await mkdir(vialDirectory, { recursive: true });
    await writeFile(join(vialDirectory, "vial.json"), "{}");

    await expect(
      builder.build({
        target: "test/board",
        channels: ["scroll_lock"],
        keymap: { kind: "vial" },
      }),
    ).resolves.toMatchObject({ artifactName: "test_board_vial.hex" });
    const compile = runner.requests.find(({ args }) => args[0] === "compile");
    expect(compile?.args).toEqual([
      "compile",
      "-kb",
      "test/board",
      "-km",
      "vial",
      "-e",
      `QMK_USERSPACE=${compile?.env?.QMK_USERSPACE ?? "missing"}`,
    ]);
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
    if (request.args[0] === "c2json") {
      return {
        stdout: JSON.stringify({
          keyboard: "test/board",
          keymap: "default",
          layout: "LAYOUT",
          layers: [["KC_SCRL"]],
        }),
        stderr: "",
      };
    }
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

class MissingDefaultCommandRunner extends CapabilityCommandRunner {
  override async run(request: CommandRequest): Promise<CommandResult> {
    if (request.args[0] === "c2json") {
      throw new Error("default keymap not found");
    }
    return super.run(request);
  }
}

class IsolatedBuildCommandRunner implements CommandRunner {
  readonly compiledKeymaps: Array<Record<string, unknown>> = [];
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
    if (request.args[0] === "c2json") {
      return {
        stdout: JSON.stringify({
          keyboard: "test/board",
          keymap: "default",
          layout: "LAYOUT",
          layers: [["KC_SCRL"]],
        }),
        stderr: "",
      };
    }
    if (request.args[0] === "compile") {
      const userspace = request.env?.QMK_USERSPACE;
      if (!userspace) {
        throw new Error("compile did not receive QMK_USERSPACE");
      }
      const keymapFlag = request.args.indexOf("-km");
      if (keymapFlag >= 0) {
        const keymapName = request.args[keymapFlag + 1] ?? "vial";
        await writeFile(
          join(userspace, `test_board_${keymapName}.hex`),
          "firmware",
        );
        await expect(
          readFile(
            join(userspace, "modules", "keyflare", "reactive", "config.h"),
            "utf8",
          ),
        ).resolves.toContain("KEYFLARE_REACTIVE_SCROLL_LOCK");
        return { stdout: "", stderr: "" };
      }
      const keymap = JSON.parse(
        await readFile(request.args[1]!, "utf8"),
      ) as Record<string, unknown> & { keymap: string };
      this.compiledKeymaps.push(keymap);
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
