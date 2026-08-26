import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep, win32 } from "node:path";

import { z } from "zod";

import {
  channelIdSchema,
  normalizeQmkInfo,
  type ChannelId,
  type DeclaredChannel,
  type TargetCapabilities,
} from "../shared/keyflare-contract";
import type {
  EnvironmentStatus,
  KeyboardSourceSelection,
} from "../shared/keyflare-api";
import { renderReactiveModuleConfig } from "./reactive-module";

export const qmkFirmwareRef = "dd43959ae5c08d8a28d38a1acf7b04e86b14a344";
export const qmkFirmwareUrl = "https://github.com/vial-kb/vial-qmk.git";
const keyflareModuleName = "keyflare/reactive";
const importedKeyboardNamespace = "keyflare_imported";
const firmwareExtensions = new Set(["bin", "hex", "uf2"]);

const keymapSchema = z
  .object({
    keyboard: z.string().min(1),
    keymap: z.string().min(1).optional(),
    layout: z.string().min(1),
    layers: z.array(z.array(z.string())),
    modules: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const buildRequestSchema = z.object({
  target: z.string().min(1),
  channels: z.array(channelIdSchema).min(1),
  indicatorLeds: z
    .object({
      caps_lock: z.number().int().min(0),
      scroll_lock: z.number().int().min(0),
    })
    .partial()
    .optional(),
  indicatorColors: z
    .object({
      caps_lock: z.string().regex(/^#[0-9a-f]{6}$/iu),
      scroll_lock: z.string().regex(/^#[0-9a-f]{6}$/iu),
    })
    .partial()
    .optional(),
  keymap: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("default") }),
    z.object({ kind: z.literal("vial") }),
    z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  ]),
});

export type KeymapDocument = z.infer<typeof keymapSchema>;
export type BuildRequest = z.infer<typeof buildRequestSchema>;

export interface CommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  acceptedExitCodes?: number[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

interface ToolCommand {
  command: string;
  argsPrefix: string[];
  env?: NodeJS.ProcessEnv;
}

interface ToolCommands {
  qmk: ToolCommand;
  git: ToolCommand;
}

export interface BuildResult {
  artifactName: string;
  artifact: Uint8Array;
  stdout: string;
  stderr: string;
}

export interface FirmwareBuildModuleOptions {
  appDataPath: string;
  moduleSourcePath: string;
  commandRunner?: CommandRunner;
  gitCommand?: string;
  platform?: NodeJS.Platform;
  qmkMsysRoot?: string;
  qmkCommand?: string;
  toolCommandResolver?: (qmkMsysRoot: string | undefined) => ToolCommands;
  copyDirectory?: typeof cp;
  removeDirectory?: typeof rm;
}

export function resolveToolCommands({
  platform = process.platform,
  qmkMsysRoot,
  systemDrive = process.env.SystemDrive ?? "C:",
  pathEnv = process.env.PATH ?? "",
  pathExists = existsSync,
  readTextFile = (path) => readFileSync(path, "utf8"),
}: {
  platform?: NodeJS.Platform;
  qmkMsysRoot?: string | undefined;
  systemDrive?: string;
  pathEnv?: string;
  pathExists?: (path: string) => boolean;
  readTextFile?: (path: string) => string;
} = {}): ToolCommands {
  if (platform === "win32") {
    const defaultRoot = win32.join(systemDrive, "QMK_MSYS");
    if (qmkMsysRoot) {
      const installation = inspectQmkMsysRoot(qmkMsysRoot, {
        pathExists,
        readTextFile,
      });
      return qmkMsysToolCommands({ ...installation, pathEnv });
    }
    if (isQmkMsysRoot(defaultRoot, pathExists)) {
      return qmkMsysToolCommands({
        root: defaultRoot,
        msystem: readQmkMsysSystem(defaultRoot, readTextFile),
        pathEnv,
      });
    }
  }

  return {
    qmk: { command: "qmk", argsPrefix: [] },
    git: { command: "git", argsPrefix: [] },
  };
}

export function validateQmkMsysRoot(
  root: string,
  {
    pathExists = existsSync,
    readTextFile = (path) => readFileSync(path, "utf8"),
  }: {
    pathExists?: (path: string) => boolean;
    readTextFile?: (path: string) => string;
  } = {},
): string {
  return inspectQmkMsysRoot(root, { pathExists, readTextFile }).root;
}

function qmkMsysBashPath(root: string): string {
  return win32.join(root, "usr", "bin", "bash.exe");
}

function isQmkMsysRoot(
  root: string,
  pathExists: (path: string) => boolean,
): boolean {
  return [
    qmkMsysBashPath(root),
    win32.join(root, "etc", "qmk-release"),
    win32.join(root, "shell_connector.cmd"),
  ].every(pathExists);
}

type QmkMsysSystem = "MINGW64" | "UCRT64";

function inspectQmkMsysRoot(
  root: string,
  {
    pathExists,
    readTextFile,
  }: {
    pathExists: (path: string) => boolean;
    readTextFile: (path: string) => string;
  },
): { root: string; msystem: QmkMsysSystem } {
  const normalizedRoot = root.trim();
  if (!normalizedRoot || !isQmkMsysRoot(normalizedRoot, pathExists)) {
    throw new Error(
      "Choose the QMK MSYS installation folder. It must contain shell_connector.cmd, etc\\qmk-release, and usr\\bin\\bash.exe",
    );
  }
  return {
    root: normalizedRoot,
    msystem: readQmkMsysSystem(normalizedRoot, readTextFile),
  };
}

function readQmkMsysSystem(
  root: string,
  readTextFile: (path: string) => string,
): QmkMsysSystem {
  const connectorPath = win32.join(root, "shell_connector.cmd");
  const match = readTextFile(connectorPath).match(
    /^\s*set\s+MSYSTEM=(MINGW64|UCRT64)\s*$/im,
  );
  if (!match) {
    throw new Error(
      `${connectorPath} does not declare a supported QMK MSYS environment`,
    );
  }
  return match[1] as QmkMsysSystem;
}

function qmkMsysToolCommands({
  root,
  pathEnv,
  msystem,
}: {
  root: string;
  pathEnv: string;
  msystem: QmkMsysSystem;
}): ToolCommands {
  const environmentDirectory = msystem.toLowerCase();
  const qmkCliPaths =
    msystem === "UCRT64"
      ? [
          win32.join(root, "opt", "qmk", "bin"),
          win32.join(root, "opt", "uv", "tools", "bin"),
        ]
      : [];
  // The Windows PATH must select this installation before Bash starts. If Git
  // for Windows starts another MSYS runtime first, changing PATH inside Bash is
  // too late and absolute MSYS paths can resolve against the Git installation.
  const env = {
    MSYSTEM: msystem,
    MSYS2_PATH_TYPE: "inherit",
    MSYS2_ENV_CONV_EXCL: "QMK_HOME",
    PATH: [
      ...qmkCliPaths,
      win32.join(root, environmentDirectory, "bin"),
      win32.join(root, "usr", "bin"),
      pathEnv,
    ]
      .filter(Boolean)
      .join(";"),
  };
  // Current QMK MSYS installs QMK CLI under /opt. Older official installers
  // place qmk.exe in the selected MinGW environment and need no extra exports.
  const setup =
    msystem === "UCRT64"
      ? "export PATH=/opt/qmk/bin:/opt/uv/tools/bin:/ucrt64/bin:/usr/local/bin:/usr/bin:/bin:$PATH; export QMK_DISTRIB_DIR=/opt/qmk; "
      : "";
  // qmk_cli looks for a firmware checkout in three places, in this order: the
  // working directory and its parents, `user.qmk_home` from the user's
  // qmk.ini, then $QMK_HOME. Entering the managed checkout is therefore the
  // only way to outrank a qmk.ini that points at the user's own clone. The
  // launcher is native Windows Python, so $QMK_HOME must reach it as a Windows
  // path; cygpath produces that value here instead of trusting MSYS2's
  // implicit conversion, and MSYS2_ENV_CONV_EXCL keeps MSYS2 from rewriting
  // what we chose.
  const qmkPrefix = [
    "--noprofile",
    "--norc",
    "-c",
    `${setup}export MSYS2_ENV_CONV_EXCL=QMK_HOME; export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; if [ -n "$QMK_HOME" ]; then qmk_unix=$(cygpath -u "$QMK_HOME" 2>/dev/null || printf '%s' "$QMK_HOME"); cd "$qmk_unix" || exit 1; QMK_HOME=$(cygpath -w "$qmk_unix" 2>/dev/null || printf '%s' "$QMK_HOME"); export QMK_HOME; fi; exec qmk "$@"`,
    "keyflare-qmk",
  ];
  const gitPrefix = [
    "--noprofile",
    "--norc",
    "-c",
    `${setup}export SHELL=/usr/bin/bash; export PYTHONUTF8=1; export MAKE=make; exec git "$@"`,
    "keyflare-git",
  ];
  const bashPath = qmkMsysBashPath(root);

  return {
    qmk: {
      command: bashPath,
      argsPrefix: qmkPrefix,
      env,
    },
    git: {
      command: bashPath,
      argsPrefix: gitPrefix,
      env,
    },
  };
}

export function createCommandRunner(): CommandRunner {
  return {
    run({
      command,
      args,
      cwd,
      env,
      acceptedExitCodes = [0],
    }: CommandRequest): Promise<CommandResult> {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          env: { ...process.env, ...env },
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code !== null && acceptedExitCodes.includes(code)) {
            resolve({ stdout, stderr });
            return;
          }

          const detail =
            stderr.trim() || stdout.trim() || "No diagnostic output";
          reject(
            new Error(
              `${command} ${args.join(" ")} failed (${code ?? "signal"}): ${detail}`,
            ),
          );
        });
      });
    },
  };
}

export class FirmwareBuildModule {
  readonly qmkHome: string;

  private readonly commandRunner: CommandRunner;
  private readonly copyDirectory: typeof cp;
  private readonly removeDirectory: typeof rm;
  private readonly moduleSourcePath: string;
  private readonly platform: NodeJS.Platform;
  private readonly toolCommandOverrides: Partial<ToolCommands>;
  private readonly toolCommandResolver: (
    qmkMsysRoot: string | undefined,
  ) => ToolCommands;
  private readonly workRoot: string;
  private buildInProgress = false;
  private inspectedTarget: TargetCapabilities | null = null;
  private qmkMsysRoot?: string;

  constructor({
    appDataPath,
    moduleSourcePath,
    commandRunner = createCommandRunner(),
    copyDirectory = cp,
    removeDirectory = rm,
    gitCommand,
    platform = process.platform,
    qmkMsysRoot,
    qmkCommand,
    toolCommandResolver = (configuredRoot) =>
      resolveToolCommands({ platform, qmkMsysRoot: configuredRoot }),
  }: FirmwareBuildModuleOptions) {
    this.qmkHome = join(appDataPath, "qmk_firmware");
    // QMK userspaces must sit outside qmk_firmware or QMK classifies their
    // community modules as firmware-owned paths and cannot resolve them.
    this.workRoot = join(appDataPath, "keyflare-work");
    this.commandRunner = commandRunner;
    this.copyDirectory = copyDirectory;
    this.removeDirectory = removeDirectory;
    this.moduleSourcePath = moduleSourcePath;
    this.platform = platform;
    if (qmkMsysRoot) {
      this.qmkMsysRoot = qmkMsysRoot;
    }
    this.toolCommandOverrides = {};
    if (gitCommand) {
      this.toolCommandOverrides.git = { command: gitCommand, argsPrefix: [] };
    }
    if (qmkCommand) {
      this.toolCommandOverrides.qmk = { command: qmkCommand, argsPrefix: [] };
    }
    this.toolCommandResolver = toolCommandResolver;
  }

  private async runTool(
    toolName: keyof ToolCommands,
    request: Omit<CommandRequest, "command" | "args"> & { args: string[] },
  ): Promise<CommandResult> {
    // Resolve default tools for every action so the setup screen can detect a
    // QMK MSYS installation without requiring the user to restart Keyflare.
    const tool =
      this.toolCommandOverrides[toolName] ??
      this.toolCommandResolver(this.qmkMsysRoot)[toolName];
    const commandRequest: CommandRequest = {
      ...request,
      command: tool.command,
      args: [...tool.argsPrefix, ...request.args],
    };
    // Only firmware-tree commands should pin QMK_HOME. `doctor` and
    // `--version` must keep the user's QMK MSYS CLI, or a stub qmk.exe
    // reports that `doctor` is not a valid command.
    const pinManagedHome =
      toolName === "qmk" && managedQmkCommands.has(request.args[0] ?? "");
    if (tool.env || request.env || pinManagedHome) {
      commandRequest.env = {
        ...tool.env,
        ...request.env,
        ...(pinManagedHome
          ? { QMK_HOME: this.qmkHome.replaceAll("\\", "/") }
          : {}),
      };
    }
    try {
      return await this.commandRunner.run(commandRequest);
    } catch (error) {
      throw pinManagedHome ? await this.explainStubQmkCli(error) : error;
    }
  }

  // The QMK launcher answers with an argparse error when it did not recognise
  // the checkout it found. That message names the command it rejected but not
  // the reason, so replace it with the files that failed the check.
  private async explainStubQmkCli(error: unknown): Promise<unknown> {
    const message = getErrorMessage(error);
    if (!message.includes("invalid choice")) return error;
    const missing = await findMissingFirmwareMarkers(this.qmkHome);
    return new Error(
      missing.length > 0
        ? `${message}\n\nQMK did not load its build commands because ${this.qmkHome} is missing ${missing.join(", ")}. Download the QMK source again.`
        : `${message}\n\nQMK did not load its build commands from ${this.qmkHome}, although that checkout is complete.`,
    );
  }

  validateQmkMsysRoot(root: string): string {
    return validateQmkMsysRoot(root);
  }

  setValidatedQmkMsysRoot(validatedRoot: string): void {
    this.qmkMsysRoot = validatedRoot;
  }

  async inspectEnvironment(): Promise<EnvironmentStatus> {
    try {
      const checks = await Promise.allSettled([
        this.runTool("qmk", {
          args: ["--version"],
        }),
        this.runTool("git", {
          args: ["--version"],
        }),
      ]);
      const failedCheck = checks.find((check) => check.status === "rejected");
      if (failedCheck?.status === "rejected") {
        throw failedCheck.reason;
      }
    } catch (error) {
      return {
        kind: "toolchain-required",
        canSelectQmkMsysRoot: this.platform === "win32",
        summary: "Install the supported QMK build environment",
        details: getErrorMessage(error),
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    }

    try {
      await stat(join(this.qmkHome, ".git"));
    } catch {
      return {
        kind: "source-required",
        canSelectQmkMsysRoot: this.platform === "win32",
        summary: "QMK is ready. Download Keyflare's pinned firmware source.",
        details: `Keyflare will store QMK ${qmkFirmwareRef.slice(0, 12)} in ${this.qmkHome}.`,
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    }

    try {
      const revision = await this.runTool("git", {
        args: ["rev-parse", "HEAD"],
        cwd: this.qmkHome,
      });
      const currentRevision = revision.stdout.trim();
      if (currentRevision !== qmkFirmwareRef) {
        return {
          kind: "source-required",
          canSelectQmkMsysRoot: this.platform === "win32",
          summary: "Update Keyflare's pinned QMK source",
          details: `Expected ${qmkFirmwareRef.slice(0, 12)}, found ${currentRevision.slice(0, 12)}.`,
          qmkHome: this.qmkHome,
          qmkRef: qmkFirmwareRef,
        };
      }

      // Matching HEAD only proves which commit was requested. A checkout that
      // stopped early keeps that HEAD, and QMK would then silently fall back
      // to the user's own clone or to its five built-in commands.
      const missingMarkers = await findMissingFirmwareMarkers(this.qmkHome);
      if (missingMarkers.length > 0) {
        return {
          kind: "source-required",
          canSelectQmkMsysRoot: this.platform === "win32",
          summary: "Download Keyflare's QMK source again",
          details: `${this.qmkHome} is missing ${missingMarkers.join(", ")}. QMK only offers its build commands from a complete checkout.`,
          qmkHome: this.qmkHome,
          qmkRef: qmkFirmwareRef,
        };
      }

      const doctor = await this.runTool("qmk", {
        args: ["doctor"],
        // Do not pin cwd/QMK_HOME. Doctor must use the user's QMK CLI so a
        // stub qmk.exe still exposes its host toolchain commands.
        acceptedExitCodes: [0, 1],
      });

      return {
        kind: "ready",
        canSelectQmkMsysRoot: this.platform === "win32",
        summary: "QMK build environment ready",
        details:
          doctor.stdout.trim() || doctor.stderr.trim() || "qmk doctor passed.",
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    } catch (error) {
      return {
        kind: "unhealthy",
        canSelectQmkMsysRoot: this.platform === "win32",
        summary: "QMK found a build-environment problem",
        details: getErrorMessage(error),
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    }
  }

  async initializeSource(): Promise<void> {
    this.inspectedTarget = null;
    await mkdir(this.qmkHome, { recursive: true });
    const gitDirectory = join(this.qmkHome, ".git");
    const hasRepository = await pathExists(gitDirectory);

    if (!hasRepository) {
      await this.runTool("git", {
        args: ["init"],
        cwd: this.qmkHome,
      });
    }

    // The checkout belongs to Keyflare, so keep one canonical upstream URL.
    // Re-establishing it also repairs setup interrupted between init and remote add.
    const remotes = await this.runTool("git", {
      args: ["remote"],
      cwd: this.qmkHome,
    });
    if (remotes.stdout.split(/\r?\n/u).includes("origin")) {
      await this.runTool("git", {
        args: ["remote", "set-url", "origin", qmkFirmwareUrl],
        cwd: this.qmkHome,
      });
    } else {
      await this.runTool("git", {
        args: ["remote", "add", "origin", qmkFirmwareUrl],
        cwd: this.qmkHome,
      });
    }

    // The managed checkout supplies QMK's compiler core, not its keyboard
    // catalog. The user's selected source is the only keyboard copied here.
    await this.runTool("git", {
      args: ["sparse-checkout", "set", "--no-cone", "/*", "!/keyboards/"],
      cwd: this.qmkHome,
    });
    await this.runTool("git", {
      args: [
        "fetch",
        "--depth",
        "1",
        "--filter=blob:none",
        "origin",
        qmkFirmwareRef,
      ],
      cwd: this.qmkHome,
    });
    // Without --force, a checkout that already sits on this commit leaves any
    // missing tracked file missing, so downloading again could never repair a
    // truncated checkout. The imported keyboards are untracked and sit outside
    // the sparse patterns, so --force does not touch them.
    await this.runTool("git", {
      args: ["checkout", "--detach", "--force", qmkFirmwareRef],
      cwd: this.qmkHome,
    });

    // git-submodule is one of the firmware's own subcommands, so the checkout
    // has to satisfy QMK's firmware check before it can run. Report the files
    // the checkout is missing rather than letting QMK reject the command.
    const missingMarkers = await findMissingFirmwareMarkers(this.qmkHome);
    if (missingMarkers.length > 0) {
      throw new Error(
        `The QMK checkout in ${this.qmkHome} is missing ${missingMarkers.join(", ")}. Delete that folder and download the source again.`,
      );
    }

    await this.runTool("qmk", {
      args: ["git-submodule", "--sync"],
      cwd: this.qmkHome,
    });
  }

  async importKeyboardSource(
    sourceDirectory: string,
  ): Promise<KeyboardSourceSelection> {
    const importedRoot = join(
      this.qmkHome,
      "keyboards",
      importedKeyboardNamespace,
    );
    const keyboardsRoot = join(this.qmkHome, "keyboards");
    const sourcePath = resolve(sourceDirectory);
    const importedPath = resolve(importedRoot);
    if (
      sourcePath === importedPath ||
      sourcePath.startsWith(`${importedPath}${sep}`) ||
      importedPath.startsWith(`${sourcePath}${sep}`)
    ) {
      throw new Error("Choose the original QMK keyboard source folder");
    }

    const definitions = await findKeyboardDefinitions(sourcePath);
    if (definitions.length === 0) {
      throw new Error(
        "Choose a QMK keyboard source folder that contains keyboard.json",
      );
    }

    const sourceName = basename(sourcePath);
    const sourceSlug = sanitizeKeyboardSourceName(sourceName);
    const stagingRoot = join(keyboardsRoot, `.keyflare-import-${randomUUID()}`);
    const backupRoot = join(
      keyboardsRoot,
      `.keyflare-import-backup-${randomUUID()}`,
    );
    await mkdir(keyboardsRoot, { recursive: true });
    try {
      await this.copyDirectory(sourcePath, join(stagingRoot, sourceSlug), {
        recursive: true,
      });

      let previousSourceMoved = false;
      try {
        await rename(importedRoot, backupRoot);
        previousSourceMoved = true;
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      }

      try {
        await rename(stagingRoot, importedRoot);
      } catch (error) {
        if (previousSourceMoved) await rename(backupRoot, importedRoot);
        throw error;
      }

      // The second rename commits the replacement. From this point onward the
      // UI and capability cache must describe the new source even if cleanup
      // of the old backup fails.
      this.inspectedTarget = null;
      if (previousSourceMoved) {
        await this.removeDirectory(backupRoot, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    await this.normalizeImportedKeyboards(join(importedRoot, sourceSlug));
    const actualDefinitions = await findKeyboardDefinitions(importedRoot).catch(
      () => definitions,
    );
    return {
      name: sourceName,
      targets: actualDefinitions.map((definition) =>
        [importedKeyboardNamespace, definition].filter(Boolean).join("/"),
      ),
    };
  }

  async inspectTarget(target: string): Promise<TargetCapabilities> {
    if (this.inspectedTarget?.target === target) {
      return this.inspectedTarget;
    }

    let info: CommandResult;
    try {
      info = await this.runTool("qmk", {
        args: ["info", "-kb", target, "-f", "json"],
        cwd: this.qmkHome,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.includes("invalid keyboard_folder")) {
        const actual = await this.findActualKeyboardTarget(target);
        if (actual && actual !== target) {
          info = await this.runTool("qmk", {
            args: ["info", "-kb", actual, "-f", "json"],
            cwd: this.qmkHome,
          });
          target = actual;
        } else {
          const available = await this.listImportedKeyboards().catch(() => []);
          throw new Error(
            `${message} Choose a self-contained QMK keyboard source folder and try again.` +
              (available.length
                ? ` Found keyboard(s): ${available.join(", ")}.`
                : "") +
              ` Looked for ${target} under ${join(this.qmkHome, "keyboards", importedKeyboardNamespace)}.`,
          );
        }
      } else {
        throw error;
      }
    }
    const keymap = await this.loadDefaultKeymap(target).catch(() => undefined);
    const infoResult = info;

    this.inspectedTarget = {
      ...normalizeQmkInfo({
        target,
        info: parseJson(infoResult.stdout, "QMK keyboard metadata"),
        keymap,
      }),
      hasVialKeymap: await this.targetHasVialKeymap(target),
    };
    return this.inspectedTarget;
  }

  async build(input: BuildRequest): Promise<BuildResult> {
    if (this.buildInProgress) {
      throw new Error("A firmware build is already running");
    }

    const request = buildRequestSchema.parse(input);
    this.buildInProgress = true;
    let workDirectory: string | undefined;
    let qmkBuildDirectory: string | undefined;
    let qmkRootArtifactPath: string | undefined;
    try {
      await mkdir(this.workRoot, { recursive: true });
      workDirectory = await mkdtemp(join(this.workRoot, "build-"));
      const capabilities = await this.inspectTarget(request.target);
      assertDeclaredSelection({ capabilities, channels: request.channels });
      const selectedChannels = request.channels.map(
        (id) =>
          capabilities.channels.find((channel) => channel.id === id) ?? {
            id,
            kind: "indicator" as const,
            label: id,
          },
      );
      for (const channel of selectedChannels) {
        if (channel.kind !== "rgb-indicator") continue;
        const led =
          request.indicatorLeds?.[channel.id as "caps_lock" | "scroll_lock"];
        if (led === undefined) {
          throw new Error(
            `Select an indicator LED for ${channel.label} before building`,
          );
        }
      }
      await this.prepareBuildUserspace(
        workDirectory,
        selectedChannels,
        request.indicatorLeds,
        request.indicatorColors,
      );
      const compiled = await this.compileFirmware({
        request,
        workDirectory,
      });
      qmkBuildDirectory = compiled.qmkBuildDirectory;
      const artifactPath = await findFirmwareArtifact(workDirectory);
      qmkRootArtifactPath = join(this.qmkHome, basename(artifactPath));
      const artifactExtension = getExtension(artifactPath);

      return {
        artifactName: `${sanitizeFileNameSegment(request.target)}_${sanitizeFileNameSegment(compiled.keymapName)}.${artifactExtension}`,
        artifact: await readFile(artifactPath),
        ...compiled.output,
      };
    } finally {
      this.buildInProgress = false;
      await Promise.all([
        workDirectory
          ? rm(workDirectory, { recursive: true, force: true })
          : Promise.resolve(),
        qmkBuildDirectory
          ? rm(qmkBuildDirectory, { recursive: true, force: true })
          : Promise.resolve(),
        qmkRootArtifactPath
          ? rm(qmkRootArtifactPath, { force: true })
          : Promise.resolve(),
      ]);
    }
  }

  private async loadKeymap({
    target,
    keymap,
  }: {
    target: string;
    keymap: BuildRequest["keymap"];
  }): Promise<unknown> {
    if (keymap.kind === "file") {
      const source = parseJson(
        await readFile(keymap.path, "utf8"),
        "QMK keymap",
      );
      return target.startsWith(`${importedKeyboardNamespace}/`)
        ? retargetKeymapDocument(source, target, "QMK keymap")
        : source;
    }

    return this.loadDefaultKeymap(target);
  }

  private async loadDefaultKeymap(target: string): Promise<unknown> {
    const keyboardRoot = resolve(this.qmkHome, "keyboards");
    let targetDirectory = resolve(keyboardRoot, target);
    if (
      targetDirectory !== keyboardRoot &&
      !targetDirectory.startsWith(`${keyboardRoot}${sep}`)
    ) {
      throw new Error("Invalid QMK keyboard target path");
    }

    while (targetDirectory !== keyboardRoot) {
      const jsonPath = join(
        targetDirectory,
        "keymaps",
        "default",
        "keymap.json",
      );
      if (await pathExists(jsonPath)) {
        return retargetKeymapDocument(
          parseJson(await readFile(jsonPath, "utf8"), "default QMK keymap"),
          target,
        );
      }
      const cPath = join(targetDirectory, "keymaps", "default", "keymap.c");
      if (await pathExists(cPath)) {
        const converted = await this.runTool("qmk", {
          args: ["c2json", "-kb", target, "-km", "default"],
          cwd: this.qmkHome,
        });
        return retargetKeymapDocument(
          parseJson(converted.stdout, "default QMK keymap"),
          target,
        );
      }
      targetDirectory = resolve(targetDirectory, "..");
    }

    // This fallback lets QMK resolve a community-layout keymap outside the
    // selected keyboard family. QMK remains the authority for that search.
    const converted = await this.runTool("qmk", {
      args: ["c2json", "-kb", target, "-km", "default"],
      cwd: this.qmkHome,
    });
    return retargetKeymapDocument(
      parseJson(converted.stdout, "default QMK keymap"),
      target,
    );
  }

  private async compileFirmware({
    request,
    workDirectory,
  }: {
    request: BuildRequest;
    workDirectory: string;
  }): Promise<{
    keymapName: string;
    qmkBuildDirectory: string;
    output: CommandResult;
  }> {
    // Vial firmware is a C keymap with vial.json and VIAL_ENABLE. Converting
    // it to keymap.json would drop those files and produce a non-Vial UF2.
    if (request.keymap.kind === "vial") {
      if (!(await this.targetHasVialKeymap(request.target))) {
        throw new Error("This keyboard has no Vial keymap");
      }
      const output = await this.runTool("qmk", {
        args: [
          "compile",
          "-kb",
          request.target,
          "-km",
          "vial",
          "-e",
          `QMK_USERSPACE=${workDirectory}`,
        ],
        cwd: this.qmkHome,
        env: { QMK_USERSPACE: workDirectory },
      });
      return {
        keymapName: "vial",
        qmkBuildDirectory: join(
          this.qmkHome,
          ".build",
          `obj_${request.target.replaceAll("/", "_")}_vial`,
        ),
        output,
      };
    }

    const source = await this.loadKeymap({
      target: request.target,
      keymap: request.keymap,
    });
    const keymap = prepareKeymapDocument({ source, target: request.target });
    const buildKeymapName = `keyflare_${basename(workDirectory).replaceAll(/[^a-zA-Z0-9]/gu, "_")}`;
    const keymapPath = join(workDirectory, "keymap.json");
    await writeFile(
      keymapPath,
      `${JSON.stringify({ ...keymap, keymap: buildKeymapName }, null, 2)}\n`,
      "utf8",
    );
    const output = await this.runTool("qmk", {
      args: ["compile", keymapPath, "-e", `QMK_USERSPACE=${workDirectory}`],
      cwd: this.qmkHome,
      // QMK's Python layer detects modules from the environment. The -e
      // argument passes the same userspace through to Make.
      env: { QMK_USERSPACE: workDirectory },
    });
    return {
      keymapName: keymap.keymap ?? "default_json",
      qmkBuildDirectory: join(
        this.qmkHome,
        ".build",
        `obj_${request.target.replaceAll("/", "_")}_${buildKeymapName}`,
      ),
      output,
    };
  }

  private async targetHasVialKeymap(target: string): Promise<boolean> {
    const keyboardRoot = resolve(this.qmkHome, "keyboards");
    let targetDirectory = resolve(keyboardRoot, target);
    if (
      targetDirectory !== keyboardRoot &&
      !targetDirectory.startsWith(`${keyboardRoot}${sep}`)
    ) {
      throw new Error("Invalid QMK keyboard target path");
    }
    while (targetDirectory !== keyboardRoot) {
      if (
        await pathExists(join(targetDirectory, "keymaps", "vial", "vial.json"))
      ) {
        return true;
      }
      targetDirectory = resolve(targetDirectory, "..");
    }
    return false;
  }

  private async findActualKeyboardTarget(
    target: string,
  ): Promise<string | undefined> {
    if (!target.startsWith(`${importedKeyboardNamespace}/`)) return undefined;
    const importedRoot = join(
      this.qmkHome,
      "keyboards",
      importedKeyboardNamespace,
    );
    const definitions = await findKeyboardDefinitions(importedRoot).catch(
      () => [],
    );
    const available = definitions.map((definition) =>
      [importedKeyboardNamespace, definition].filter(Boolean).join("/"),
    );
    if (available.includes(target)) return target;
    const suffix = target.split("/").pop() ?? "";
    if (!suffix) return available[0];
    const candidate = available.find(
      (candidate) =>
        candidate === `${importedKeyboardNamespace}/${suffix}` ||
        candidate.endsWith(`/${suffix}`),
    );
    return candidate ?? available[0];
  }

  private async listImportedKeyboards(): Promise<string[]> {
    const importedRoot = join(
      this.qmkHome,
      "keyboards",
      importedKeyboardNamespace,
    );
    const definitions = await findKeyboardDefinitions(importedRoot).catch(
      () => [],
    );
    return definitions.map((definition) =>
      [importedKeyboardNamespace, definition].filter(Boolean).join("/"),
    );
  }

  private async normalizeImportedKeyboards(
    importedKeyboardRoot: string,
  ): Promise<void> {
    const definitions = await findKeyboardDefinitions(importedKeyboardRoot);
    await Promise.all(
      definitions.map((definition) =>
        this.normalizeKeyboardDefinition(
          join(importedKeyboardRoot, definition, "keyboard.json"),
        ),
      ),
    );
  }

  private async normalizeKeyboardDefinition(
    keyboardJsonPath: string,
  ): Promise<void> {
    let parsed: unknown;
    try {
      parsed = parseJson(
        await readFile(keyboardJsonPath, "utf8"),
        "keyboard definition",
      );
    } catch {
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return;
    }
    const data = parsed as Record<string, unknown>;
    let changed = false;
    const modules = Array.isArray(data.modules)
      ? data.modules.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    if (!modules.includes(keyflareModuleName)) {
      data.modules = [...modules, keyflareModuleName];
      changed = true;
    }
    const rgbMatrix = data.rgb_matrix;
    if (
      rgbMatrix &&
      typeof rgbMatrix === "object" &&
      !Array.isArray(rgbMatrix)
    ) {
      const rgb = rgbMatrix as Record<string, unknown>;
      if (Array.isArray(rgb.leds) && !Array.isArray(rgb.layout)) {
        rgb.layout = rgb.leds;
        changed = true;
      }
    }
    if (changed) {
      await writeFile(
        keyboardJsonPath,
        `${JSON.stringify(data, null, 4)}\n`,
        "utf8",
      );
    }
  }

  private async prepareBuildUserspace(
    workDirectory: string,
    channels: Array<Pick<DeclaredChannel, "id" | "kind">>,
    indicatorLeds?: BuildRequest["indicatorLeds"],
    indicatorColors?: BuildRequest["indicatorColors"],
  ): Promise<void> {
    const destination = join(workDirectory, "modules", "keyflare", "reactive");
    await cp(this.moduleSourcePath, destination, { recursive: true });
    await Promise.all([
      writeFile(
        join(workDirectory, "qmk.json"),
        '{"userspace_version":"1.1","build_targets":[]}\n',
        "utf8",
      ),
      writeFile(
        join(destination, "config.h"),
        renderReactiveModuleConfig({
          channels,
          indicatorLeds,
          indicatorColors,
        }),
        "utf8",
      ),
    ]);
  }
}

export function prepareKeymapDocument({
  source,
  target,
}: {
  source: unknown;
  target: string;
}): KeymapDocument {
  const parsed = keymapSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid QMK keymap: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.keyboard !== target) {
    throw new Error(
      `This keymap belongs to ${parsed.data.keyboard}, not ${target}`,
    );
  }

  if (parsed.data.modules?.includes(keyflareModuleName)) {
    return parsed.data;
  }

  return {
    ...parsed.data,
    modules: [...(parsed.data.modules ?? []), keyflareModuleName],
  };
}

function retargetKeymapDocument(
  source: unknown,
  target: string,
  description = "default QMK keymap",
): KeymapDocument {
  const parsed = keymapSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid ${description}: ${z.prettifyError(parsed.error)}`);
  }
  // Imported sources live under Keyflare's private QMK namespace. The keymap
  // still describes the same keyboard, but QMK must build its imported target.
  return { ...parsed.data, keyboard: target };
}

export async function findFirmwareArtifact(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const artifacts = entries.filter(
    (entry) =>
      entry.isFile() && firmwareExtensions.has(getExtension(entry.name)),
  );
  const artifact = artifacts[0];
  if (!artifact) {
    throw new Error("QMK completed without producing a firmware artifact");
  }
  if (artifacts.length > 1) {
    throw new Error("QMK produced multiple firmware artifacts");
  }
  return join(directory, artifact.name);
}

function assertDeclaredSelection({
  capabilities,
  channels,
}: {
  capabilities: TargetCapabilities;
  channels: ChannelId[];
}): void {
  const declared = new Set(capabilities.channels.map((channel) => channel.id));
  const unsupported = channels.filter((channel) => !declared.has(channel));
  if (unsupported.length > 0) {
    throw new Error(
      `The selected target does not declare: ${unsupported.join(", ")}`,
    );
  }
}

function parseJson(input: string, description: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch (error) {
    throw new Error(
      `${description} is not valid JSON: ${getErrorMessage(error)}`,
    );
  }
}

function getExtension(fileName: string): string {
  const separator = fileName.lastIndexOf(".");
  return separator === -1 ? "" : fileName.slice(separator + 1).toLowerCase();
}

function sanitizeFileNameSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/gu, "_");
}

function sanitizeKeyboardSourceName(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return sanitized || "keyboard";
}

async function findKeyboardDefinitions(
  sourceDirectory: string,
): Promise<string[]> {
  const source = await stat(sourceDirectory).catch(() => null);
  if (!source?.isDirectory()) {
    throw new Error("Choose a QMK keyboard source folder");
  }

  const definitions: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new Error("QMK keyboard source folders cannot contain symlinks");
      }
      if (entry.isFile() && entry.name === "keyboard.json") {
        const definition = relative(sourceDirectory, directory)
          .split(sep)
          .filter(Boolean)
          .join("/");
        definitions.push(definition);
      } else if (entry.isDirectory() && entry.name !== "keymaps") {
        await visit(join(directory, entry.name));
      }
    }
  }

  await visit(sourceDirectory);
  return definitions.sort((left, right) => left.localeCompare(right));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const managedQmkCommands = new Set([
  "info",
  "compile",
  "c2json",
  "git-submodule",
]);

// qmk_cli only adds the firmware's own subcommands - the ones above - after
// its is_qmk_firmware() check accepts a checkout. Every one of these files
// must be present or the launcher keeps its five built-in commands and
// argparse rejects `info` as an invalid choice. Keep in sync with
// qmk_cli/helpers.py:is_qmk_firmware.
const qmkFirmwareMarkers = [
  "quantum",
  "requirements.txt",
  "requirements-dev.txt",
  "lib/python/qmk/cli/__init__.py",
];

async function findMissingFirmwareMarkers(qmkHome: string): Promise<string[]> {
  const found = await Promise.all(
    qmkFirmwareMarkers.map(async (marker) =>
      (await pathExists(join(qmkHome, ...marker.split("/")))) ? null : marker,
    ),
  );
  return found.filter((marker): marker is string => marker !== null);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
