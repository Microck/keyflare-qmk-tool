// Keep this module dependency-free. Electron's sandboxed preload can import
// constants, but it cannot load arbitrary Node modules pulled in by validators.
export const ipcChannels = {
  getEnvironment: "keyflare:get-environment",
  initializeSource: "keyflare:initialize-source",
  selectKeyboardSource: "keyflare:select-keyboard-source",
  inspectTarget: "keyflare:inspect-target",
  selectKeymap: "keyflare:select-keymap",
  selectQmkMsysRoot: "keyflare:select-qmk-msys-root",
  buildAndSave: "keyflare:build-and-save",
  isWindowMaximized: "keyflare:is-window-maximized",
  windowMaximizedChanged: "keyflare:window-maximized-changed",
  minimizeWindow: "keyflare:minimize-window",
  toggleMaximizeWindow: "keyflare:toggle-maximize-window",
  closeWindow: "keyflare:close-window",
} as const;
