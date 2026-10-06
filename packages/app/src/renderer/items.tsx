import { createContext, useContext, useEffect, useMemo, useState, type DragEvent } from "react";
import { itemIconArt, registeredItems } from "@modcreator/core/schema";
import { TagContext } from "./TagField";
import { api, type CatalogEntry, type ElementSpec, type ItemIcon, type VanillaCatalog } from "./api";

/** What the item slots need to know about the open project and the player's Minecraft install. */
export interface ItemWorld {
  root: string;
  modId: string;
  version: string;
  elements: ElementSpec[];
  vanilla: VanillaCatalog | null;
  pickJar: () => void;
}

export const ItemContext = createContext<ItemWorld | null>(null);

const titleCase = (s: string) => s.split(/[_/]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** `ruby` and `<modid>:ruby` are this mod's; everything else belongs to Minecraft or another mod. */
function ownId(world: ItemWorld, ref: string): string | null {
  if (!ref.includes(":")) return ref;
  return ref.startsWith(`${world.modId}:`) ? ref.slice(world.modId.length + 1) : null;
}

/** Every item this mod registers, including the several that armor, trees and mobs each add. */
function ownItems(elements: ElementSpec[]) {
  return elements.flatMap((spec) => registeredItems(spec).map(([id, name]) => ({ id, name, spec })));
}

const itemIndexes = new WeakMap<ElementSpec[], Map<string, { id: string; name: string; spec: ElementSpec }>>();
function ownItem(world: ItemWorld, ref: string) {
  const id = ownId(world, ref);
  if (id == null) return undefined;
  let index = itemIndexes.get(world.elements);
  if (!index) itemIndexes.set(world.elements, (index = new Map(ownItems(world.elements).map((e) => [e.id, e]))));
  return index.get(id);
}

export interface ItemInfo {
  name: string;
  /** False for ids that point at nothing: a typo, or an item this mod doesn't define. */
  known: boolean;
  /** Where the item comes from, shown under its name. */
  source: string;
}

export function itemInfo(world: ItemWorld, ref: string): ItemInfo {
  if (ref.startsWith("?")) return { name: `Letter "${ref[1]}"`, known: false, source: "not in the recipe's key" };
  const tag = ref.startsWith("#");
  const bare = tag ? ref.slice(1) : ref;
  const own = ownId(world, bare);
  if (tag) return { name: `Any ${titleCase(bare.split(":").pop()!)}`, known: true, source: `tag ${own != null ? `${world.modId}:${own}` : bare}` };
  if (own != null) {
    const el = ownItem(world, bare);
    return el ? { name: el.name, known: true, source: world.modId } : { name: own, known: false, source: `not in ${world.modId}` };
  }
  const [ns, path] = bare.split(":");
  if (ns === "minecraft" && world.vanilla?.jar) {
    const entry = vanillaIndex(world.vanilla).get(bare);
    return entry ? { name: entry.name, known: true, source: "minecraft" } : { name: path, known: false, source: "not in Minecraft" };
  }
  return { name: titleCase(path ?? bare), known: true, source: ns };
}

const indexes = new WeakMap<VanillaCatalog, Map<string, CatalogEntry>>();
function vanillaIndex(catalog: VanillaCatalog): Map<string, CatalogEntry> {
  let index = indexes.get(catalog);
  if (!index) indexes.set(catalog, (index = new Map([...catalog.items, ...catalog.tags].map((e) => [e.id, e]))));
  return index;
}

/** Where to get the icon for a ref: this mod's art files, or the Minecraft jar. */
export async function iconFor(world: ItemWorld, ref: string): Promise<ItemIcon | null> {
  if (ref.startsWith("?")) return null;
  const tag = ref.startsWith("#");
  const bare = tag ? ref.slice(1) : ref;
  if (!tag) {
    if (ownId(world, bare) != null) {
      const el = ownItem(world, bare);
      const icon = el && itemIconArt(el.spec, el.id);
      const art = (rel: string) => api().dataUrl(world.root, rel);
      if (icon?.kind === "flat") {
        const texture = await art(icon.texture);
        return texture ? { kind: "flat", texture } : null;
      }
      if (icon?.kind === "cube") {
        const [top, side] = await Promise.all([art(icon.top), art(icon.side)]);
        return top && side ? { kind: "cube", top, left: side, right: side } : null;
      }
      return null;
    }
  }
  return world.vanilla?.jar ? api().vanillaIcon(ref) : null;
}

const SIZE = 64;
const drawn = new Map<string, Promise<string | null>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** One face of a texture: the first animation frame, darkened like Minecraft shades block sides. */
function face(img: HTMLImageElement, shade: number): HTMLCanvasElement {
  const w = img.width;
  const c = document.createElement("canvas");
  c.width = c.height = w;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, w, 0, 0, w, w);
  if (shade < 1) {
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = `rgba(0,0,0,${1 - shade})`;
    g.fillRect(0, 0, w, w);
  }
  return c;
}

/** Render an icon to a PNG the way the inventory shows it: sprites flat, blocks as a little isometric cube. */
function drawIcon(icon: ItemIcon): Promise<string | null> {
  const cacheKey = icon.kind === "flat" ? icon.texture : `${icon.top}|${icon.left}|${icon.right}`;
  if (!drawn.has(cacheKey)) {
    drawn.set(
      cacheKey,
      (async () => {
        const c = document.createElement("canvas");
        c.width = c.height = SIZE;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        if (icon.kind === "flat") {
          const img = await loadImage(icon.texture);
          g.drawImage(img, 0, 0, img.width, img.width, 0, 0, SIZE, SIZE);
          return c.toDataURL();
        }
        const [top, left, right] = await Promise.all([icon.top, icon.left, icon.right].map(loadImage));
        // Corners of the cube on a 64px canvas: top point, left, centre, right, and 30px of height.
        const paint = (src: HTMLCanvasElement, ux: number, uy: number, vx: number, vy: number, ox: number, oy: number) => {
          const n = src.width;
          g.setTransform(ux / n, uy / n, vx / n, vy / n, ox, oy);
          g.drawImage(src, 0, 0);
        };
        paint(face(top, 1), 28, -15, 28, 15, 4, 17);
        paint(face(left, 0.8), 28, 15, 0, 30, 4, 17);
        paint(face(right, 0.6), 28, -15, 0, 30, 32, 32);
        return c.toDataURL();
      })().catch(() => null),
    );
  }
  return drawn.get(cacheKey)!;
}

/** The rendered icon for a ref, or null while loading or when there is none. */
export function useItemIcon(ref: string | null): string | null {
  const world = useContext(ItemContext);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!world || !ref) return;
    let live = true;
    iconFor(world, ref)
      .then((icon) => (icon ? drawIcon(icon) : null))
      .then((s) => live && setSrc(s))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [world, ref]);
  return src;
}

export function ItemIconView({ refId, size = 32 }: { refId: string; size?: number }) {
  const world = useContext(ItemContext)!;
  const src = useItemIcon(refId);
  const info = itemInfo(world, refId);
  if (src) return <img className="item-icon" src={src} width={size} height={size} alt="" draggable={false} />;
  return (
    <span className={`item-icon placeholder${info.known ? "" : " unknown"}`} style={{ width: size, height: size, fontSize: size * 0.5 }}>
      {refId.startsWith("?") ? "?" : info.name[0]?.toUpperCase()}
    </span>
  );
}

const DRAG_TYPE = "application/x-modcreator-item";

export function dragItem(e: DragEvent, ref: string, from?: number) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ref, from }));
  e.dataTransfer.effectAllowed = "copyMove";
}

export function droppedItem(e: DragEvent): { ref: string; from?: number } | null {
  const data = e.dataTransfer.getData(DRAG_TYPE);
  return data ? JSON.parse(data) : null;
}

export const acceptsItem = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);

/** A search box over this mod's items and blocks, Minecraft's items and item tags. Click or drag an entry to use it. */
export function ItemPicker({ held, onHold }: { held: string | null; onHold: (ref: string | null) => void }) {
  const world = useContext(ItemContext)!;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"mod" | "minecraft" | "tags">("mod");
  const q = query.trim().toLowerCase();
  const match = (e: CatalogEntry) => !q || e.name.toLowerCase().includes(q) || e.id.includes(q);

  const own = useMemo<CatalogEntry[]>(() => ownItems(world.elements).map(({ id, name }) => ({ id, name })), [world.elements]);
  // Minecraft's item tags, then Fabric's shared `c:` ones and the mod's own, which recipes can use too.
  const tagSources = useContext(TagContext)?.sources;
  const tags = useMemo<CatalogEntry[]>(() => {
    const vanilla = world.vanilla?.tags ?? [];
    const known = new Set(vanilla.map((e) => e.id));
    const more = [...(tagSources?.fabric.item ?? []), ...(tagSources?.mod.item ?? [])]
      .filter((t) => !known.has(`#${t.id}`) && Boolean(known.add(`#${t.id}`)))
      .map((t) => ({ id: `#${t.id}`, name: t.name ? `Any ${t.name}` : `Any ${titleCase(t.id.split(":").pop()!)}` }));
    return [...vanilla, ...more];
  }, [world.vanilla, tagSources]);
  const lists = { mod: own, minecraft: world.vanilla?.items ?? [], tags };
  const LIMIT = 150;
  const shown = lists[tab].filter(match);
  // An id typed by hand, for items from other mods or anything the lists don't have.
  const typed = /^#?([a-z0-9_.-]+:)?[a-z0-9_/.-]+$/.test(q) && q.includes(":") && !shown.some((e) => e.id === q) ? q : null;

  return (
    <div className="picker">
      <div className="picker-head">
        <input placeholder="Search items, like ruby or stick" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="picker-tabs">
          {(["mod", "minecraft", "tags"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "mod" ? world.modId : t === "minecraft" ? "Minecraft" : "Tags"}
              {q && <span className="muted"> {lists[t].filter(match).length}</span>}
            </button>
          ))}
        </div>
      </div>
      {tab !== "mod" && !world.vanilla?.jar && (
        <div className="picker-note">
          Minecraft's items are read from your Minecraft {world.version} jar, and none was found. It appears after the first Build, or you can{" "}
          <button className="link" onClick={world.pickJar}>choose the jar</button>.
        </div>
      )}
      <div className="picker-list">
        {typed && (
          <button className={`picker-entry${held === typed ? " held" : ""}`} onClick={() => onHold(held === typed ? null : typed)} draggable onDragStart={(e) => dragItem(e, typed)}>
            <ItemIconView refId={typed} />
            <span>Use {typed}</span>
          </button>
        )}
        {shown.slice(0, LIMIT).map((e) => (
          <button
            key={e.id}
            className={`picker-entry${held === e.id ? " held" : ""}`}
            title={e.id}
            onClick={() => onHold(held === e.id ? null : e.id)}
            draggable
            onDragStart={(ev) => dragItem(ev, e.id)}
          >
            <ItemIconView refId={e.id} />
            <span>{e.name}</span>
          </button>
        ))}
        {shown.length > LIMIT && <div className="picker-note">{shown.length - LIMIT} more. Type to narrow it down.</div>}
        {shown.length === 0 && !typed && <div className="picker-note">Nothing matches. Type a full id like othermod:thing to use it anyway.</div>}
      </div>
    </div>
  );
}
