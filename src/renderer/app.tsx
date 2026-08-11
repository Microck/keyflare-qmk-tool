import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  FileJson,
  FolderOpen,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  RotateCw,
  Save,
  X,
} from "lucide-react";

import type {
  BuildAndSaveInput,
  EnvironmentStatus,
  KeyboardSourceSelection,
  KeyflareApi,
  SaveResult,
} from "../shared/keyflare-api";
import type {
  ChannelId,
  KeyboardLayout,
  TargetCapabilities,
} from "../shared/keyflare-contract";

type KeymapMode = BuildAndSaveInput["keymap"];
type UiError = { summary: string; details: string };

export function App({ api }: { api: KeyflareApi }) {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(
    null,
  );
  const [keyboardSource, setKeyboardSource] =
    useState<KeyboardSourceSelection | null>(null);
  const [target, setTarget] = useState("");
  const [capabilities, setCapabilities] = useState<TargetCapabilities | null>(
    null,
  );
  const [channels, setChannels] = useState<ChannelId[]>([]);
  const [keymapMode, setKeymapMode] = useState<KeymapMode>("default");
  const [importedKeymapName, setImportedKeymapName] = useState<string | null>(
    null,
  );
  const [layoutName, setLayoutName] = useState("");
  const [variantMenuOpen, setVariantMenuOpen] = useState(false);
  const variantTriggerRef = useRef<HTMLButtonElement>(null);
  const [busyAction, setBusyAction] = useState<
    "source" | "qmk-msys" | "target" | "keymap" | "build" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getEnvironment()
      .then(async (status) => {
        if (!active) return;
        setEnvironment(status);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError({
            summary: "Unable to check QMK",
            details: `${readError(reason)}. Check the QMK installation and try again.`,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

  const selectedLayout =
    capabilities?.layouts.find((layout) => layout.name === layoutName) ?? null;
  const canBuild = Boolean(
    capabilities &&
    channels.length > 0 &&
    (keymapMode === "default" || importedKeymapName) &&
    !busyAction,
  );

  async function downloadSource() {
    setBusyAction("source");
    setError(null);
    try {
      const status = await api.initializeSource();
      setEnvironment(status);
    } catch (reason) {
      setError({
        summary: "Unable to download QMK source",
        details: `${readError(reason)}. Check your connection and try the download again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function checkEnvironment() {
    setBusyAction("source");
    setError(null);
    try {
      const status = await api.getEnvironment();
      setEnvironment(status);
    } catch (reason) {
      setError({
        summary: "QMK is not ready",
        details: `${readError(reason)}. Repair the QMK setup and check it again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function selectQmkMsysRoot() {
    setBusyAction("qmk-msys");
    setError(null);
    try {
      const status = await api.selectQmkMsysRoot();
      if (status) {
        setEnvironment(status);
      }
    } catch (reason) {
      setError({
        summary: "Unable to use this QMK MSYS folder",
        details: `${readError(reason)}. Choose another QMK_MSYS folder and try again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function selectKeyboardSource() {
    setBusyAction("target");
    setError(null);
    setNotice(null);
    try {
      const selection = await api.selectKeyboardSource();
      if (!selection) return;
      setKeyboardSource(selection);
      setTarget("");
      setCapabilities(null);
      setChannels([]);
      if (selection.targets.length === 1) {
        await inspectSelectedTarget(selection.targets[0]!);
      }
    } catch (reason) {
      setError({
        summary: "Unable to import this keyboard",
        details: `${readError(reason)}. Choose a self-contained QMK keyboard source folder and try again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function selectTargetVariant(selectedTarget: string) {
    setVariantMenuOpen(false);
    setBusyAction("target");
    setError(null);
    setNotice(null);
    setCapabilities(null);
    setChannels([]);
    try {
      await inspectSelectedTarget(selectedTarget);
    } catch (reason) {
      setError({
        summary: "Unable to load this keyboard variant",
        details: `${readError(reason)}. Choose another target from this keyboard folder.`,
      });
    } finally {
      setBusyAction(null);
      variantTriggerRef.current?.focus();
    }
  }

  async function inspectSelectedTarget(selectedTarget: string) {
    const inspected = await api.inspectTarget(selectedTarget);
    setTarget(selectedTarget);
    setCapabilities(inspected);
    setLayoutName(inspected.layouts[0]?.name ?? "");
  }

  async function selectKeymap() {
    setBusyAction("keymap");
    setError(null);
    try {
      const selection = await api.selectKeymap();
      if (selection) {
        setImportedKeymapName(selection.name);
      }
    } catch (reason) {
      setError({
        summary: "Unable to import this keymap",
        details: `${readError(reason)}. Select a valid QMK keymap.json file.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function buildFirmware() {
    if (!capabilities || !canBuild) return;
    setBusyAction("build");
    setError(null);
    setNotice(null);
    try {
      const saved = await api.buildAndSave({
        target,
        channels,
        keymap: keymapMode,
      });
      setNotice(formatSaveNotice(saved));
    } catch (reason) {
      setError({
        summary: "Unable to build firmware",
        details: `${readError(reason)}. Fix the reported QMK problem, then build again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  function toggleChannel(channel: ChannelId) {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  }

  if (!environment) {
    return <LoadingScreen api={api} error={error} />;
  }

  if (environment.kind !== "ready") {
    return (
      <SetupScreen
        api={api}
        environment={environment}
        busyAction={
          busyAction === "source" || busyAction === "qmk-msys"
            ? busyAction
            : null
        }
        error={error}
        onDownload={downloadSource}
        onCheck={checkEnvironment}
        onSelectQmkMsysRoot={selectQmkMsysRoot}
      />
    );
  }

  return (
    <div className="app-shell">
      <TitleBar api={api} qmkRef={environment.qmkRef} />
      <main className="workspace">
        <section className="keyboard-workspace" aria-labelledby="page-title">
          <div className="keyboard-heading">
            <div>
              <span className="workspace-kicker">QMK target</span>
              <h1 id="page-title">
                {capabilities?.keyboardName ?? "Choose a keyboard"}
              </h1>
            </div>
            {capabilities && capabilities.layouts.length > 1 && (
              <label className="layout-select">
                <span>Layout</span>
                <select
                  value={layoutName}
                  onChange={(event) => setLayoutName(event.target.value)}
                >
                  {capabilities.layouts.map((layout) => (
                    <option key={layout.name}>{layout.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <KeyboardPreview layout={selectedLayout} channels={channels} />
        </section>

        <section
          className="configuration-dock"
          aria-label="Firmware configuration"
        >
          <section className="dock-pane keyboard-pane">
            <PaneHeading title="Keyboard" complete={Boolean(capabilities)} />
            <div className="pane-content">
              <button
                className="file-button source-button"
                type="button"
                aria-label="Choose keyboard folder"
                disabled={Boolean(busyAction)}
                onClick={selectKeyboardSource}
              >
                {busyAction === "target" ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <FolderOpen aria-hidden="true" />
                )}
                <span>
                  {busyAction === "target"
                    ? "Reading keyboard source"
                    : (keyboardSource?.name ?? "Choose keyboard folder")}
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
              <p className="source-help">
                Select the folder that contains your keyboard.json and source
                files.
              </p>
              {keyboardSource && keyboardSource.targets.length > 1 && (
                <div
                  className="variant-picker"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setVariantMenuOpen(false);
                      variantTriggerRef.current?.focus();
                      return;
                    }
                    if (
                      !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      return;
                    }
                    const options = Array.from(
                      event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        '[role="menuitemradio"]',
                      ),
                    );
                    if (options.length === 0) return;
                    event.preventDefault();
                    const currentIndex = options.indexOf(
                      document.activeElement as HTMLButtonElement,
                    );
                    let nextIndex = 0;
                    if (event.key === "End") {
                      nextIndex = options.length - 1;
                    } else if (event.key === "ArrowUp") {
                      nextIndex =
                        currentIndex < 0
                          ? options.length - 1
                          : (currentIndex - 1 + options.length) %
                            options.length;
                    } else if (event.key === "ArrowDown" && currentIndex >= 0) {
                      nextIndex = (currentIndex + 1) % options.length;
                    }
                    options[nextIndex]?.focus();
                  }}
                >
                  <span className="field-label">Keyboard variant</span>
                  <button
                    ref={variantTriggerRef}
                    className="variant-trigger"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={variantMenuOpen}
                    onClick={() => setVariantMenuOpen((open) => !open)}
                  >
                    <span>
                      {target ? formatTargetVariant(target) : "Choose variant"}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </button>
                  {variantMenuOpen && (
                    <div
                      className="variant-menu"
                      role="menu"
                      aria-label="Keyboard variants"
                    >
                      {keyboardSource.targets.map((availableTarget) => (
                        <button
                          key={availableTarget}
                          type="button"
                          role="menuitemradio"
                          aria-checked={target === availableTarget}
                          onClick={() =>
                            void selectTargetVariant(availableTarget)
                          }
                        >
                          <span>{formatTargetVariant(availableTarget)}</span>
                          {target === availableTarget && (
                            <Check aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="dock-pane channel-pane">
            <PaneHeading
              title="Reactive outputs"
              complete={channels.length > 0}
            />
            <div className="pane-content">
              {!capabilities ? (
                <p className="muted-copy">
                  Load a keyboard to see its declared outputs.
                </p>
              ) : capabilities.channels.length === 0 ? (
                <div className="empty-channels">
                  <p>No supported outputs</p>
                  <small>
                    This target declares no standard backlight or lock indicator
                    pins.
                  </small>
                </div>
              ) : (
                <fieldset className="channel-list">
                  <legend>Select outputs</legend>
                  {capabilities.channels.map((channel) => (
                    <label className="channel-row" key={channel.id}>
                      <input
                        type="checkbox"
                        aria-label={channel.label}
                        checked={channels.includes(channel.id)}
                        onChange={() => toggleChannel(channel.id)}
                      />
                      <span className="channel-mark">
                        <Check aria-hidden="true" />
                      </span>
                      <span className="channel-copy">
                        <strong>{channel.label}</strong>
                        <small>{channelDescription(channel.id)}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p className="hardware-note">
                The installed LED decides the color.
              </p>
            </div>
          </section>

          <section className="dock-pane build-pane">
            <PaneHeading
              title="Keymap and build"
              complete={keymapMode === "default" || Boolean(importedKeymapName)}
            />
            <div className="pane-content">
              <label className="choice-row">
                <input
                  type="radio"
                  name="keymap"
                  aria-label="Use default keymap"
                  checked={keymapMode === "default"}
                  onChange={() => setKeymapMode("default")}
                />
                <span>
                  <strong>Use default keymap</strong>
                  <small>Build QMK's default layout for this target.</small>
                </span>
              </label>
              <label className="choice-row">
                <input
                  type="radio"
                  name="keymap"
                  aria-label="Import keymap.json"
                  checked={keymapMode === "imported"}
                  onChange={() => setKeymapMode("imported")}
                />
                <span>
                  <strong>Import keymap.json</strong>
                  <small>Keep your existing QMK key assignments.</small>
                </span>
              </label>
              {keymapMode === "imported" && (
                <button
                  className="file-button"
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={selectKeymap}
                >
                  <FileJson aria-hidden="true" />
                  <span>{importedKeymapName ?? "Select keymap.json"}</span>
                  <ChevronRight aria-hidden="true" />
                </button>
              )}
              <button
                className="build-button"
                type="button"
                disabled={!canBuild}
                onClick={buildFirmware}
              >
                {busyAction === "build" ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Save />
                )}
                {busyAction === "build"
                  ? "Building firmware"
                  : "Build firmware"}
              </button>
            </div>
          </section>
        </section>
      </main>
      <footer className="status-bar" aria-live="polite">
        <div className="build-status">
          {error ? (
            <ErrorNotice error={error} />
          ) : notice ? (
            <p className="success-message">
              <Check aria-hidden="true" /> {notice}
            </p>
          ) : (
            <p>
              {buildHint({
                capabilities,
                channels,
                keymapMode,
                importedKeymapName,
              })}
            </p>
          )}
        </div>
        <span>Reactive on key press, color set by hardware</span>
      </footer>
    </div>
  );
}

function TitleBar({ api, qmkRef }: { api: KeyflareApi; qmkRef?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const stopListening = api.onWindowMaximizedChange(setMaximized);
    void api.isWindowMaximized().then(setMaximized);
    return stopListening;
  }, [api]);

  return (
    <header className="title-bar">
      <div className="app-name">KEYFLARE</div>
      <div className="top-navigation" aria-label="Primary navigation">
        <span className="top-navigation-item active">
          <Keyboard aria-hidden="true" />
          <span>Configure</span>
        </span>
      </div>
      <div className="title-actions">
        {qmkRef && (
          <span className="qmk-version">QMK {qmkRef.slice(0, 12)}</span>
        )}
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void api.minimizeWindow()}
        >
          <Minus />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => void api.toggleMaximizeWindow()}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button
          className="close-window"
          type="button"
          aria-label="Close"
          onClick={() => void api.closeWindow()}
        >
          <X />
        </button>
      </div>
    </header>
  );
}

function PaneHeading({
  title,
  complete,
}: {
  title: string;
  complete: boolean;
}) {
  return (
    <header className="pane-heading">
      <h2>{title}</h2>
      {complete && <Check role="img" aria-label={`${title} complete`} />}
    </header>
  );
}

const logicalIndicatorKeycodes: Partial<Record<ChannelId, readonly string[]>> =
  {
    num_lock: ["KC_NUM", "KC_NUM_LOCK"],
    caps_lock: ["KC_CAPS", "KC_CAPS_LOCK"],
    scroll_lock: ["KC_SCRL", "KC_SCROLL_LOCK", "KC_BRMD"],
  };

const logicalIndicatorLabels: Partial<Record<ChannelId, string>> = {
  num_lock: "Num Lock",
  caps_lock: "Caps Lock",
  scroll_lock: "Scroll Lock",
};

function KeyboardPreview({
  layout,
  channels,
}: {
  layout: KeyboardLayout | null;
  channels: ChannelId[];
}) {
  if (!layout) {
    return (
      <div className="keyboard-empty" aria-label="Keyboard layout preview">
        <Keyboard aria-hidden="true" />
        <p>Load a keyboard to preview its QMK layout.</p>
      </div>
    );
  }

  const unit = 52;
  const gap = 4;
  const maxX = Math.max(...layout.keys.map((key) => key.x + key.width));
  const maxY = Math.max(...layout.keys.map((key) => key.y + key.height));
  const width = maxX * unit + gap;
  const height = maxY * unit + gap;
  const backlightSelected = channels.includes("backlight");
  const selectedIndicatorChannels = channels.filter(
    (channel) => logicalIndicatorKeycodes[channel],
  );
  const selectionDescriptions = channels.map((channel) => {
    if (channel === "backlight") return "Backlight: all keys";
    const keycodes = logicalIndicatorKeycodes[channel];
    const label = logicalIndicatorLabels[channel];
    if (!keycodes || !label) {
      return `${formatChannelLabel(channel)}: no logical key mapping`;
    }
    const hasLogicalKey = layout.keys.some((key) =>
      keycodeExpressionIncludesAny(key.keycode, keycodes),
    );
    return hasLogicalKey
      ? `${formatChannelLabel(channel)}: ${label} key`
      : `${formatChannelLabel(channel)}: no matching key in default keymap`;
  });

  return (
    <div className="keyboard-stage" aria-label="Keyboard layout preview">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${layout.name} key layout`}
      >
        {layout.keys.map((key, index) => {
          const x = key.x * unit + gap / 2;
          const y = key.y * unit + gap / 2;
          const keyWidth = key.width * unit - gap;
          const keyHeight = key.height * unit - gap;
          const label = formatKeyLabel(key);
          const selected =
            backlightSelected ||
            selectedIndicatorChannels.some((channel) =>
              keycodeExpressionIncludesAny(
                key.keycode,
                logicalIndicatorKeycodes[channel]!,
              ),
            );
          return (
            <g
              className={selected ? "key selected-output-key" : "key"}
              key={`${key.row}-${key.column}-${index}`}
            >
              {selected && <title>{`${label} selected output`}</title>}
              <rect
                className={`key-shape${selected ? " output-selected" : ""}`}
                x={x}
                y={y}
                width={keyWidth}
                height={keyHeight}
                rx="5"
              />
              <text x={x + 8} y={y + keyHeight - 8}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="layout-caption">{layout.name}</p>
      {selectionDescriptions.length > 0 && (
        <div className="output-selection-feedback" role="status">
          {selectionDescriptions.map((description) => (
            <span key={description}>
              <Check aria-hidden="true" /> {description}
            </span>
          ))}
          <small>
            Logical key preview only. The hardware pin controls the LED.
          </small>
        </div>
      )}
    </div>
  );
}

function keycodeExpressionIncludes(
  expression: string | undefined,
  keycode: string,
): boolean {
  if (!expression) return false;
  const escapedKeycode = keycode.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Z0-9_])${escapedKeycode}($|[^A-Z0-9_])`, "u").test(
    expression,
  );
}

function keycodeExpressionIncludesAny(
  expression: string | undefined,
  keycodes: readonly string[],
): boolean {
  return keycodes.some((keycode) =>
    keycodeExpressionIncludes(expression, keycode),
  );
}

function formatKeyLabel(key: KeyboardLayout["keys"][number]): string {
  if (key.label) return key.label;
  for (const [channel, keycodes] of Object.entries(logicalIndicatorKeycodes)) {
    if (keycodes && keycodeExpressionIncludesAny(key.keycode, keycodes)) {
      return logicalIndicatorLabels[channel as ChannelId] ?? keycodes[0]!;
    }
  }
  if (key.keycode?.startsWith("KC_")) {
    return key.keycode.slice(3).replaceAll("_", " ");
  }
  return `${key.row},${key.column}`;
}

function formatChannelLabel(channel: ChannelId): string {
  return channel === "backlight"
    ? "Backlight"
    : `${channel
        .split("_")
        .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
        .join(" ")} indicator`;
}

function channelDescription(channel: ChannelId): string {
  if (channel === "backlight") return "All keyboard backlight LEDs";
  return `Dedicated ${formatChannelLabel(channel)} pin`;
}

function formatTargetVariant(target: string): string {
  return target.split("/").slice(2).join("/") || "Base";
}

function LoadingScreen({
  api,
  error,
}: {
  api: KeyflareApi;
  error: UiError | null;
}) {
  return (
    <div className="setup-shell">
      <TitleBar api={api} />
      <main className="setup-workspace">
        <SetupProgress checking />
        <section className="setup-pane" aria-live="polite">
          <div className="setup-pane-content setup-loading">
            <LoaderCircle className="spin" aria-hidden="true" />
            <div>
              <p className="workspace-kicker">QMK environment</p>
              <h1>Checking QMK</h1>
              <p>
                {error?.details ??
                  "Keyflare is checking the local build environment."}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function SetupProgress({
  checking = false,
  sourceRequired = false,
}: {
  checking?: boolean;
  sourceRequired?: boolean;
}) {
  return (
    <nav className="setup-progress" aria-label="Setup progress">
      <p>SETUP</p>
      <ol>
        <li className={sourceRequired ? "complete" : "active"}>
          <span>{sourceRequired ? <Check aria-hidden="true" /> : "1"}</span>
          <div>
            <strong>Build tools</strong>
            <small>{checking ? "Checking" : "QMK command line"}</small>
          </div>
        </li>
        <li className={sourceRequired ? "active" : "pending"}>
          <span>2</span>
          <div>
            <strong>QMK source</strong>
            <small>Pinned firmware tree</small>
          </div>
        </li>
        <li className="pending">
          <span>3</span>
          <div>
            <strong>Configure</strong>
            <small>Choose keyboard</small>
          </div>
        </li>
      </ol>
    </nav>
  );
}

function SetupScreen({
  api,
  environment,
  busyAction,
  error,
  onDownload,
  onCheck,
  onSelectQmkMsysRoot,
}: {
  api: KeyflareApi;
  environment: EnvironmentStatus;
  busyAction: "source" | "qmk-msys" | null;
  error: UiError | null;
  onDownload(): void;
  onCheck(): void;
  onSelectQmkMsysRoot(): void;
}) {
  const sourceRequired = environment.kind === "source-required";
  const toolchainRequired = environment.kind === "toolchain-required";
  const canChooseQmkMsysRoot =
    environment.canSelectQmkMsysRoot && !sourceRequired;
  let heading = "Repair the QMK build environment";
  let description =
    "QMK was found, but its environment check failed. Repair the selected installation or choose another folder.";
  let actionLabel = "Check again";
  let SetupActionIcon = RotateCw;
  if (sourceRequired) {
    heading = "Download QMK source";
    description =
      "Keyflare keeps a pinned QMK checkout in its app data. The first download can take several minutes.";
    actionLabel = "Download QMK source";
    SetupActionIcon = Save;
  } else if (toolchainRequired) {
    heading = "Set up QMK build tools";
    description =
      "Keyflare uses QMK's supported build tools. It does not bundle compilers or device drivers.";
  }

  return (
    <div className="setup-shell">
      <TitleBar api={api} />
      <main className="setup-workspace">
        <SetupProgress sourceRequired={sourceRequired} />
        <section className="setup-pane">
          <header className="setup-pane-header">
            <p className="workspace-kicker">QMK environment</p>
            <h1>{heading}</h1>
            <p>{description}</p>
          </header>
          <div className="setup-pane-content">
            <div className="setup-status">
              <span aria-hidden="true" />
              <div>
                <small>Needs attention</small>
                <strong>{error?.summary ?? environment.summary}</strong>
              </div>
            </div>

            {!sourceRequired && (
              <div className="setup-instructions">
                <strong>
                  {canChooseQmkMsysRoot ? "Windows setup" : "Supported setup"}
                </strong>
                <p>
                  {canChooseQmkMsysRoot
                    ? "Choose the QMK_MSYS folder you already use. Keyflare also checks C:\\QMK_MSYS automatically."
                    : "Install QMK with Homebrew on macOS, or run the QMK bootstrap setup on Linux. Then check again."}
                </p>
              </div>
            )}

            {canChooseQmkMsysRoot ? (
              <div className="setup-actions">
                <button
                  className="accent-button setup-action setup-primary"
                  type="button"
                  disabled={busyAction !== null}
                  onClick={onSelectQmkMsysRoot}
                >
                  {busyAction === "qmk-msys" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <FolderOpen />
                  )}
                  {busyAction === "qmk-msys"
                    ? "Checking folder"
                    : "Choose QMK MSYS folder"}
                </button>
                <button
                  className="secondary-button setup-action"
                  type="button"
                  disabled={busyAction !== null}
                  onClick={onCheck}
                >
                  {busyAction === "source" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <RotateCw />
                  )}
                  {busyAction === "source" ? "Checking QMK" : actionLabel}
                </button>
              </div>
            ) : (
              <button
                className="accent-button setup-action setup-primary"
                type="button"
                disabled={busyAction !== null}
                onClick={sourceRequired ? onDownload : onCheck}
              >
                {busyAction ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <SetupActionIcon />
                )}
                {busyAction ? "Working" : actionLabel}
              </button>
            )}
            <details className="setup-technical">
              <summary>Technical details</summary>
              <pre>{error?.details ?? environment.details}</pre>
            </details>
          </div>
        </section>
      </main>
    </div>
  );
}

function buildHint({
  capabilities,
  channels,
  keymapMode,
  importedKeymapName,
}: {
  capabilities: TargetCapabilities | null;
  channels: ChannelId[];
  keymapMode: KeymapMode;
  importedKeymapName: string | null;
}): string {
  if (!capabilities) return "Load a supported keyboard to continue.";
  if (capabilities.channels.length === 0)
    return "This keyboard has no supported declared channels.";
  if (channels.length === 0) return "Select at least one reactive channel.";
  if (keymapMode === "imported" && !importedKeymapName)
    return "Select a QMK keymap.json file.";
  return "Ready to compile. Flash the saved file with your usual QMK tool.";
}

function formatSaveNotice(saved: SaveResult): string {
  return saved.kind === "saved"
    ? `Saved ${saved.fileName}`
    : "Build finished, but no file was saved. Build again to choose a location.";
}

function ErrorNotice({ error }: { error: UiError }) {
  return (
    <details className="error-message">
      <summary>{error.summary}. View QMK details</summary>
      <pre>{error.details}</pre>
    </details>
  );
}

function readError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
