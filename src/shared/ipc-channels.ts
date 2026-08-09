// Keep this module dependency-free. Electron's sandboxed preload can import
// constants, but it cannot load arbitrary Node modules pulled in by validators.
export const ipcChannels = {
  getEnvironment: "keyflare:get-environment",
  initializeSource: "keyflare:initialize-source",
  listTargets: "keyflare:list-targets",
  inspectTarget: "keyflare:inspect-target",
  selectKeymap: "keyflare:select-keymap",
  buildAndSave: "keyflare:build-and-save",
} as const;
