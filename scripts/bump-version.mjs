// `npm run bump`: raise the patch number (0.2.0 -> 0.2.1) of the root package and every workspace together,
// then refresh package-lock.json. Every pull request runs this once; see CONTRIBUTING.md.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["package.json", "packages/core/package.json", "packages/cli/package.json", "packages/app/package.json"];
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));

const current = read("package.json").version;
const [major, minor, patch] = current.split(".").map(Number);
const next = `${major}.${minor}.${patch + 1}`;

for (const f of files) {
  const pkg = read(f);
  pkg.version = next;
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    for (const name of Object.keys(deps ?? {})) if (name.startsWith("@modcreator/")) deps[name] = next;
  }
  writeFileSync(path.join(root, f), JSON.stringify(pkg, null, 2) + "\n");
}
const npm = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (npm.status !== 0) process.exit(npm.status ?? 1);
console.log(`${current} -> ${next}`);
