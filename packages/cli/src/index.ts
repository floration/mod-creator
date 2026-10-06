#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createProject, generate, loadProject, type Issue } from "@modcreator/core";

const USAGE = `Usage:
  modcreator new <folder> --id <modid> --name "<Name>" --package <java.package> [--description "..."] [--author <name>]
  modcreator generate [folder]     Rewrite src/generated from spec/ (default folder: current)
  modcreator check [folder]        Validate specs without writing anything
`;

const CLI_PATH = fileURLToPath(import.meta.url);

function printIssues(issues: Issue[]) {
  for (const i of issues) {
    const where = i.field ? `${i.file} (${i.field})` : i.file;
    console.error(`${i.severity === "error" ? "error" : "warning"}: ${where}: ${i.message}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "new") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        id: { type: "string" },
        name: { type: "string" },
        package: { type: "string" },
        description: { type: "string" },
        author: { type: "string", multiple: true },
      },
    });
    const folder = positionals[0];
    if (!folder || !values.id || !values.name || !values.package) {
      console.error(USAGE);
      return 2;
    }
    await createProject(folder, {
      modId: values.id,
      name: values.name,
      package: values.package,
      description: values.description,
      authors: values.author,
      cliPath: CLI_PATH,
    });
    console.log(`Created ${values.name} in ${path.resolve(folder)}.`);
    console.log("Add specs under spec/, then run `modcreator generate` or `gradlew build`.");
    return 0;
  }
  if (command === "generate") {
    const result = await generate(rest[0] ?? ".");
    printIssues(result.issues);
    if (!result.ok) {
      console.error("Nothing was written. Fix the errors above and run generate again.");
      return 1;
    }
    console.log(`Generated ${result.written.length} files into src/generated.`);
    for (const f of result.overridden) console.log(`  kept your src/main/resources/${f}`);
    for (const f of result.created) console.log(`  created starter class ${f}`);
    return 0;
  }
  if (command === "check") {
    const loaded = await loadProject(rest[0] ?? ".");
    printIssues(loaded.issues);
    const errors = loaded.issues.filter((i) => i.severity === "error").length;
    console.log(`${loaded.elements.length} specs, ${errors} errors.`);
    return errors ? 1 : 0;
  }
  console.error(USAGE);
  return command ? 2 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  },
);
