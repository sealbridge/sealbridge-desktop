import { createDesktopReceiver, registerContextReceiveIpc } from "./context-receive.mjs";
import { createContextSender, registerContextSendIpc } from "./context-send.mjs";
import { registerContextPoolingIpc, createContextPreparation, loadContextSdk } from "./context-pooling.mjs";
import { registerContextAuditIpc } from "./context-audit.mjs";
import { clipboard } from "electron";
import { desktopInvites, registerInviteIpc } from "./invites.mjs";
import { createInviteProcess } from "./invite-process.mjs";
import { developmentRuntimeDir } from "./runtime.mjs";
import path from "node:path";
import { createCoreService, registerCoreIpc, createCoreClose } from "./service.mjs";

export function startDesktopCore({ app, ipcMain, localOnly }) {
  const service = createCoreService({
    dataDir: path.join(app.getPath("userData"), "sealbridge-core"),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  });
  registerCoreIpc({ ipcMain, localOnly, service: { ...service, retry: async () => prepareInvites(await service.retry()) } });
  const runtimeDir = app.isPackaged ? path.join(process.resourcesPath, "sealbridge-runtime") : developmentRuntimeDir;
  registerContextPoolingIpc({ ipcMain, localOnly, prepare: createContextPreparation({ loadSdk: () => loadContextSdk(runtimeDir) }) });
  registerContextAuditIpc({ ipcMain, localOnly, dataDir: path.join(app.getPath("userData"), "sealbridge-core"),
    loadSdk: () => loadContextSdk(runtimeDir) });
  const sender = createContextSender({ service, dataDir: path.join(app.getPath("userData"), "sealbridge-core"), runtimeDir });
  registerContextSendIpc({ ipcMain, localOnly, sender });
  const receiver = createDesktopReceiver({ dataDir: path.join(app.getPath("userData"), "sealbridge-core"), runtimeDir });
  registerContextReceiveIpc({ ipcMain, localOnly, receiver });
  registerInviteIpc({ ipcMain, localOnly, clipboard });
  const operate = createInviteProcess({ dataDir: path.join(app.getPath("userData"), "sealbridge-core"),
    runtimeDir: app.isPackaged ? path.join(process.resourcesPath, "sealbridge-runtime") : developmentRuntimeDir });
  const prepareInvites = status => { if (status.state === "ready") { void desktopInvites.ready(operate); void receiver.start(); } return status; };
  void service.start().then(prepareInvites);
  return { ...service, close: createCoreClose({ service, receiver, sender }) };
}
