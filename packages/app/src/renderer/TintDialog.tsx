import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { bakeTint, isVanillaTexture, maskWeights, suggestedMask, tintTextures, type TintLayer, type TintMask, type TintMode, type TintRecipe } from "@modcreator/core/tint";
import { api } from "./api";
import { ItemContext } from "./items";
import { colorsIn, pixelsFromUrl, toCanvas, toHex, type Pixels } from "./pixels";

/** Stands for "the texture as it is now" (the PNG on disk, or the pixel editor's drawing) as a recipe's base. */
const CURRENT = "@current";

const MODES: { mode: TintMode; label: string; hint: string }[] = [
  { mode: "recolor", label: "Recolor", hint: "Keeps the shading and moves the average color to yours" },
  { mode: "multiply", label: "Multiply", hint: "Multiplies by your color, like Factorio's tint; best on grey textures" },
  { mode: "paint", label: "Paint", hint: "Covers the masked pixels with flat color" },
];

const MASKS: { kind: TintMask["kind"]; label: string }[] = [
  { kind: "all", label: "Whole texture" },
  { kind: "colors", label: "Colors I pick" },
  { kind: "differs", label: "Where it differs from…" },
  { kind: "image", label: "Mask image" },
];

const newLayer = (mask: TintMask = { kind: "all" }): TintLayer => ({ color: "#c03030", mode: "recolor", strength: 1, mask });

/** Vanilla texture lists and PNGs, cached for the whole session since the jar doesn't change under us. */
let vanillaList: Promise<string[]> | null = null;
const vanillaUrls = new Map<string, Promise<string | null>>();
const vanillaUrl = (id: string) => {
  if (!vanillaUrls.has(id)) vanillaUrls.set(id, api().vanillaTexture(id));
  return vanillaUrls.get(id)!;
};

function useVanillaTextures(): string[] | null {
  const items = useContext(ItemContext);
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    if (!items?.vanilla?.jar) return setList([]);
    vanillaList ??= api().vanillaTextures();
    let live = true;
    vanillaList.then((l) => {
      if (!l.length) vanillaList = null;
      if (live) setList(l);
    });
    return () => {
      live = false;
    };
  }, [items?.vanilla?.jar]);
  return list;
}

/** The first frame of an animated strip, so previews show one square. */
function firstFrame(p: Pixels): Pixels {
  if (p.height <= p.width || p.height % p.width) return p;
  return { width: p.width, height: p.width, data: p.data.slice(0, p.width * p.width * 4) };
}

/** Pixels drawn big on a checkerboard, optionally with a mask shown as a highlight. Clicks report the pixel. */
function PixelView(p: { pixels: Pixels; size: number; weights?: Float32Array | null; tiles?: number; onPick?: (x: number, y: number) => void; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tiles = p.tiles ?? 1;
  const scale = Math.max(1, Math.floor(p.size / (Math.max(p.pixels.width, p.pixels.height) * tiles)));
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { width: w, height: h } = p.pixels;
    c.width = w * scale * tiles;
    c.height = h * scale * tiles;
    const g = c.getContext("2d")!;
    const check = Math.max(4, scale / 2);
    for (let y = 0; y < c.height; y += check) {
      for (let x = 0; x < c.width; x += check) {
        g.fillStyle = (x / check + y / check) % 2 ? "#3a3c42" : "#4a4c53";
        g.fillRect(x, y, check, check);
      }
    }
    g.imageSmoothingEnabled = false;
    const img = toCanvas(p.pixels);
    for (let ty = 0; ty < tiles; ty++) for (let tx = 0; tx < tiles; tx++) g.drawImage(img, tx * w * scale, ty * h * scale, w * scale, h * scale);
    if (p.weights) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = p.weights[y * w + x];
          if (k <= 0) continue;
          g.fillStyle = `rgba(255,220,60,${0.5 * k})`;
          g.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }
  }, [p.pixels, p.weights, scale, tiles]);
  const click = (e: React.MouseEvent) => {
    if (!p.onPick) return;
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * p.pixels.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * p.pixels.height);
    if (x >= 0 && y >= 0 && x < p.pixels.width && y < p.pixels.height) p.onPick(x, y);
  };
  return <canvas ref={ref} className={`tint-view${p.onPick ? " pickable" : ""}`} onClick={click} title={p.title} />;
}

function VanillaThumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    vanillaUrl(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return <span className="texture-thumb small">{url && <img src={url} alt="" />}</span>;
}

const CATEGORIES = ["block", "item", "entity", "all"] as const;

/** Search Minecraft's own textures by name and pick one. */
function VanillaBrowser(p: { value: string; onPick: (id: string) => void }) {
  const list = useVanillaTextures();
  const items = useContext(ItemContext);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("block");
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (list ?? []).filter((id) => (category === "all" || id.startsWith(`minecraft:${category}/`)) && words.every((w) => id.includes(w)));
  }, [list, query, category]);
  if (list === null) return <div className="muted">Loading Minecraft's textures…</div>;
  if (!list.length) {
    return (
      <div className="picker-note">
        Minecraft's textures come from the game's jar, which wasn't found.{" "}
        {items && <button type="button" onClick={items.pickJar}>Choose the Minecraft jar…</button>}
      </div>
    );
  }
  return (
    <div className="picker tint-browser">
      <div className="picker-head">
        <input autoFocus placeholder="Search Minecraft textures, like iron ore" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="picker-tabs">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c === "all" ? "Everything" : c[0].toUpperCase() + c.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="picker-list">
        {shown.slice(0, 120).map((id) => (
          <button type="button" key={id} className={`picker-entry${id === p.value ? " held" : ""}`} title={id} onClick={() => p.onPick(id)}>
            <VanillaThumb id={id} />
            <span>{id.slice(id.indexOf("/") + 1)}</span>
          </button>
        ))}
        {shown.length > 120 && <div className="picker-note">{shown.length - 120} more. Type to narrow it down.</div>}
        {!shown.length && <div className="picker-note">No texture matches.</div>}
      </div>
    </div>
  );
}

/** A texture used by a mask: a vanilla id (with autocomplete) or a PNG in art/. */
function TextureRefInput(p: { value: string; onChange: (ref: string) => void }) {
  const list = useVanillaTextures();
  return (
    <span className="texture-field">
      {isVanillaTexture(p.value) ? <VanillaThumb id={p.value} /> : null}
      <input list="tint-vanilla-textures" placeholder="minecraft:block/stone or art/mask.png" value={p.value} onChange={(e) => p.onChange(e.target.value.trim())} />
      <datalist id="tint-vanilla-textures">
        {(list ?? []).map((id) => <option key={id} value={id} />)}
      </datalist>
    </span>
  );
}

export interface TintDialogProps {
  root: string;
  /** The PNG being made, like art/ruby_ore.png. */
  file: string;
  /**
   * "save" writes the PNG and its recipe (from a texture field). "apply" hands the pixels back to the pixel editor,
   * which passes its drawing as `current`.
   */
  mode: "save" | "apply";
  current?: Pixels | null;
  onSaved?: () => void;
  onApply?: (pixels: Pixels) => void;
  onClose: () => void;
}

/** Make a texture by tinting another one, through color masks, Factorio style. */
export function TintDialog(p: TintDialogProps) {
  const [current, setCurrent] = useState<Pixels | null | undefined>(p.current);
  const [recipe, setRecipe] = useState<TintRecipe | null>(null);
  const [hadRecipe, setHadRecipe] = useState(false);
  const [active, setActive] = useState(0);
  const [showMask, setShowMask] = useState(true);
  const [browsing, setBrowsing] = useState(false);
  const [textures, setTextures] = useState<Map<string, Pixels | null>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Start from the saved recipe if there is one, else from the texture as it is, else from a Minecraft texture.
  useEffect(() => {
    let live = true;
    (async () => {
      let now = p.current;
      if (now === undefined) {
        const url = await api().dataUrl(p.root, p.file).catch(() => null);
        now = url ? await pixelsFromUrl(url).catch(() => null) : null;
      }
      const saved = p.mode === "save" ? await api().readTint(p.root, p.file).catch(() => null) : null;
      if (!live) return;
      setCurrent(now);
      setHadRecipe(!!saved);
      setRecipe(saved ?? { base: now ? CURRENT : "", layers: [newLayer()] });
      setBrowsing(!saved && !now);
    })();
    return () => {
      live = false;
    };
  }, [p.root, p.file, p.mode, p.current]);

  // Load every texture the recipe reads that isn't loaded yet.
  const needed = useMemo(() => (recipe ? tintTextures(recipe).filter((r) => r && r !== CURRENT) : []), [recipe]);
  useEffect(() => {
    const missing = needed.filter((r) => !textures.has(r) && (isVanillaTexture(r) || /^art\/.+\.png$/i.test(r)));
    if (!missing.length) return;
    let live = true;
    Promise.all(
      missing.map(async (r) => {
        const url = isVanillaTexture(r) ? await vanillaUrl(r) : await api().dataUrl(p.root, r).catch(() => null);
        return [r, url ? await pixelsFromUrl(url).catch(() => null) : null] as const;
      }),
    ).then((loaded) => {
      if (live) setTextures((t) => new Map([...t, ...loaded]));
    });
    return () => {
      live = false;
    };
  }, [needed, textures, p.root]);

  const known = useMemo(() => {
    const m = new Map<string, Pixels>();
    for (const [k, v] of textures) if (v) m.set(k, v);
    if (current) m.set(CURRENT, current);
    return m;
  }, [textures, current]);

  const base = recipe?.base ? known.get(recipe.base) ?? null : null;
  const baked = useMemo((): { pixels: Pixels | null; error: string | null } => {
    if (!recipe || !base) return { pixels: null, error: null };
    try {
      return { pixels: bakeTint(recipe, known) as Pixels, error: null };
    } catch (e) {
      return { pixels: null, error: (e as Error).message };
    }
  }, [recipe, base, known]);

  const layer = recipe?.layers[active];
  const weights = useMemo(() => {
    if (!showMask || !base || !layer) return null;
    try {
      return maskWeights(base, layer, known);
    } catch {
      return null;
    }
  }, [showMask, base, layer, known]);
  const palette = useMemo(() => (base ? colorsIn(base, 40) : []), [base]);

  const edit = (next: TintRecipe) => {
    setRecipe(next);
    setDirty(true);
  };
  const editLayer = (i: number, change: Partial<TintLayer>) => recipe && edit({ ...recipe, layers: recipe.layers.map((l, j) => (j === i ? { ...l, ...change } : l)) });
  const setMask = (i: number, mask: TintMask) => editLayer(i, { mask });

  const pickBase = (ref: string) => {
    if (!recipe) return;
    // A fresh single layer over a vanilla ore starts out masking just the ore.
    const fresh = recipe.layers.length === 1 && recipe.layers[0].mask.kind === "all";
    edit({ base: ref, layers: fresh && ref !== CURRENT ? [{ ...recipe.layers[0], mask: suggestedMask(ref) }] : recipe.layers });
    setBrowsing(false);
  };

  const toggleColor = (hex: string) => {
    if (!layer) return;
    const colors = layer.mask.kind === "colors" ? layer.mask.colors : [];
    const tolerance = layer.mask.kind === "colors" ? layer.mask.tolerance : 24;
    setMask(active, { kind: "colors", tolerance, colors: colors.includes(hex) ? colors.filter((c) => c !== hex) : [...colors, hex] });
  };

  const changeMaskKind = (kind: TintMask["kind"]) => {
    if (kind === "all") setMask(active, { kind });
    else if (kind === "colors") setMask(active, { kind, colors: [], tolerance: 24 });
    else if (kind === "differs") {
      const suggested = recipe ? suggestedMask(recipe.base) : null;
      setMask(active, suggested?.kind === "differs" ? suggested : { kind, from: "minecraft:block/stone", tolerance: 16 });
    } else setMask(active, { kind, texture: "" });
  };

  const finish = useCallback(async () => {
    if (!recipe || !baked.pixels || saving) return;
    if (p.mode === "apply") {
      p.onApply?.(baked.pixels);
      p.onClose();
      return;
    }
    setSaving(true);
    try {
      await api().saveArt(p.root, p.file, toCanvas(baked.pixels).toDataURL("image/png"));
      // A tint of the file's own pixels can't be redone from the file it overwrites, so it keeps no recipe.
      await api().saveTint(p.root, p.file, recipe.base === CURRENT ? null : recipe);
      p.onSaved?.();
      p.onClose();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [recipe, baked.pixels, saving, p]);

  const close = useCallback(() => {
    if (dirty && !confirm("Close without keeping this tint?")) return;
    p.onClose();
  }, [dirty, p]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") finish();
      else if (e.key === "Escape") close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [finish, close]);

  const baseLabel = !recipe?.base ? "Nothing yet" : recipe.base === CURRENT ? (p.mode === "apply" ? "Your drawing" : `${p.file} as it is`) : recipe.base;
  const error = problem ?? baked.error ?? (recipe?.base && recipe.base !== CURRENT && textures.get(recipe.base) === null ? `Can't read ${recipe.base}` : null);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="texture-editor tint-dialog" role="dialog" aria-label={`Tint ${p.file}`}>
        <div className="te-head">
          <strong>Tint {p.file}</strong>
          <span className="muted">Start from a texture and recolor it through masks</span>
          <span className="spacer" />
          {error && <span className="bad">{error}</span>}
          <button onClick={close}>Close</button>
          <button className="primary" disabled={!baked.pixels || saving} onClick={finish}>
            {p.mode === "apply" ? "Apply to drawing" : saving ? "Saving" : "Save PNG (Ctrl+S)"}
          </button>
        </div>
        {recipe && (
          <div className="te-body">
            <div className="tint-controls">
              <span className="field-label">Start from</span>
              <div className="tint-base">
                {base ? <PixelView pixels={firstFrame(base)} size={32} /> : <span className="texture-thumb missing">?</span>}
                <span className="tint-base-name" title={baseLabel}>{baseLabel}</span>
              </div>
              <div className="tint-row">
                {current && <button type="button" className={recipe.base === CURRENT ? "active" : ""} onClick={() => pickBase(CURRENT)}>{p.mode === "apply" ? "My drawing" : "This PNG"}</button>}
                <button type="button" className={browsing ? "active" : ""} onClick={() => setBrowsing(!browsing)}>Minecraft texture…</button>
              </div>
              <label className="field">
                <span className="field-label">Or a PNG in art/</span>
                <input
                  placeholder="art/grey_ore.png"
                  value={recipe.base.startsWith("art/") ? recipe.base : ""}
                  onChange={(e) => edit({ ...recipe, base: e.target.value.trim() })}
                />
              </label>

              {recipe.layers.map((l, i) => (
                <div key={i} className={`tint-layer${i === active ? " active" : ""}`} onClick={() => setActive(i)}>
                  <div className="tint-row">
                    <strong>Layer {i + 1}</strong>
                    <span className="spacer" />
                    <input type="color" value={l.color} onChange={(e) => editLayer(i, { color: e.target.value })} title="Tint color" />
                    <button type="button" className="icon" title="Remove this layer" disabled={recipe.layers.length === 1} onClick={(e) => {
                      e.stopPropagation();
                      edit({ ...recipe, layers: recipe.layers.filter((_, j) => j !== i) });
                      setActive(Math.max(0, Math.min(active, recipe.layers.length - 2)));
                    }}>×</button>
                  </div>
                  <div className="tint-row">
                    {MODES.map((m) => (
                      <button type="button" key={m.mode} className={l.mode === m.mode ? "active" : ""} title={m.hint} onClick={() => editLayer(i, { mode: m.mode })}>{m.label}</button>
                    ))}
                  </div>
                  <label className="field">
                    <span className="field-label">Strength {Math.round(l.strength * 100)}%</span>
                    <input type="range" min={0} max={100} value={Math.round(l.strength * 100)} onChange={(e) => editLayer(i, { strength: Number(e.target.value) / 100 })} />
                  </label>
                  {i === active && (
                    <>
                      <label className="field">
                        <span className="field-label">Which pixels</span>
                        <select value={l.mask.kind} onChange={(e) => changeMaskKind(e.target.value as TintMask["kind"])}>
                          {MASKS.map((m) => <option key={m.kind} value={m.kind}>{m.label}</option>)}
                        </select>
                      </label>
                      {l.mask.kind === "colors" && (() => {
                        const m = l.mask;
                        return (
                          <>
                            <span className="field-hint">Click colors here or pixels in Before. {m.colors.length} picked.</span>
                            <div className="te-palette">
                              {palette.map((c) => {
                                const hex = toHex(c);
                                return <button type="button" key={hex} className={`te-swatch${m.colors.includes(hex) ? " picked" : ""}`} style={{ background: hex }} title={hex} onClick={() => toggleColor(hex)} />;
                              })}
                            </div>
                            <label className="field">
                              <span className="field-label">Also take colors within {m.tolerance}</span>
                              <input type="range" min={0} max={96} value={m.tolerance} onChange={(e) => setMask(i, { ...m, tolerance: Number(e.target.value) })} />
                            </label>
                          </>
                        );
                      })()}
                      {l.mask.kind === "differs" && (() => {
                        const m = l.mask;
                        return (
                          <>
                            <TextureRefInput value={m.from} onChange={(from) => setMask(i, { ...m, from })} />
                            <label className="field">
                              <span className="field-label">Ignore differences up to {m.tolerance}</span>
                              <input type="range" min={0} max={96} value={m.tolerance} onChange={(e) => setMask(i, { ...m, tolerance: Number(e.target.value) })} />
                            </label>
                          </>
                        );
                      })()}
                      {l.mask.kind === "image" && (() => {
                        const m = l.mask;
                        return (
                          <>
                            <TextureRefInput value={m.texture} onChange={(texture) => setMask(i, { ...m, texture })} />
                            <span className="field-hint">White pixels get the full tint, black and transparent ones none.</span>
                          </>
                        );
                      })()}
                      {l.mask.kind !== "all" && (
                        <label className="inline">
                          <input type="checkbox" checked={!!l.invert} onChange={(e) => editLayer(i, { invert: e.target.checked || undefined })} />
                          Tint the other pixels instead
                        </label>
                      )}
                    </>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => {
                edit({ ...recipe, layers: [...recipe.layers, newLayer()] });
                setActive(recipe.layers.length);
              }}>Add layer</button>
              {hadRecipe && <p className="field-hint">Saving bakes a new PNG from this recipe, replacing any pixel edits made since.</p>}
            </div>
            <div className="te-canvas-wrap tint-stage">
              {browsing ? (
                <VanillaBrowser value={recipe.base} onPick={pickBase} />
              ) : base ? (
                <div className="tint-previews">
                  <figure>
                    <PixelView
                      pixels={firstFrame(base)}
                      size={256}
                      weights={weights && weights.slice(0, firstFrame(base).width * firstFrame(base).height)}
                      title={layer?.mask.kind === "colors" ? "Click a pixel to add or remove its color" : undefined}
                      onPick={layer?.mask.kind === "colors" || layer?.mask.kind === "all" ? (x, y) => {
                        const i = (y * base.width + x) * 4;
                        if (base.data[i + 3]) toggleColor(toHex([base.data[i], base.data[i + 1], base.data[i + 2], 255]));
                      } : undefined}
                    />
                    <figcaption>
                      Before{" "}
                      <label className="inline"><input type="checkbox" checked={showMask} onChange={(e) => setShowMask(e.target.checked)} /> show layer {active + 1}'s pixels</label>
                    </figcaption>
                  </figure>
                  <figure>
                    {baked.pixels ? <PixelView pixels={firstFrame(baked.pixels)} size={256} /> : <span className="muted">…</span>}
                    <figcaption>After</figcaption>
                  </figure>
                  <figure>
                    {baked.pixels ? <PixelView pixels={firstFrame(baked.pixels)} size={192} tiles={3} /> : null}
                    <figcaption>Tiled, as blocks in the world</figcaption>
                  </figure>
                </div>
              ) : (
                <span className="muted">{recipe.base ? "Loading…" : "Pick a texture to start from."}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
