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
  buildAndSave: (input) => ipcRenderer.invoke(ipcChannels.buildAndSave, input),
};

contextBridge.exposeInMainWorld("keyflare", keyflare);
