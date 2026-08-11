// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type {
  BuildAndSaveInput,
  EnvironmentStatus,
  KeyflareApi,
  SaveResult,
} from "../shared/keyflare-api";
import type { TargetCapabilities } from "../shared/keyflare-contract";
import { App } from "./app";

const readyEnvironment: EnvironmentStatus = {
  kind: "ready",
  summary: "QMK build environment ready",
  details: "qmk doctor passed.",
  qmkHome: "/app-data/qmk_firmware",
  qmkRef: "9caa5f871ddb",
};

const scrollLockOnlyTarget: TargetCapabilities = {
  target: "test/scroll-pad",
  keyboardName: "Scroll Pad",
  channels: [
    { id: "scroll_lock", kind: "indicator", label: "Scroll Lock indicator" },
  ],
  layouts: [
    {
      name: "LAYOUT",
      keys: [
        { row: 0, column: 0, x: 0, y: 0, width: 1, height: 1, label: "A" },
        { row: 0, column: 1, x: 1, y: 0, width: 1, height: 1, label: "B" },
      ],
    },
  ],
};

class InMemoryKeyflareApi implements KeyflareApi {
  readonly builds: BuildAndSaveInput[] = [];
  readonly windowCalls: string[] = [];
  private maximized = false;
  private readonly maximizeListeners = new Set<(maximized: boolean) => void>();

  constructor(
    private environment: EnvironmentStatus,
    private readonly capabilities: TargetCapabilities = scrollLockOnlyTarget,
    private readonly targets = [capabilities.target, "test/unsupported"],
  ) {}

  async getEnvironment(): Promise<EnvironmentStatus> {
    return this.environment;
  }

  async initializeSource(): Promise<EnvironmentStatus> {
    this.environment = readyEnvironment;
    return this.environment;
  }

  async listTargets(): Promise<string[]> {
    return this.targets;
  }

  async inspectTarget(): Promise<TargetCapabilities> {
    return this.capabilities;
  }

  async selectKeymap(): Promise<{ name: string }> {
    return { name: "custom-keymap.json" };
  }

  async buildAndSave(input: BuildAndSaveInput): Promise<SaveResult> {
    this.builds.push(input);
    return {
      kind: "saved",
      fileName: "test_scroll_pad_default.hex",
      savedPath: "/firmware/test_scroll_pad_default.hex",
    };
  }

  async isWindowMaximized(): Promise<boolean> {
    return this.maximized;
  }

  onWindowMaximizedChange(listener: (maximized: boolean) => void): () => void {
    this.maximizeListeners.add(listener);
    return () => this.maximizeListeners.delete(listener);
  }

  async minimizeWindow(): Promise<void> {
    this.windowCalls.push("minimize");
  }

  async toggleMaximizeWindow(): Promise<void> {
    this.windowCalls.push("toggle-maximize");
    this.maximized = !this.maximized;
    this.maximizeListeners.forEach((listener) => listener(this.maximized));
  }

  async closeWindow(): Promise<void> {
    this.windowCalls.push("close");
  }
}

describe("Keyflare", () => {
  it("controls the window and labels the current maximize action", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment);
    const user = userEvent.setup();
    render(<App api={api} />);

    await screen.findByLabelText("Keyboard target");
    await user.click(screen.getByRole("button", { name: "Minimize" }));
    await user.click(screen.getByRole("button", { name: "Maximize" }));
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(api.windowCalls).toEqual([
      "minimize",
      "toggle-maximize",
      "toggle-maximize",
      "close",
    ]);
  });

  it("explains how to recover when the QMK toolchain is missing", async () => {
    const api = new InMemoryKeyflareApi({
      ...readyEnvironment,
      kind: "toolchain-required",
      summary: "Install the supported QMK build environment",
      details: "qmk was not found",
    });
    render(<App api={api} />);

    expect(
      await screen.findByRole("heading", {
        name: "Install QMK before you build",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Keyflare uses QMK's supported build tools/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Build firmware" }),
    ).not.toBeInTheDocument();
  });

  it("downloads the pinned source before showing the configuration flow", async () => {
    const api = new InMemoryKeyflareApi({
      ...readyEnvironment,
      kind: "source-required",
      summary: "Download pinned QMK source",
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Download QMK source" }),
    );
    expect(await screen.findByLabelText("Keyboard target")).toBeInTheDocument();
  });

  it("shows only declared channels and saves a compiled artifact", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.type(
      await screen.findByLabelText("Keyboard target"),
      "test/scroll-pad",
    );
    await user.click(screen.getByRole("button", { name: "Load keyboard" }));

    expect(await screen.findByText("Scroll Pad")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Scroll Lock indicator" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Backlight/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/color/iu)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Keyboard layout preview")).toHaveTextContent(
      "A",
    );

    await user.click(
      screen.getByRole("checkbox", { name: "Scroll Lock indicator" }),
    );
    await user.click(screen.getByRole("button", { name: "Build firmware" }));

    expect(
      await screen.findByText("Saved test_scroll_pad_default.hex"),
    ).toBeInTheDocument();
    expect(api.builds).toEqual([
      {
        target: "test/scroll-pad",
        channels: ["scroll_lock"],
        keymap: "default",
      },
    ]);
  });

  it("requires a selected imported keymap before building", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.type(
      await screen.findByLabelText("Keyboard target"),
      "test/scroll-pad",
    );
    await user.click(screen.getByRole("button", { name: "Load keyboard" }));
    await screen.findByText("Scroll Pad");
    await user.click(screen.getByRole("radio", { name: "Import keymap.json" }));

    expect(
      screen.getByRole("button", { name: "Build firmware" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Select keymap.json" }),
    );
    await waitFor(() => {
      expect(screen.getByText("custom-keymap.json")).toBeInTheDocument();
    });
  });

  it("limits target suggestions while searching a large QMK catalog", async () => {
    const targets = Array.from(
      { length: 3_000 },
      (_, index) => `vendor/board-${index}`,
    );
    const api = new InMemoryKeyflareApi(
      readyEnvironment,
      scrollLockOnlyTarget,
      targets,
    );
    const user = userEvent.setup();
    const { container } = render(<App api={api} />);

    await user.type(await screen.findByLabelText("Keyboard target"), "board-1");

    await waitFor(() => {
      expect(container.querySelectorAll("#target-options option")).toHaveLength(
        50,
      );
    });
  });
});
