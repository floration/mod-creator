import type { BlockSpec, ElementSpec, ItemSpec, Project, RecipeSpec } from "@modcreator/core/schema";

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
