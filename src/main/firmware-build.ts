import { spawn } from "node:child_process";
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
import { basename, join } from "node:path";

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
  qmkCommand?: string;
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
  private readonly gitCommand: string;
  private readonly moduleSourcePath: string;
  private readonly qmkCommand: string;
  private readonly workRoot: string;
  private buildInProgress = false;
  private inspectedTarget: TargetCapabilities | null = null;

  constructor({
    appDataPath,
    moduleSourcePath,
    commandRunner = createCommandRunner(),
    gitCommand = "git",
    qmkCommand = "qmk",
  }: FirmwareBuildModuleOptions) {
    this.qmkHome = join(appDataPath, "qmk_firmware");
    // QMK userspaces must sit outside qmk_firmware or QMK classifies their
    // community modules as firmware-owned paths and cannot resolve them.
    this.workRoot = join(appDataPath, "keyflare-work");
    this.commandRunner = commandRunner;
    this.gitCommand = gitCommand;
    this.moduleSourcePath = moduleSourcePath;
    this.qmkCommand = qmkCommand;
  }

  async inspectEnvironment(): Promise<EnvironmentStatus> {
    try {
      const checks = await Promise.allSettled([
        this.commandRunner.run({
          command: this.qmkCommand,
          args: ["--version"],
        }),
        this.commandRunner.run({
          command: this.gitCommand,
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
        summary: "QMK is ready. Download Keyflare's pinned firmware source.",
        details: `Keyflare will store QMK ${qmkFirmwareRef.slice(0, 12)} in ${this.qmkHome}.`,
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    }

    try {
      const [doctor, revision] = await Promise.all([
        this.commandRunner.run({
          command: this.qmkCommand,
          args: ["doctor"],
          cwd: this.qmkHome,
          // QMK uses exit 1 for minor warnings such as absent flashing udev rules.
          // Those warnings do not prevent Keyflare's compile-only workflow.
          acceptedExitCodes: [0, 1],
        }),
        this.commandRunner.run({
          command: this.gitCommand,
          args: ["rev-parse", "HEAD"],
          cwd: this.qmkHome,
        }),
      ]);
      const currentRevision = revision.stdout.trim();
      if (currentRevision !== qmkFirmwareRef) {
        return {
          kind: "source-required",
          summary: "Update Keyflare's pinned QMK source",
          details: `Expected ${qmkFirmwareRef.slice(0, 12)}, found ${currentRevision.slice(0, 12)}.`,
          qmkHome: this.qmkHome,
          qmkRef: qmkFirmwareRef,
        };
      }

      return {
        kind: "ready",
        summary: "QMK build environment ready",
        details:
          doctor.stdout.trim() || doctor.stderr.trim() || "qmk doctor passed.",
        qmkHome: this.qmkHome,
        qmkRef: qmkFirmwareRef,
      };
    } catch (error) {
      return {
        kind: "unhealthy",
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
      await this.commandRunner.run({
        command: this.gitCommand,
        args: ["init"],
        cwd: this.qmkHome,
      });
    }

    // The checkout belongs to Keyflare, so keep one canonical upstream URL.
    // Re-establishing it also repairs setup interrupted between init and remote add.
    const remotes = await this.commandRunner.run({
      command: this.gitCommand,
      args: ["remote"],
      cwd: this.qmkHome,
    });
    if (remotes.stdout.split(/\r?\n/u).includes("origin")) {
      await this.commandRunner.run({
        command: this.gitCommand,
        args: ["remote", "set-url", "origin", qmkFirmwareUrl],
        cwd: this.qmkHome,
      });
    } else {
      await this.commandRunner.run({
        command: this.gitCommand,
        args: ["remote", "add", "origin", qmkFirmwareUrl],
        cwd: this.qmkHome,
      });
    }

    await this.commandRunner.run({
      command: this.gitCommand,
      args: ["fetch", "--depth", "1", "origin", qmkFirmwareRef],
      cwd: this.qmkHome,
    });
    await this.commandRunner.run({
      command: this.gitCommand,
      args: ["checkout", "--detach", qmkFirmwareRef],
      cwd: this.qmkHome,
    });

    await this.commandRunner.run({
      command: this.qmkCommand,
      args: ["git-submodule", "--sync"],
      cwd: this.qmkHome,
    });
  }

  async listTargets(): Promise<string[]> {
    const result = await this.commandRunner.run({
      command: this.qmkCommand,
      args: ["list-keyboards"],
      cwd: this.qmkHome,
    });
    return parseKeyboardTargets(result.stdout);
  }

  async inspectTarget(target: string): Promise<TargetCapabilities> {
    if (this.inspectedTarget?.target === target) {
      return this.inspectedTarget;
    }

    const result = await this.commandRunner.run({
      command: this.qmkCommand,
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
      const output = await this.commandRunner.run({
        command: this.qmkCommand,
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
    await this.commandRunner.run({
      command: this.qmkCommand,
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
