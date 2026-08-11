import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Check,
  ChevronRight,
  Cpu,
  FileJson,
  Flame,
  Keyboard,
  LoaderCircle,
  Save,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import type {
  BuildAndSaveInput,
  EnvironmentStatus,
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
  const [targets, setTargets] = useState<string[]>([]);
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
  const [busyAction, setBusyAction] = useState<
    "source" | "target" | "keymap" | "build" | null
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
        if (status.kind === "ready") {
          const availableTargets = await api.listTargets();
          if (active) setTargets(availableTargets);
        }
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

  const targetIndex = useMemo(() => new Set(targets), [targets]);
  const targetSuggestions = useMemo(() => {
    const query = target.trim().toLowerCase();
    const suggestions: string[] = [];
    for (const availableTarget of targets) {
      if (!query || availableTarget.toLowerCase().includes(query)) {
        suggestions.push(availableTarget);
      }
      if (suggestions.length === 50) break;
    }
    return suggestions;
  }, [target, targets]);
  const selectedLayout =
    capabilities?.layouts.find((layout) => layout.name === layoutName) ?? null;
  const canBuild = Boolean(
    capabilities &&
    channels.length > 0 &&
    (keymapMode === "default" || importedKeymapName) &&
    !busyAction,
  );
  const targetExists = targetIndex.has(target);

  async function downloadSource() {
    setBusyAction("source");
    setError(null);
    try {
      const status = await api.initializeSource();
      setEnvironment(status);
      if (status.kind === "ready") {
        setTargets(await api.listTargets());
      }
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
      if (status.kind === "ready") {
        setTargets(await api.listTargets());
      }
    } catch (reason) {
      setError({
        summary: "QMK is not ready",
        details: `${readError(reason)}. Repair the QMK setup and check it again.`,
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function loadTarget() {
    if (!target) return;
    setBusyAction("target");
    setError(null);
    setNotice(null);
    setCapabilities(null);
    setChannels([]);
    try {
      const inspected = await api.inspectTarget(target);
      setCapabilities(inspected);
      setLayoutName(inspected.layouts[0]?.name ?? "");
    } catch (reason) {
      setError({
        summary: "Unable to load this keyboard",
        details: `${readError(reason)}. Choose another upstream QMK target and try again.`,
      });
    } finally {
      setBusyAction(null);
    }
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
    return <LoadingScreen error={error} />;
  }

  if (environment.kind !== "ready") {
    return (
      <SetupScreen
        environment={environment}
        busy={busyAction === "source"}
        error={error}
        onDownload={downloadSource}
        onCheck={checkEnvironment}
      />
    );
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <main className="workspace">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Firmware configurator</p>
            <h1 id="page-title">Build reactive lighting</h1>
            <p>
              Choose an upstream QMK keyboard. Keyflare only shows lighting
              channels that its metadata declares.
            </p>
          </div>
          <div className="environment-pill">
            <ShieldCheck aria-hidden="true" />
            <span>QMK {environment.qmkRef.slice(0, 12)}</span>
          </div>
        </section>

        <div className="configuration-grid">
          <aside className="control-panel" aria-label="Firmware configuration">
            <Step
              heading="Keyboard"
              number="1"
              complete={Boolean(capabilities)}
            >
              <label className="field-label" htmlFor="target-select">
                Keyboard target
              </label>
              <input
                id="target-select"
                list="target-options"
                placeholder="Search upstream QMK targets"
                autoComplete="off"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  setCapabilities(null);
                  setChannels([]);
                  setNotice(null);
                }}
              />
              <datalist id="target-options">
                {targetSuggestions.map((availableTarget) => (
                  <option key={availableTarget} value={availableTarget}>
                    {availableTarget}
                  </option>
                ))}
              </datalist>
              <button
                className="secondary-button full-width"
                type="button"
                disabled={!targetExists || Boolean(busyAction)}
                onClick={loadTarget}
              >
                {busyAction === "target" ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Keyboard />
                )}
                {busyAction === "target"
                  ? "Reading QMK metadata"
                  : "Load keyboard"}
              </button>
            </Step>

            <Step
              heading="Keymap"
              number="2"
              complete={keymapMode === "default" || Boolean(importedKeymapName)}
            >
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
            </Step>

            <Step
              heading="Reactive channels"
              number="3"
              complete={channels.length > 0}
            >
              {!capabilities ? (
                <p className="muted-copy">
                  Load a keyboard to see its declared channels.
                </p>
              ) : capabilities.channels.length === 0 ? (
                <div className="empty-channels">
                  <p>No supported lighting channels</p>
                  <small>
                    This target does not declare standard backlight or indicator
                    pins in QMK.
                  </small>
                </div>
              ) : (
                <fieldset className="channel-list">
                  <legend>Select one or more channels</legend>
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
                      <span>
                        <strong>{channel.label}</strong>
                        <small>
                          {channel.kind === "backlight"
                            ? "Keyboard backlight"
                            : "Lock LED"}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <p className="hardware-note">
                Keyflare changes only on and off state. Your installed LED
                determines the color.
              </p>
            </Step>
          </aside>

          <section className="preview-panel" aria-labelledby="preview-title">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Keyboard preview</p>
                <h2 id="preview-title">
                  {capabilities?.keyboardName ?? "No keyboard loaded"}
                </h2>
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
            <KeyboardPreview layout={selectedLayout} />
            <div className="preview-explanation">
              <Cpu aria-hidden="true" />
              <div>
                <strong>How the firmware reacts</strong>
                <p>
                  The selected channels turn on while at least one physical key
                  is held. QMK restores their prior state after the last key is
                  released.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="build-bar">
        <div className="build-status" aria-live="polite">
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
        <button
          className="primary-button"
          type="button"
          disabled={!canBuild}
          onClick={buildFirmware}
        >
          {busyAction === "build" ? (
            <LoaderCircle className="spin" />
          ) : (
            <Save />
          )}
          {busyAction === "build" ? "Building firmware" : "Build firmware"}
        </button>
      </footer>
    </div>
  );
}

function AppHeader() {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <Flame aria-hidden="true" />
        </span>
        <span>Keyflare</span>
      </div>
      <nav aria-label="Primary navigation">
        <span className="active-nav">
          <Wrench aria-hidden="true" /> Configure
        </span>
      </nav>
    </header>
  );
}

function Step({
  heading,
  number,
  complete,
  children,
}: {
  heading: string;
  number: string;
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="step-section">
      <div className="step-heading">
        <span className={complete ? "step-number complete" : "step-number"}>
          {complete ? <Check aria-hidden="true" /> : number}
        </span>
        <h2>{heading}</h2>
      </div>
      <div className="step-content">{children}</div>
    </section>
  );
}

function KeyboardPreview({ layout }: { layout: KeyboardLayout | null }) {
  if (!layout) {
    return (
      <div className="keyboard-empty" aria-label="Keyboard layout preview">
        <Box aria-hidden="true" />
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
          const label = key.label || `${key.row},${key.column}`;
          return (
            <g key={`${key.row}-${key.column}-${index}`}>
              <rect
                className="key-shape"
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
    </div>
  );
}

function LoadingScreen({ error }: { error: UiError | null }) {
  return (
    <div className="setup-shell">
      <div className="setup-card" aria-live="polite">
        <LoaderCircle className="setup-icon spin" aria-hidden="true" />
        <h1>Checking QMK</h1>
        <p>
          {error?.details ??
            "Keyflare is checking the local build environment."}
        </p>
      </div>
    </div>
  );
}

function SetupScreen({
  environment,
  busy,
  error,
  onDownload,
  onCheck,
}: {
  environment: EnvironmentStatus;
  busy: boolean;
  error: UiError | null;
  onDownload(): void;
  onCheck(): void;
}) {
  const sourceRequired = environment.kind === "source-required";
  const toolchainRequired = environment.kind === "toolchain-required";
  let heading = "Repair the QMK build environment";
  let actionLabel = "Check QMK setup again";
  let SetupActionIcon = ShieldCheck;
  if (sourceRequired) {
    heading = "Download Keyflare's QMK source";
    actionLabel = "Download QMK source";
    SetupActionIcon = Save;
  } else if (toolchainRequired) {
    heading = "Install QMK before you build";
  }

  return (
    <div className="setup-shell">
      <header className="setup-brand">
        <Flame aria-hidden="true" /> Keyflare
      </header>
      <main className="setup-card">
        <span className="setup-icon">
          <Wrench aria-hidden="true" />
        </span>
        <p className="eyebrow">One-time setup</p>
        <h1>{heading}</h1>
        {sourceRequired ? (
          <p>
            Keyflare keeps a pinned QMK checkout in its app data. The download
            can take several minutes.
          </p>
        ) : (
          <>
            <p>
              Keyflare uses QMK's supported build tools. It does not bundle
              compilers or device drivers.
            </p>
            <ul className="platform-list">
              <li>
                <strong>Windows:</strong> install and open QMK MSYS.
              </li>
              <li>
                <strong>macOS:</strong> install QMK with Homebrew, then run QMK
                setup.
              </li>
              <li>
                <strong>Linux:</strong> install QMK CLI and run its bootstrap
                setup.
              </li>
            </ul>
          </>
        )}
        <div className="setup-detail">
          <strong>{environment.summary}</strong>
          <code>{error?.details ?? environment.details}</code>
        </div>
        <button
          className="primary-button setup-action"
          type="button"
          disabled={busy}
          onClick={sourceRequired ? onDownload : onCheck}
        >
          {busy ? <LoaderCircle className="spin" /> : <SetupActionIcon />}
          {busy ? "Working" : actionLabel}
        </button>
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
