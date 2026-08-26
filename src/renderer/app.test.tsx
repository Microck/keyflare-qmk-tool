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
  canSelectQmkMsysRoot: false,
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
        {
          row: 0,
          column: 0,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          label: "Scroll Lock",
          keycode: "KC_SCRL",
        },
        { row: 0, column: 1, x: 1, y: 0, width: 1, height: 1, label: "B" },
      ],
    },
  ],
};

const fullSizeTarget: TargetCapabilities = {
  target: "test/full-size",
  keyboardName: "Full Size",
  channels: [
    { id: "backlight", kind: "backlight", label: "Backlight" },
    { id: "num_lock", kind: "indicator", label: "Num Lock indicator" },
    { id: "caps_lock", kind: "indicator", label: "Caps Lock indicator" },
  ],
  layouts: [
    {
      name: "LAYOUT",
      keys: [
        {
          row: 0,
          column: 0,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          label: "Caps Lock",
          keycode: "KC_CAPS_LOCK",
        },
        {
          row: 0,
          column: 1,
          x: 1,
          y: 0,
          width: 1,
          height: 1,
          label: "Num Lock",
          keycode: "KC_NUM_LOCK",
        },
        {
          row: 0,
          column: 2,
          x: 2,
          y: 0,
          width: 1,
          height: 1,
          label: "A",
          keycode: "KC_A",
        },
      ],
    },
  ],
};

const rgbMatrixTarget: TargetCapabilities = {
  target: "test/rgb-pad",
  keyboardName: "RGB Pad",
  channels: [{ id: "rgb_matrix", kind: "rgb", label: "RGB Matrix reactive" }],
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

const splitAlternatesTarget: TargetCapabilities = {
  target: "test/split-pad",
  keyboardName: "Split Pad",
  channels: [],
  layouts: [
    {
      name: "LAYOUT_all",
      keys: [
        { row: 0, column: 0, x: 0, y: 0, width: 1, height: 1, label: "Esc" },
        { row: 0, column: 1, x: 0, y: 0, width: 2, height: 1, label: "Esc 2U" },
        { row: 0, column: 2, x: 2, y: 0, width: 1, height: 1, label: "F1" },
      ],
    },
  ],
};

class InMemoryKeyflareApi implements KeyflareApi {
  readonly builds: BuildAndSaveInput[] = [];
  readonly qmkMsysSelections: string[] = [];
  readonly windowCalls: string[] = [];
  private maximized = false;
  private readonly maximizeListeners = new Set<(maximized: boolean) => void>();

  constructor(
    private environment: EnvironmentStatus,
    private readonly capabilities: TargetCapabilities = scrollLockOnlyTarget,
    private readonly targets = [capabilities.target],
  ) {}

  async getEnvironment(): Promise<EnvironmentStatus> {
    return this.environment;
  }

  async initializeSource(): Promise<EnvironmentStatus> {
    this.environment = readyEnvironment;
    return this.environment;
  }

  async selectKeyboardSource(): Promise<{
    name: string;
    targets: string[];
  }> {
    return { name: "scroll-pad", targets: this.targets };
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

  async selectQmkMsysRoot(): Promise<EnvironmentStatus | null> {
    this.qmkMsysSelections.push("selected");
    this.environment = readyEnvironment;
    return this.environment;
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

    await screen.findByRole("button", { name: "Choose keyboard folder" });
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
        name: "Set up QMK build tools",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Keyflare uses QMK's supported build tools/u),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Build firmware" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose QMK MSYS folder" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Setup progress" }),
    ).toHaveTextContent("QMK source");
    expect(screen.getByText("Technical details")).toBeInTheDocument();
  });

  it("lets Windows users select a custom QMK MSYS folder", async () => {
    const api = new InMemoryKeyflareApi({
      ...readyEnvironment,
      kind: "toolchain-required",
      canSelectQmkMsysRoot: true,
      summary: "Install the supported QMK build environment",
      details: "qmk was not found",
    });
    const user = userEvent.setup();
    render(<App api={api} />);

    expect(await screen.findByText("Windows setup")).toBeInTheDocument();
    expect(screen.queryByText(/^macOS:/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Linux:/u)).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: "Choose QMK MSYS folder" }),
    );

    expect(api.qmkMsysSelections).toEqual(["selected"]);
    expect(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    ).toBeInTheDocument();
  });

  it("lets Windows users replace an unhealthy QMK MSYS folder", async () => {
    const api = new InMemoryKeyflareApi({
      ...readyEnvironment,
      kind: "unhealthy",
      canSelectQmkMsysRoot: true,
      summary: "QMK found a build-environment problem",
      details: "qmk doctor failed",
    });
    render(<App api={api} />);

    expect(
      await screen.findByRole("button", { name: "Choose QMK MSYS folder" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    ).toBeInTheDocument();
  });

  it("shows only declared channels and saves a compiled artifact", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );

    expect(await screen.findByText("Scroll Pad")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Scroll Lock indicator" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Backlight/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/color/iu)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Keyboard layout preview")).toHaveTextContent(
      "Scroll Lock",
    );

    await user.click(
      screen.getByRole("checkbox", { name: "Scroll Lock indicator" }),
    );
    expect(
      document.querySelectorAll(".key-shape.output-selected"),
    ).toHaveLength(1);
    expect(
      screen.getByText("Scroll Lock indicator: Scroll Lock key"),
    ).toBeInTheDocument();
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

  it("treats rgb_matrix as a whole-board output", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment, rgbMatrixTarget);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );

    expect(
      await screen.findByRole("checkbox", { name: "RGB Matrix reactive" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "RGB Matrix reactive" }),
    );
    expect(
      document.querySelectorAll(".key-shape.output-selected"),
    ).toHaveLength(2);
    expect(
      screen.getByText("RGB Matrix reactive: all LEDs"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/hardware pin controls the LED/u),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Build firmware" }));
    expect(api.builds).toEqual([
      {
        target: "test/rgb-pad",
        channels: ["rgb_matrix"],
        keymap: "default",
      },
    ]);
  });

  it("ghosts stacked layout alternates in the preview", async () => {
    const api = new InMemoryKeyflareApi(
      readyEnvironment,
      splitAlternatesTarget,
    );
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );
    await screen.findByText("Split Pad");

    expect(document.querySelectorAll(".key")).toHaveLength(3);
    expect(document.querySelectorAll(".key-alternate")).toHaveLength(1);
  });
  it("requires a selected imported keymap before building", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );
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

  it("shows which logical keys each selected output represents", async () => {
    const api = new InMemoryKeyflareApi(readyEnvironment, fullSizeTarget);
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );
    await screen.findByText("Full Size");

    await user.click(screen.getByRole("checkbox", { name: "Backlight" }));
    expect(
      document.querySelectorAll(".key-shape.output-selected"),
    ).toHaveLength(3);
    expect(screen.getByText("Backlight: all keys")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Backlight" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Caps Lock indicator" }),
    );
    expect(
      document.querySelectorAll(".key-shape.output-selected"),
    ).toHaveLength(1);
    expect(
      screen.getByText("Caps Lock indicator: Caps Lock key"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: "Num Lock indicator" }),
    );
    expect(
      document.querySelectorAll(".key-shape.output-selected"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Num Lock indicator: Num Lock key"),
    ).toBeInTheDocument();
  });

  it("shows imported variants in an anchored in-app menu", async () => {
    const targets = [
      "keyflare_imported/board/v1",
      "keyflare_imported/board/v2",
    ];
    const api = new InMemoryKeyflareApi(
      readyEnvironment,
      scrollLockOnlyTarget,
      targets,
    );
    const user = userEvent.setup();
    render(<App api={api} />);

    await user.click(
      await screen.findByRole("button", { name: "Choose keyboard folder" }),
    );
    await user.click(screen.getByRole("button", { name: "Choose variant" }));
    expect(screen.getByRole("menu", { name: "Keyboard variants" })).toHaveClass(
      "variant-menu",
    );
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "v2" })).toHaveFocus();
    screen.getByRole("button", { name: "Choose variant" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "v1" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "v2" })).toHaveFocus();
    await user.click(screen.getByRole("menuitemradio", { name: "v2" }));
    expect(await screen.findByText("Scroll Pad")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "v2" })).toHaveFocus();
  });
});
