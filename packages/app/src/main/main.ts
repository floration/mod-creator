import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { VanillaAssets, createProject, modrinthVersions, searchModrinth, dependentsOf, parseBlockbench, findMinecraftJar, generate, loadProject, renameEdits, type CreateOptions, type ElementSpec } from "@modcreator/core";

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let gradle: ChildProcess | null = null;
let watcher: FSWatcher | null = null;
let vanilla: { jar: string; assets: VanillaAssets } | null = null;

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

/** Fields in other specs that point at this one, so Delete can say what will break. */
ipcMain.handle("spec:dependents", async (_e, root: string, rel: string) => dependentsOf(await loadProject(root), rel));

/** Edits to other specs that keep them pointing at an element whose id is changing. */
ipcMain.handle("spec:renameEdits", async (_e, root: string, rel: string, renamed: ElementSpec) =>
  renameEdits(await loadProject(root), rel, renamed),
);

/** Modrinth lookups run here: the window's content security policy keeps it off the network. */
ipcMain.handle("modrinth:search", (_e, query: string, minecraft: string) => searchModrinth(query, minecraft));
ipcMain.handle("modrinth:versions", (_e, slug: string, minecraft: string) => modrinthVersions(slug, minecraft));

/** A Blockbench model read into Minecraft's model terms, for the preview and the texture editor. */
ipcMain.handle("model:blockbench", async (_e, root: string, rel: string) => {
  const file = inside(root, rel);
  if (!existsSync(file)) return { model: null, error: `Missing file ${rel}` };
  try {
    return { model: parseBlockbench(JSON.parse(await readFile(file, "utf8"))), error: null };
  } catch (e) {
    return { model: null, error: (e as Error).message };
  }
});

ipcMain.handle("file:dataUrl", async (_e, root: string, rel: string) => {
  const file = inside(root, rel);
  if (!existsSync(file)) return null;
  const mime = file.endsWith(".png") ? "image/png" : "application/octet-stream";
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
});

/** The texture editor saves PNGs here. Only .png files inside the project, and only real PNG data. */
ipcMain.handle("art:save", async (_e, root: string, rel: string, dataUrl: string) => {
  if (!/\.png$/i.test(rel)) throw new Error(`${rel} is not a .png file`);
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("The texture editor sent something that isn't a PNG");
  const file = inside(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(match[1], "base64"));
});

/** App settings that belong to this computer rather than to a mod project. */
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
async function settings(): Promise<{ minecraftJar?: string }> {
  try {
    return JSON.parse(await readFile(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

/** Minecraft's own items come from the player's client jar: the one they picked, else Loom's cache or a launcher's. */
async function openVanilla(version: string, jar?: string) {
  jar ??= (await settings()).minecraftJar;
  if (!jar || !existsSync(jar)) jar = findMinecraftJar(version) ?? undefined;
  if (!jar) return { jar: null, items: [], tags: [] };
  if (vanilla?.jar !== jar) vanilla = { jar, assets: await VanillaAssets.open(jar) };
  return { jar, ...vanilla.assets.catalog() };
}

ipcMain.handle("vanilla:load", (_e, version: string) => openVanilla(version));

ipcMain.handle("vanilla:pickJar", async (_e, version: string) => {
  const result = await dialog.showOpenDialog(window!, {
    title: `Choose a Minecraft ${version} client jar`,
    filters: [{ name: "Minecraft jar", extensions: ["jar"] }],
    properties: ["openFile"],
  });
  if (result.canceled) return null;
  const jar = result.filePaths[0];
  const loaded = await openVanilla(version, jar);
  await mkdir(path.dirname(settingsFile()), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify({ ...(await settings()), minecraftJar: jar }, null, 2));
  return loaded;
});

ipcMain.handle("vanilla:icon", (_e, id: string) => vanilla?.assets.icon(id) ?? null);

ipcMain.handle("project:generate", async (_e, root: string) => generate(root));

ipcMain.handle("gradle:run", async (_e, root: string, task: string) => {
  if (gradle) throw new Error("A Gradle task is already running");
  if (!["build", "runClient", "clean"].includes(task)) throw new Error(`Unknown task ${task}`);
  const windows = process.platform === "win32";
  const cmd = windows ? "gradlew.bat" : "./gradlew";
  send("gradle:log", `> ${cmd} ${task}\n`);
  // Its own process group on macOS and Linux, so Stop can end Gradle and everything it started.
  gradle = spawn(cmd, [task, "--console=plain"], { cwd: root, shell: windows, detached: !windows });
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

/**
 * End the running Gradle task and the processes under it. On Windows gradlew.bat runs inside cmd.exe, so
 * killing that only ends the shell and leaves Java (and a running game) behind; taskkill /T ends the whole tree.
 * The Gradle daemon then sees its client go and cancels the build, which stops a runClient game.
 */
function stopGradle() {
  const pid = gradle?.pid;
  if (!gradle || pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      gradle.kill();
    }
  }
}

ipcMain.handle("gradle:stop", () => {
  stopGradle();
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
  // The window cancels closing while a form has unsaved edits; ask here whether to close anyway.
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window!, {
      type: "question",
      buttons: ["Close without saving", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "You have unsaved changes.",
      detail: "Close Mod Creator and lose them?",
    });
    if (choice === 0) event.preventDefault();
  });
  window.loadFile(path.join(here, "../renderer/index.html"));
});

app.on("window-all-closed", () => {
  stopGradle();
  app.quit();
});
