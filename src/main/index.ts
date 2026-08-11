import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import {
  buildAndSaveInputSchema,
  inspectTargetInputSchema,
  ipcChannels,
} from "../shared/keyflare-api";
import { KeyflareService } from "./app-service";
import { FirmwareBuildModule } from "./firmware-build";

let mainWindow: BrowserWindow | null = null;

function createService(): KeyflareService {
  const moduleSourcePath = app.isPackaged
    ? join(process.resourcesPath, "qmk-module", "keyflare", "reactive")
    : join(app.getAppPath(), "resources", "qmk-module", "keyflare", "reactive");
  const builder = new FirmwareBuildModule({
    appDataPath: app.getPath("userData"),
    moduleSourcePath,
  });

  return new KeyflareService({ builder });
}

function getInvokingWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow || window.isDestroyed()) {
    throw new Error("Rejected IPC request from an unexpected window");
  }
  return window;
}

async function chooseKeymap(parent: BrowserWindow): Promise<string | null> {
  const selection = await dialog.showOpenDialog(parent, {
    title: "Select a QMK keymap",
    properties: ["openFile"],
    filters: [{ name: "QMK keymap", extensions: ["json"] }],
  });
  return selection.canceled ? null : (selection.filePaths[0] ?? null);
}

async function chooseArtifactDestination(
  parent: BrowserWindow,
  suggestedName: string,
): Promise<string | null> {
  const extension = suggestedName.split(".").at(-1) ?? "bin";
  const selection = await dialog.showSaveDialog(parent, {
    title: "Save firmware",
    defaultPath: suggestedName,
    filters: [{ name: "QMK firmware", extensions: [extension] }],
  });
  return selection.canceled ? null : (selection.filePath ?? null);
}

function registerIpc(service: KeyflareService): void {
  ipcMain.handle(ipcChannels.getEnvironment, () => service.getEnvironment());
  ipcMain.handle(ipcChannels.initializeSource, () =>
    service.initializeSource(),
  );
  ipcMain.handle(ipcChannels.listTargets, () => service.listTargets());
  ipcMain.handle(ipcChannels.inspectTarget, (_event, input: unknown) =>
    service.inspectTarget(inspectTargetInputSchema.parse(input)),
  );
  ipcMain.handle(ipcChannels.selectKeymap, (event) => {
    const parent = getInvokingWindow(event);
    return service.selectKeymap(() => chooseKeymap(parent));
  });
  ipcMain.handle(ipcChannels.buildAndSave, (event, input: unknown) => {
    const parent = getInvokingWindow(event);
    return service.buildAndSave(
      buildAndSaveInputSchema.parse(input),
      (suggestedName) => chooseArtifactDestination(parent, suggestedName),
    );
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#171717",
    title: "Keyflare",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const developmentUrl = app.isPackaged
    ? undefined
    : process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc(createService());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
