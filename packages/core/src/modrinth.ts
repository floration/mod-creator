/**
 * Modrinth lookups for the project settings page: find a Fabric mod for this Minecraft version, then pick one of
 * its builds. A dependency stores the build's version id, which `maven.modrinth` accepts and which, unlike a
 * version number, never names a build for another loader.
 */

const API = "https://api.modrinth.com/v2";
const HEADERS = { "User-Agent": "floration/mod-creator (Minecraft mod tool)" };

export interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
}

export interface ModrinthVersion {
  /** What `modcreator.json` stores. */
  id: string;
  versionNumber: string;
  name: string;
  type: "release" | "beta" | "alpha";
  published: string;
}

export function modrinthSearchUrl(query: string, minecraft: string, limit = 10): string {
  const facets = JSON.stringify([["categories:fabric"], [`versions:${minecraft}`], ["project_type:mod"]]);
  return `${API}/search?query=${encodeURIComponent(query)}&limit=${limit}&facets=${encodeURIComponent(facets)}`;
}

export function modrinthVersionsUrl(slug: string, minecraft: string): string {
  const loaders = encodeURIComponent(JSON.stringify(["fabric"]));
  const versions = encodeURIComponent(JSON.stringify([minecraft]));
  return `${API}/project/${encodeURIComponent(slug)}/version?loaders=${loaders}&game_versions=${versions}`;
}

type Json = Record<string, unknown>;

async function get(url: string, fetcher: typeof fetch): Promise<unknown> {
  const res = await fetcher(url, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Modrinth answered ${res.status} ${res.statusText}`);
  return res.json();
}

/** Fabric mods for this Minecraft version matching `query`, most relevant first. */
export async function searchModrinth(query: string, minecraft: string, fetcher: typeof fetch = fetch): Promise<ModrinthProject[]> {
  const body = (await get(modrinthSearchUrl(query, minecraft), fetcher)) as { hits?: Json[] } | null;
  return (body?.hits ?? []).map((h) => ({
    slug: String(h.slug),
    title: String(h.title ?? h.slug),
    description: String(h.description ?? ""),
    iconUrl: typeof h.icon_url === "string" && h.icon_url ? h.icon_url : null,
    downloads: Number(h.downloads ?? 0),
  }));
}

/** A project's Fabric builds for this Minecraft version, newest first. Empty when it has none or doesn't exist. */
export async function modrinthVersions(slug: string, minecraft: string, fetcher: typeof fetch = fetch): Promise<ModrinthVersion[]> {
  const body = (await get(modrinthVersionsUrl(slug, minecraft), fetcher)) as Json[] | null;
  return (body ?? [])
    .map((v) => ({
      id: String(v.id),
      versionNumber: String(v.version_number ?? v.id),
      name: String(v.name ?? v.version_number ?? v.id),
      type: (["release", "beta", "alpha"].includes(String(v.version_type)) ? v.version_type : "release") as ModrinthVersion["type"],
      published: String(v.date_published ?? ""),
    }))
    .sort((a, b) => b.published.localeCompare(a.published));
}

/** The build to suggest: the newest release, else the newest build of any kind. */
export function suggestedVersion(versions: ModrinthVersion[]): ModrinthVersion | null {
  return versions.find((v) => v.type === "release") ?? versions[0] ?? null;
}
