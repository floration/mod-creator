import { describe, expect, it } from "vitest";
import { modrinthSearchUrl, modrinthVersions, searchModrinth, suggestedVersion } from "../src/modrinth.js";

/** A fetch that answers from a table of URL substrings, and records what was asked. */
function fakeFetch(answers: [string, unknown, number?][]) {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    const hit = answers.find(([part]) => url.includes(part));
    const status = hit ? (hit[2] ?? 200) : 404;
    return { ok: status < 400, status, statusText: "", json: async () => hit?.[1] } as Response;
  }) as unknown as typeof fetch;
  return { fetcher, asked };
}

describe("Modrinth", () => {
  it("searches Fabric mods for the project's Minecraft version", async () => {
    const { fetcher, asked } = fakeFetch([["/search", { hits: [{ slug: "biolith", title: "Biolith", description: "Biome placement", icon_url: "", downloads: 1200 }] }]]);
    const hits = await searchModrinth("bio lith", "26.3", fetcher);
    expect(hits).toEqual([{ slug: "biolith", title: "Biolith", description: "Biome placement", iconUrl: null, downloads: 1200 }]);
    const facets = JSON.parse(new URL(asked[0]).searchParams.get("facets")!);
    expect(facets).toEqual([["categories:fabric"], ["versions:26.3"], ["project_type:mod"]]);
    expect(new URL(modrinthSearchUrl("bio lith", "26.3")).searchParams.get("query")).toBe("bio lith");
  });

  it("lists builds newest first and suggests the newest release", async () => {
    const { fetcher, asked } = fakeFetch([
      ["/project/biolith/version", [
        { id: "OLD", version_number: "3.7.0", version_type: "release", date_published: "2026-08-01T00:00:00Z" },
        { id: "BETA", version_number: "3.8.0-beta.1", version_type: "beta", date_published: "2026-09-20T00:00:00Z" },
        { id: "NEW", version_number: "3.7.1", version_type: "release", date_published: "2026-09-01T00:00:00Z" },
      ]],
    ]);
    const versions = await modrinthVersions("biolith", "26.3", fetcher);
    expect(versions.map((v) => v.id)).toEqual(["BETA", "NEW", "OLD"]);
    expect(suggestedVersion(versions)?.id).toBe("NEW");
    const url = new URL(asked[0]);
    expect(JSON.parse(url.searchParams.get("loaders")!)).toEqual(["fabric"]);
    expect(JSON.parse(url.searchParams.get("game_versions")!)).toEqual(["26.3"]);
  });

  it("treats an unknown project as having no builds, and other failures as errors", async () => {
    const missing = fakeFetch([]);
    expect(await modrinthVersions("nope", "26.3", missing.fetcher)).toEqual([]);
    const down = fakeFetch([["/search", null, 503]]);
    await expect(searchModrinth("x", "26.3", down.fetcher)).rejects.toThrow(/503/);
    expect(suggestedVersion([])).toBeNull();
  });
});
