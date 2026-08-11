import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type IpcMainInvokeEvent,
} from "electron";

import {
  buildAndSaveInputSchema,
  inspectTargetInputSchema,
  ipcChannels,
} from "../shared/keyflare-api";
import { KeyflareService, readQmkMsysRootSetting } from "./app-service";
import { FirmwareBuildModule } from "./firmware-build";

let mainWindow: BrowserWindow | null = null;
const qmkMsysRootSettingName = "qmk-msys-root.txt";

async function createService(): Promise<{
  service: KeyflareService;
  qmkMsysRootSettingPath: string;
}> {
  const appDataPath = app.getPath("userData");
  const qmkMsysRootSettingPath = join(appDataPath, qmkMsysRootSettingName);
  const qmkMsysRoot =
    process.platform === "win32"
      ? await readQmkMsysRootSetting(qmkMsysRootSettingPath)
      : undefined;
  const moduleSourcePath = app.isPackaged
    ? join(process.resourcesPath, "qmk-module", "keyflare", "reactive")
    : join(app.getAppPath(), "resources", "qmk-module", "keyflare", "reactive");
  const builder = new FirmwareBuildModule({
    appDataPath,
    moduleSourcePath,
    ...(qmkMsysRoot ? { qmkMsysRoot } : {}),
  });

  return {
    service: new KeyflareService({ builder }),
    qmkMsysRootSettingPath,
  };
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

async function chooseKeyboardSource(
  parent: BrowserWindow,
): Promise<string | null> {
  const selection = await dialog.showOpenDialog(parent, {
    title: "Choose a QMK keyboard source folder",
    properties: ["openDirectory"],
  });
  return selection.canceled ? null : (selection.filePaths[0] ?? null);
}

async function chooseQmkMsysRoot(
  parent: BrowserWindow,
): Promise<string | null> {
  if (process.platform !== "win32") {
    throw new Error("Custom QMK MSYS folders are supported only on Windows");
  }
  const selection = await dialog.showOpenDialog(parent, {
    title: "Choose the QMK_MSYS folder",
    properties: ["openDirectory"],
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

function registerIpc({
  service,
  qmkMsysRootSettingPath,
}: {
  service: KeyflareService;
  qmkMsysRootSettingPath: string;
}): void {
  ipcMain.handle(ipcChannels.getEnvironment, () => service.getEnvironment());
  ipcMain.handle(ipcChannels.initializeSource, () =>
    service.initializeSource(),
  );
  ipcMain.handle(ipcChannels.selectKeyboardSource, (event) => {
    const parent = getInvokingWindow(event);
    return service.selectKeyboardSource(() => chooseKeyboardSource(parent));
  });
  ipcMain.handle(ipcChannels.inspectTarget, (_event, input: unknown) =>
    service.inspectTarget(inspectTargetInputSchema.parse(input)),
  );
  ipcMain.handle(ipcChannels.selectKeymap, (event) => {
    const parent = getInvokingWindow(event);
    return service.selectKeymap(() => chooseKeymap(parent));
  });
  ipcMain.handle(ipcChannels.selectQmkMsysRoot, (event) => {
    const parent = getInvokingWindow(event);
    return service.selectQmkMsysRoot(
      () => chooseQmkMsysRoot(parent),
      qmkMsysRootSettingPath,
    );
  });
  ipcMain.handle(ipcChannels.buildAndSave, (event, input: unknown) => {
    const parent = getInvokingWindow(event);
    return service.buildAndSave(
      buildAndSaveInputSchema.parse(input),
      (suggestedName) => chooseArtifactDestination(parent, suggestedName),
    );
  });
  ipcMain.handle(ipcChannels.isWindowMaximized, (event) =>
    getInvokingWindow(event).isMaximized(),
  );
  ipcMain.handle(ipcChannels.minimizeWindow, (event) => {
    getInvokingWindow(event).minimize();
  });
  ipcMain.handle(ipcChannels.toggleMaximizeWindow, (event) => {
    const window = getInvokingWindow(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle(ipcChannels.closeWindow, (event) => {
    getInvokingWindow(event).close();
  });
}

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "build", "icon.png");
  if (process.platform === "darwin") {
    app.dock?.setIcon(iconPath);
  }
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#1d1b1b",
    icon: iconPath,
    title: "Keyflare",
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("maximize", () =>
    mainWindow?.webContents.send(ipcChannels.windowMaximizedChanged, true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow?.webContents.send(ipcChannels.windowMaximizedChanged, false),
  );
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

app.whenReady().then(async () => {
  // macOS routes standard edit shortcuts through its native application menu.
  // These menus stay in the system menu bar, not inside the frameless window.
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ])
      : null,
  );
  registerIpc(await createService());
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
