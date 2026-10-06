// `npm run app`: bring this checkout up to date, rebuild, then open the app.
// Updating is skipped when offline, on a branch other than main, or with uncommitted changes;
// pass --no-update to skip it on purpose. Anything after the flags goes to the app, like --project.
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const args = process.argv.slice(2);
const noUpdate = args.includes("--no-update");
const appArgs = args.filter((a) => a !== "--no-update");

function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", shell: windows && cmd === "npm", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, ...opts });
}

function git(...gitArgs) {
  const r = run("git", gitArgs, { timeout: 60_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

const lockHash = () => {
  const file = path.join(root, "package-lock.json");
  return existsSync(file) ? createHash("sha1").update(readFileSync(file)).digest("hex") : "";
};

/** Pull main if it can fast-forward cleanly. */
function update() {
  if (noUpdate) return;
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch === null) {
    console.log("Not a git checkout; starting without updating.");
    return;
  }
  if (branch !== "main") {
    console.log(`On branch ${branch}, not main; starting without updating.`);
    return;
  }
  if (git("status", "--porcelain", "--untracked-files=no")) {
    console.log("You have uncommitted changes in the tool's code; starting without updating.");
    return;
  }
  const before = git("rev-parse", "HEAD");
  console.log("Checking for updates…");
  if (git("pull", "--ff-only", "--quiet", "origin", "main") === null) {
    console.log("Couldn't reach GitHub or main can't fast-forward; starting the version you have.");
    return;
  }
  const after = git("rev-parse", "HEAD");
  if (before === after) {
    console.log("Already up to date.");
    return;
  }
  console.log(`Updated to ${git("log", "-1", "--format=%h %s")}`);
}

const lockBefore = lockHash();
update();

if (!existsSync(path.join(root, "node_modules")) || lockHash() !== lockBefore) {
  console.log("Installing packages…");
  if (run("npm", ["install"], { stdio: "inherit" }).status !== 0) process.exit(1);
}

// Always rebuild: it takes seconds and keeps hand edits to the tool's own source in step too.
console.log("Building…");
if (run("npm", ["run", "build"], { stdio: "inherit" }).status !== 0) process.exit(1);

const appDir = path.join(root, "packages", "app");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const child = spawn(electron, [".", ...appArgs], { cwd: appDir, stdio: "inherit" });
child.on("close", (code) => process.exit(code ?? 0));
