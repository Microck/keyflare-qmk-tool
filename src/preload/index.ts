import { contextBridge, ipcRenderer } from "electron";

import type { KeyflareApi } from "../shared/keyflare-api";
import { ipcChannels } from "../shared/ipc-channels";

const keyflare: KeyflareApi = {
  getEnvironment: () => ipcRenderer.invoke(ipcChannels.getEnvironment),
  initializeSource: () => ipcRenderer.invoke(ipcChannels.initializeSource),
  listTargets: () => ipcRenderer.invoke(ipcChannels.listTargets),
  inspectTarget: (target) =>
    ipcRenderer.invoke(ipcChannels.inspectTarget, target),
  selectKeymap: () => ipcRenderer.invoke(ipcChannels.selectKeymap),
  selectQmkMsysRoot: () => ipcRenderer.invoke(ipcChannels.selectQmkMsysRoot),
  buildAndSave: (input) => ipcRenderer.invoke(ipcChannels.buildAndSave, input),
  isWindowMaximized: () => ipcRenderer.invoke(ipcChannels.isWindowMaximized),
  onWindowMaximizedChange: (listener) => {
    const handleChange = (
      _event: Electron.IpcRendererEvent,
      maximized: boolean,
    ) => listener(maximized);
    ipcRenderer.on(ipcChannels.windowMaximizedChanged, handleChange);
    return () =>
      ipcRenderer.removeListener(
        ipcChannels.windowMaximizedChanged,
        handleChange,
      );
  },
  minimizeWindow: () => ipcRenderer.invoke(ipcChannels.minimizeWindow),
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke(ipcChannels.toggleMaximizeWindow),
  closeWindow: () => ipcRenderer.invoke(ipcChannels.closeWindow),
};

contextBridge.exposeInMainWorld("keyflare", keyflare);
