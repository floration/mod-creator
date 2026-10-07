import type { Project } from "../../schema.js";
import { pascal } from "./java.js";

/** Pinned toolchain for the 26.3 profile. Checked 2026-10-06 against Fabric meta and Modrinth. */
export const VERSIONS = {
  minecraft: "26.3",
  loader: "0.19.5",
  loom: "1.18.2",
  fabricApi: "0.161.0+26.3",
  java: 25,
  gradle: "9.7.0",
} as const;

export const entrypointClass = (project: Project) => `${project.package}.${pascal(project.modId)}Mod`;

export function gradleProperties(project: Project, cliPath: string | null): string {
  return `org.gradle.jvmargs=-Xmx2G
org.gradle.parallel=true
org.gradle.configuration-cache=false

# Toolchain pinned by the Floration 26.3 profile
minecraft_version=${VERSIONS.minecraft}
loader_version=${VERSIONS.loader}
loom_version=${VERSIONS.loom}
fabric_api_version=${VERSIONS.fabricApi}

maven_group=${project.package}
archives_base_name=${project.modId}

# Floration CLI (packages/cli/dist/index.js in the mod-creator repo), absolute or relative to this folder.
# When set, every build regenerates src/generated from spec/ first. Remove the line to build without it.
${cliPath ? `modcreator_cli=${cliPath}` : "#modcreator_cli="}
`;
}

export function settingsGradle(project: Project): string {
  return `pluginManagement {
\trepositories {
\t\tmaven {
\t\t\tname = 'Fabric'
\t\t\turl = 'https://maven.fabricmc.net/'
\t\t}
\t\tmavenCentral()
\t\tgradlePluginPortal()
\t}
}

rootProject.name = '${project.modId}'
`;
}

/** Marker that tells checkSetup a build.gradle reads modcreator.json itself. */
export const GRADLE_READS_PROJECT = "MODCREATOR_PROJECT";

export function buildGradle(_project: Project): string {
  return `plugins {
\tid 'net.fabricmc.fabric-loom' version "\${loom_version}"
}

// modcreator.json is read on every build, so the version and Modrinth dependencies set there
// (in the Floration app or by hand) apply without editing this file.
def ${GRADLE_READS_PROJECT} = new groovy.json.JsonSlurper().parse(file('modcreator.json'))

version = ${GRADLE_READS_PROJECT}.version
group = project.maven_group

base {
\tarchivesName = project.archives_base_name
}

repositories {
\texclusiveContent {
\t\tforRepository {
\t\t\tmaven {
\t\t\t\tname = 'Modrinth'
\t\t\t\turl = 'https://api.modrinth.com/maven'
\t\t\t}
\t\t}
\t\tfilter {
\t\t\tincludeGroup 'maven.modrinth'
\t\t}
\t}
}

dependencies {
\tminecraft "com.mojang:minecraft:\${project.minecraft_version}"
\timplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
\timplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_api_version}"

\t// Modrinth dependencies from modcreator.json
\t${GRADLE_READS_PROJECT}.dependencies?.each { implementation "maven.modrinth:\${it.slug}:\${it.version}" }
}

// Floration writes generated code and assets here. Hand-written files stay in src/main.
sourceSets {
\tmain {
\t\tjava.srcDir 'src/generated/java'
\t\tresources.srcDir 'src/generated/resources'
\t}
}

def modcreatorCli = providers.gradleProperty('modcreator_cli')
def generateModContent = tasks.register('generateModContent', Exec) {
\tgroup = 'mod creator'
\tdescription = 'Regenerates src/generated from spec/ with the Floration CLI.'
\tonlyIf { modcreatorCli.isPresent() }
\tinputs.file('modcreator.json')
\tinputs.files(fileTree('spec'), fileTree('art'))
\toutputs.dir('src/generated')
\tcommandLine 'node', file(modcreatorCli.getOrElse('.')).absolutePath, 'generate', projectDir.absolutePath
}

tasks.named('compileJava') { dependsOn generateModContent }
tasks.named('processResources') { dependsOn generateModContent }
tasks.matching { it.name == 'sourcesJar' }.configureEach { dependsOn generateModContent }

def requiredMods = (${GRADLE_READS_PROJECT}.dependencies ?: []).findAll { it.required != false }*.slug
processResources {
\tinputs.property 'version', project.version
\tinputs.property 'requiredMods', requiredMods

\tfilesMatching('fabric.mod.json') {
\t\texpand 'version': inputs.properties.version
\t}
\t// Required dependencies from modcreator.json are added to "depends" in the built jar.
\tdoLast {
\t\tdef modJson = file("\${destinationDir}/fabric.mod.json")
\t\tif (!modJson.exists()) return
\t\tdef meta = new groovy.json.JsonSlurper().parse(modJson)
\t\tmeta.depends = meta.depends ?: [:]
\t\trequiredMods.each { if (!meta.depends.containsKey(it)) meta.depends[it] = '*' }
\t\tmodJson.text = groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(meta)) + '\\n'
\t}
}

tasks.withType(JavaCompile).configureEach {
\tit.options.release = ${VERSIONS.java}
}

java {
\twithSourcesJar()
\tsourceCompatibility = JavaVersion.VERSION_${VERSIONS.java}
\ttargetCompatibility = JavaVersion.VERSION_${VERSIONS.java}
}
`;
}

export function fabricModJson(project: Project): string {
  const depends: Record<string, string> = {
    fabricloader: `>=${VERSIONS.loader}`,
    minecraft: `~${VERSIONS.minecraft}`,
    java: `>=${VERSIONS.java}`,
    "fabric-api": "*",
  };
  for (const d of project.dependencies) if (d.required) depends[d.slug] = "*";
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        id: project.modId,
        version: "${version}",
        name: project.name,
        description: project.description,
        authors: project.authors,
        license: "All-Rights-Reserved",
        environment: "*",
        entrypoints: { main: [entrypointClass(project)], client: [`${project.package}.generated.ModContentClient`] },
        depends,
      },
      null,
      2,
    ) + "\n"
  );
}

export function entrypointJava(project: Project): string {
  const fqcn = entrypointClass(project);
  const name = fqcn.slice(fqcn.lastIndexOf(".") + 1);
  return `package ${project.package};

import net.fabricmc.api.ModInitializer;

import ${project.package}.generated.ModContent;

/** Your mod's entrypoint. Floration created this file once; it is yours to edit. */
public class ${name} implements ModInitializer {
\t@Override
\tpublic void onInitialize() {
\t\tModContent.register();

\t\t// Add hand-written setup below.
\t}
}
`;
}

export const MOD_GITIGNORE = `# Gradle and IDE output
.gradle/
build/
out/
run/
.idea/
*.iml
.vscode/
`;
