import { contextBridge, ipcRenderer } from "electron";

/** The only bridge between the window and Node. Every call is a named IPC handler in main.ts. */
const api = {
  initialProject: () => ipcRenderer.invoke("project:initial"),
  pickProject: () => ipcRenderer.invoke("project:pick"),
  pickNewFolder: () => ipcRenderer.invoke("project:pickNew"),
  createProject: (dir: string, options: unknown) => ipcRenderer.invoke("project:create", dir, options),
  loadProject: (root: string) => ipcRenderer.invoke("project:load", root),
  saveSpec: (root: string, rel: string, value: unknown) => ipcRenderer.invoke("spec:save", root, rel, value),
  deleteSpec: (root: string, rel: string) => ipcRenderer.invoke("spec:delete", root, rel),
  dependents: (root: string, rel: string) => ipcRenderer.invoke("spec:dependents", root, rel),
  renameEdits: (root: string, rel: string, renamed: unknown) => ipcRenderer.invoke("spec:renameEdits", root, rel, renamed),
  dataUrl: (root: string, rel: string) => ipcRenderer.invoke("file:dataUrl", root, rel),
  saveArt: (root: string, rel: string, dataUrl: string) => ipcRenderer.invoke("art:save", root, rel, dataUrl),
  loadVanilla: (version: string) => ipcRenderer.invoke("vanilla:load", version),
  pickMinecraftJar: (version: string) => ipcRenderer.invoke("vanilla:pickJar", version),
  vanillaIcon: (id: string) => ipcRenderer.invoke("vanilla:icon", id),
  generate: (root: string) => ipcRenderer.invoke("project:generate", root),
  runGradle: (root: string, task: string) => ipcRenderer.invoke("gradle:run", root, task),
  stopGradle: () => ipcRenderer.invoke("gradle:stop"),
  openPath: (root: string, rel: string) => ipcRenderer.invoke("shell:open", root, rel),
  onGradleLog: (fn: (text: string) => void) => {
    const listener = (_e: unknown, text: string) => fn(text);
    ipcRenderer.on("gradle:log", listener);
    return () => ipcRenderer.removeListener("gradle:log", listener);
  },
  onProjectChanged: (fn: (root: string) => void) => {
    const listener = (_e: unknown, root: string) => fn(root);
    ipcRenderer.on("project:changed", listener);
    return () => ipcRenderer.removeListener("project:changed", listener);
  },
};

contextBridge.exposeInMainWorld("modcreator", api);
