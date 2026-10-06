import type { BlockSpec, ElementSpec, ItemSpec, Project, RecipeSpec } from "@modcreator/core/schema";
import type { EntityModelDef } from "@modcreator/core/blockbench";
import type { ModrinthProject, ModrinthVersion } from "@modcreator/core/modrinth";
import type { StructureTemplate } from "@modcreator/core/nbt";

export type { ModrinthProject, ModrinthVersion, StructureTemplate };

/** Mirrors ItemIcon and CatalogEntry in core/src/vanilla.ts, which the window can't import (it uses Node). */
export type ItemIcon = { kind: "flat"; texture: string } | { kind: "cube"; top: string; left: string; right: string };
export interface CatalogEntry {
  id: string;
  name: string;
}

export interface VanillaCatalog {
  /** The Minecraft jar the names and icons come from, or null when none was found. */
  jar: string | null;
  items: CatalogEntry[];
  tags: CatalogEntry[];
}

export type { BlockSpec, ElementSpec, ItemSpec, Project, RecipeSpec };

export interface Issue {
  severity: "error" | "warning";
  file: string;
  field?: string;
  message: string;
}

export interface LoadedProject {
  root: string;
  project: Project;
  elements: { spec: ElementSpec; file: string }[];
  issues: Issue[];
  models: Record<string, EntityModelDef>;
}

export interface SpecEdit {
  file: string;
  spec: ElementSpec;
  fields: string[];
}

export interface GenerateResult {
  ok: boolean;
  issues: Issue[];
  written: string[];
  overridden: string[];
  created: string[];
}

export interface CreateOptions {
  modId: string;
  name: string;
  package: string;
  description?: string;
}

/** Bridge exposed by preload.cts. */
export interface ModCreatorApi {
  initialProject(): Promise<string | null>;
  pickProject(): Promise<string | null>;
  pickNewFolder(): Promise<string | null>;
  createProject(dir: string, options: CreateOptions): Promise<string>;
  loadProject(root: string): Promise<LoadedProject>;
  saveSpec(root: string, rel: string, value: unknown): Promise<void>;
  deleteSpec(root: string, rel: string): Promise<void>;
  /** Problems deleting `rel` would cause: other specs' fields that point at it. */
  dependents(root: string, rel: string): Promise<Issue[]>;
  /** Other specs rewritten to follow `rel`'s element to its new id. */
  renameEdits(root: string, rel: string, renamed: ElementSpec): Promise<SpecEdit[]>;
  modrinthSearch(query: string, minecraft: string): Promise<ModrinthProject[]>;
  modrinthVersions(slug: string, minecraft: string): Promise<ModrinthVersion[]>;
  /** Read a .bbmodel; `error` says why it can't be used. */
  loadBlockbench(root: string, rel: string): Promise<{ model: EntityModelDef | null; error: string | null }>;
  /** Read a structure block's .nbt; `error` says why it can't be used. */
  loadStructure(root: string, rel: string): Promise<{ structure: StructureTemplate | null; error: string | null }>;
  /** Pick an .nbt and copy it into art/. Returns its project path, or null when cancelled. */
  importStructure(root: string): Promise<string | null>;
  dataUrl(root: string, rel: string): Promise<string | null>;
  /** Write a PNG, given as a data: URL, to a project-relative path. */
  saveArt(root: string, rel: string, dataUrl: string): Promise<void>;
  loadVanilla(version: string): Promise<VanillaCatalog>;
  pickMinecraftJar(version: string): Promise<VanillaCatalog | null>;
  vanillaIcon(id: string): Promise<ItemIcon | null>;
  generate(root: string): Promise<GenerateResult>;
  runGradle(root: string, task: "build" | "runClient" | "clean"): Promise<number>;
  stopGradle(): Promise<void>;
  openPath(root: string, rel: string): Promise<void>;
  onGradleLog(fn: (text: string) => void): () => void;
  onProjectChanged(fn: (root: string) => void): () => void;
}

declare global {
  interface Window {
    modcreator: ModCreatorApi;
  }
}

export const api = (): ModCreatorApi => window.modcreator;
