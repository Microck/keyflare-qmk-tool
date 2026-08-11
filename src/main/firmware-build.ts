import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, win32 } from "node:path";

import { z } from "zod";

import {
  channelIdSchema,
  normalizeQmkInfo,
  type ChannelId,
  type TargetCapabilities,
} from "../shared/keyflare-contract";
import type { EnvironmentStatus } from "../shared/keyflare-api";
import { renderReactiveModuleConfig } from "./reactive-module";

export const qmkFirmwareRef = "9caa5f871ddb9813c7370708be62d7a3e1cfeb75";
const qmkFirmwareUrl = "https://github.com/qmk/qmk_firmware.git";
const keyflareModuleName = "keyflare/reactive";
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
  keymap: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("default") }),
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
}

export function resolveToolCommands({
  platform = process.platform,
  qmkMsysRoot,
  systemDrive = process.env.SystemDrive ?? "C:",
  pathExists = existsSync,
}: {
  platform?: NodeJS.Platform;
  qmkMsysRoot?: string | undefined;
  systemDrive?: string;
  pathExists?: (path: string) => boolean;
} = {}): ToolCommands {
  if (platform === "win32") {
    const defaultRoot = win32.join(systemDrive, "QMK_MSYS");
    const defaultBashPath = qmkMsysBashPath(defaultRoot);
    const root =
      qmkMsysRoot ?? (pathExists(defaultBashPath) ? defaultRoot : null);
    if (root) {
      return qmkMsysToolCommands(qmkMsysBashPath(root));
    }
  }

  return {
    qmk: { command: "qmk", argsPrefix: [] },
    git: { command: "git", argsPrefix: [] },
  };
}

export function validateQmkMsysRoot(
  root: string,
  { pathExists = existsSync }: { pathExists?: (path: string) => boolean } = {},
): string {
  const normalizedRoot = root.trim();
  if (!normalizedRoot || !pathExists(qmkMsysBashPath(normalizedRoot))) {
    throw new Error(
      "Choose the QMK_MSYS folder that contains usr\\bin\\bash.exe",
    );
  }
  return normalizedRoot;
}

function qmkMsysBashPath(root: string): string {
  return win32.join(root, "usr", "bin", "bash.exe");
}

function qmkMsysToolCommands(bashPath: string): ToolCommands {
  // QMK MSYS installs qmk outside the standard MSYS path. The interactive QMK
  // shell adds these values through its startup files, but Keyflare needs a
  // quiet, deterministic shell that does not print the welcome prompt.
  const env = {
    MSYSTEM: "UCRT64",
    MSYS2_PATH_TYPE: "inherit",
  };
  const qmkMsysPath =
    "/opt/qmk/bin:/opt/uv/tools/bin:/ucrt64/bin:/usr/local/bin:/usr/bin:/bin:$PATH";
  const commandPrefix = (tool: "qmk" | "git", processName: string) => [
    "--noprofile",
    "--norc",
    "-c",
    `export PATH=${qmkMsysPath}; export QMK_DISTRIB_DIR=/opt/qmk; export PYTHONUTF8=1; export MAKE=make; exec ${tool} "$@"`,
    processName,
  ];

  return {
    qmk: {
      command: bashPath,
      argsPrefix: commandPrefix("qmk", "keyflare-qmk"),
      env,
    },
    git: {
      command: bashPath,
      argsPrefix: commandPrefix("git", "keyflare-git"),
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

  private runTool(
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
    if (tool.env || request.env) {
      commandRequest.env = { ...tool.env, ...request.env };
    }
    return this.commandRunner.run(commandRequest);
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
      const [doctor, revision] = await Promise.all([
        this.runTool("qmk", {
          args: ["doctor"],
          cwd: this.qmkHome,
          // QMK uses exit 1 for minor warnings such as absent flashing udev rules.
          // Those warnings do not prevent Keyflare's compile-only workflow.
          acceptedExitCodes: [0, 1],
        }),
        this.runTool("git", {
          args: ["rev-parse", "HEAD"],
          cwd: this.qmkHome,
        }),
      ]);
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

    await this.runTool("git", {
      args: ["fetch", "--depth", "1", "origin", qmkFirmwareRef],
      cwd: this.qmkHome,
    });
    await this.runTool("git", {
      args: ["checkout", "--detach", qmkFirmwareRef],
      cwd: this.qmkHome,
    });

    await this.runTool("qmk", {
      args: ["git-submodule", "--sync"],
      cwd: this.qmkHome,
    });
  }

  async listTargets(): Promise<string[]> {
    const result = await this.runTool("qmk", {
      args: ["list-keyboards"],
      cwd: this.qmkHome,
    });
    return parseKeyboardTargets(result.stdout);
  }

  async inspectTarget(target: string): Promise<TargetCapabilities> {
    if (this.inspectedTarget?.target === target) {
      return this.inspectedTarget;
    }

    const result = await this.runTool("qmk", {
      args: ["info", "-kb", target, "-f", "json"],
      cwd: this.qmkHome,
    });

    this.inspectedTarget = normalizeQmkInfo({
      target,
      info: parseJson(result.stdout, "QMK keyboard metadata"),
    });
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
      const source = await this.loadKeymap({
        target: request.target,
        keymap: request.keymap,
        workDirectory,
      });
      const keymap = prepareKeymapDocument({ source, target: request.target });
      await this.prepareBuildUserspace(workDirectory, request.channels);

      const buildKeymapName = `keyflare_${basename(workDirectory).replaceAll(/[^a-zA-Z0-9]/gu, "_")}`;
      qmkBuildDirectory = join(
        this.qmkHome,
        ".build",
        `obj_${request.target.replaceAll("/", "_")}_${buildKeymapName}`,
      );
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
      const artifactPath = await findFirmwareArtifact(workDirectory);
      qmkRootArtifactPath = join(this.qmkHome, basename(artifactPath));
      const artifactExtension = getExtension(artifactPath);

      return {
        artifactName: `${sanitizeFileNameSegment(request.target)}_${sanitizeFileNameSegment(keymap.keymap ?? "default_json")}.${artifactExtension}`,
        artifact: await readFile(artifactPath),
        ...output,
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
    workDirectory,
  }: {
    target: string;
    keymap: BuildRequest["keymap"];
    workDirectory: string;
  }): Promise<unknown> {
    if (keymap.kind === "file") {
      return parseJson(await readFile(keymap.path, "utf8"), "QMK keymap");
    }

    const outputPath = join(workDirectory, "default-keymap.json");
    await this.runTool("qmk", {
      args: ["c2json", "-kb", target, "-km", "default", "-o", outputPath],
      cwd: this.qmkHome,
    });
    return parseJson(await readFile(outputPath, "utf8"), "default QMK keymap");
  }

  private async prepareBuildUserspace(
    workDirectory: string,
    channels: ChannelId[],
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
        renderReactiveModuleConfig({ channels }),
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

export function parseKeyboardTargets(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
