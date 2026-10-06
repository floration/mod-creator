import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createProject, generate, loadProject, type CreateOptions } from "@modcreator/core";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let gradle: ChildProcess | null = null;
let watcher: FSWatcher | null = null;

/** Resolve a project-relative path and refuse anything that escapes the project folder. */
function inside(root: string, rel: string): string {
  root = path.resolve(root);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`${rel} is outside the project`);
  return full;
}

function send(channel: string, ...args: unknown[]) {
  window?.webContents.send(channel, ...args);
}

/** Watch spec/, art/ and modcreator.json so hand edits in other editors show up in the app. */
function watchProject(root: string) {
  watcher?.close();
  let timer: NodeJS.Timeout | undefined;
  watcher = watch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = name.toString().split(path.sep).join("/");
    if (!(rel === "modcreator.json" || rel.startsWith("spec/") || rel.startsWith("art/"))) return;
    clearTimeout(timer);
    timer = setTimeout(() => send("project:changed", root), 150);
  });
}

/** `electron . --project <folder>` opens that project on start. */
const projectArg = (() => {
  const i = process.argv.indexOf("--project");
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : null;
})();

ipcMain.handle("project:initial", () => projectArg);

ipcMain.handle("project:pick", async () => {
  const result = await dialog.showOpenDialog(window!, {
    title: "Open a Mod Creator project",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("project:pickNew", async () => {
  const result = await dialog.showOpenDialog(window!, {
    title: "Choose an empty folder for the new mod",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("project:create", async (_e, dir: string, options: CreateOptions) => {
  // The packaged CLI sits next to core in the workspace; builds use it to regenerate.
  const cliPath = path.resolve(here, "../../../cli/dist/index.js");
  await createProject(dir, { ...options, cliPath: existsSync(cliPath) ? cliPath : null });
  return dir;
});

ipcMain.handle("project:load", async (_e, root: string) => {
  const loaded = await loadProject(root);
  watchProject(loaded.root);
  return loaded;
});

ipcMain.handle("spec:save", async (_e, root: string, rel: string, value: unknown) => {
  const file = inside(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
});

ipcMain.handle("spec:delete", async (_e, root: string, rel: string) => {
  await rm(inside(root, rel));
});

ipcMain.handle("file:dataUrl", async (_e, root: string, rel: string) => {
  const file = inside(root, rel);
  if (!existsSync(file)) return null;
  const mime = file.endsWith(".png") ? "image/png" : "application/octet-stream";
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
});

ipcMain.handle("project:generate", async (_e, root: string) => generate(root));

ipcMain.handle("gradle:run", async (_e, root: string, task: string) => {
  if (gradle) throw new Error("A Gradle task is already running");
  if (!["build", "runClient", "clean"].includes(task)) throw new Error(`Unknown task ${task}`);
  const windows = process.platform === "win32";
  const cmd = windows ? "gradlew.bat" : "./gradlew";
  send("gradle:log", `> ${cmd} ${task}\n`);
  gradle = spawn(cmd, [task, "--console=plain"], { cwd: root, shell: windows });
  gradle.stdout?.on("data", (d) => send("gradle:log", d.toString()));
  gradle.stderr?.on("data", (d) => send("gradle:log", d.toString()));
  return new Promise<number>((resolve) => {
    gradle!.on("close", (code) => {
      gradle = null;
      send("gradle:log", `\n[${task} finished with exit code ${code}]\n`);
      resolve(code ?? -1);
    });
    gradle!.on("error", (err) => {
      gradle = null;
      send("gradle:log", `\n[could not start Gradle: ${err.message}]\n`);
      resolve(-1);
    });
  });
});

ipcMain.handle("gradle:stop", () => {
  gradle?.kill();
});

ipcMain.handle("shell:open", async (_e, root: string, rel: string) => {
  await shell.openPath(inside(root, rel));
});

app.whenReady().then(() => {
  window = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Mod Creator",
    backgroundColor: "#1e1f22",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.loadFile(path.join(here, "../renderer/index.html"));
});

app.on("window-all-closed", () => {
  gradle?.kill();
  app.quit();
});
