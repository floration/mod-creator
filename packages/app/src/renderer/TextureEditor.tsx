import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { TintDialog } from "./TintDialog";
import { TRANSPARENT, blank, colorsIn, copy, cssColor, floodFill, fromHex, getPixel, inBounds, linePoints, pixelsFromUrl, setPixel, toCanvas, toHex, type Pixels, type Rgba } from "./pixels";

type Tool = "pencil" | "eraser" | "fill" | "picker";

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "pencil", label: "Pencil", key: "b" },
  { tool: "eraser", label: "Eraser", key: "e" },
  { tool: "fill", label: "Fill", key: "g" },
  { tool: "picker", label: "Pick color", key: "i" },
];

/** A starter palette for blank textures: greys, then Minecraft-ish wool and ore colors. */
const BASICS = ["#000000", "#3f3f3f", "#7f7f7f", "#bfbfbf", "#ffffff", "#9c3a32", "#e0602d", "#f2c94c", "#5b8c32", "#3e9e8f", "#3a63b8", "#7b4bb3", "#c4589a", "#6b4a2b", "#a07850"];

const HISTORY = 100;

async function readPixels(root: string, file: string): Promise<Pixels | null> {
  const url = await api().dataUrl(root, file);
  return url ? pixelsFromUrl(url) : null;
}

export interface TextureEditorProps {
  root: string;
  /** Project-relative path of the PNG, like art/ruby.png. */
  file: string;
  /** Size for a texture that doesn't exist yet. */
  size: [number, number];
  /** Boxes to outline over the texture, like the parts of a mob model on its sheet. */
  guide?: [number, number, number, number][] | null;
  onSaved: () => void;
  onClose: () => void;
}

/** A pixel painter for one PNG in the project. Saving writes the file; the 3D preview picks it up from there. */
export function TextureEditor(p: TextureEditorProps) {
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<Rgba>([0, 0, 0, 255]);
  const [zoom, setZoom] = useState(16);
  const [grid, setGrid] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tinting, setTinting] = useState(false);
  const undo = useRef<Pixels[]>([]);
  const redo = useRef<Pixels[]>([]);
  const stroke = useRef<{ last: [number, number]; erase: boolean } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The latest pixels, ahead of React re-rendering, so a fast stroke always paints onto its own last segment.
  const live = useRef<Pixels | null>(null);
  live.current = pixels;
  const [w0, h0] = p.size;

  useEffect(() => {
    let live = true;
    readPixels(p.root, p.file).then(
      (loaded) => {
        if (!live) return;
        const next = loaded ?? blank(w0, h0);
        setIsNew(!loaded);
        setPixels(next);
        // Fit the image in about 512 pixels on screen.
        setZoom(Math.max(2, Math.min(32, Math.floor(512 / Math.max(next.width, next.height)))));
        const used = colorsIn(next, 1)[0];
        if (used) setColor(used);
      },
      (e: Error) => live && setProblem(e.message),
    );
    return () => {
      live = false;
    };
  }, [p.root, p.file, w0, h0]);

  const palette = useMemo(() => (pixels ? colorsIn(pixels) : []), [pixels]);
  const actual = useMemo(() => (pixels ? toCanvas(pixels).toDataURL() : null), [pixels]);

  const update = (next: Pixels) => {
    live.current = next;
    setPixels(next);
    setDirty(true);
  };

  // Redraw: checkerboard for transparency, the pixels, then grid, guide and the hovered pixel.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pixels) return;
    const { width: w, height: h } = pixels;
    c.width = w * zoom;
    c.height = h * zoom;
    const g = c.getContext("2d")!;
    const check = Math.max(4, zoom / 2);
    for (let y = 0; y < c.height; y += check) {
      for (let x = 0; x < c.width; x += check) {
        g.fillStyle = (x / check + y / check) % 2 ? "#3a3c42" : "#4a4c53";
        g.fillRect(x, y, check, check);
      }
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(toCanvas(pixels), 0, 0, c.width, c.height);
    if (grid && zoom >= 6) {
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < w; x++) {
        g.moveTo(x * zoom + 0.5, 0);
        g.lineTo(x * zoom + 0.5, c.height);
      }
      for (let y = 1; y < h; y++) {
        g.moveTo(0, y * zoom + 0.5);
        g.lineTo(c.width, y * zoom + 0.5);
      }
      g.stroke();
    }
    if (showGuide && p.guide) {
      g.strokeStyle = "rgba(255,210,90,0.85)";
      g.lineWidth = 1;
      for (const [x, y, rw, rh] of p.guide) g.strokeRect(x * zoom + 0.5, y * zoom + 0.5, rw * zoom - 1, rh * zoom - 1);
    }
    if (hover) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 2;
      g.strokeRect(hover[0] * zoom + 1, hover[1] * zoom + 1, zoom - 2, zoom - 2);
      if (mirror) g.strokeRect((w - 1 - hover[0]) * zoom + 1, hover[1] * zoom + 1, zoom - 2, zoom - 2);
    }
  }, [pixels, zoom, grid, showGuide, p.guide, hover, mirror]);

  const remember = useCallback((before: Pixels) => {
    undo.current = [...undo.current.slice(-HISTORY + 1), before];
    redo.current = [];
  }, []);

  const step = useCallback(
    (from: React.MutableRefObject<Pixels[]>, to: React.MutableRefObject<Pixels[]>) => {
      if (!pixels || !from.current.length) return;
      to.current = [...to.current, pixels];
      const prev = from.current[from.current.length - 1];
      from.current = from.current.slice(0, -1);
      setPixels(prev);
      setDirty(true);
    },
    [pixels],
  );

  const at = (e: React.PointerEvent): [number, number] => {
    const rect = canvas.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - rect.left) / rect.width) * pixels!.width), Math.floor(((e.clientY - rect.top) / rect.height) * pixels!.height)];
  };

  /** Paint one stroke segment onto a copy, mirrored across the middle column when mirror is on. */
  const paint = (base: Pixels, from: [number, number], to: [number, number], erase: boolean): Pixels => {
    const next = copy(base);
    const c = erase ? TRANSPARENT : color;
    for (const [x, y] of linePoints(...from, ...to)) {
      setPixel(next, x, y, c);
      if (mirror) setPixel(next, next.width - 1 - x, y, c);
    }
    return next;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!pixels) return;
    const [x, y] = at(e);
    if (!inBounds(pixels, x, y)) return;
    const active: Tool = e.altKey ? "picker" : e.button === 2 && tool === "pencil" ? "eraser" : tool;
    if (active === "picker") {
      const c = getPixel(pixels, x, y);
      if (c[3] > 0) setColor(c);
      if (tool === "picker") setTool("pencil");
      return;
    }
    if (active === "fill") {
      const next = copy(pixels);
      if (floodFill(next, x, y, e.button === 2 ? TRANSPARENT : color)) {
        remember(pixels);
        update(next);
      }
      return;
    }
    canvas.current!.setPointerCapture(e.pointerId);
    remember(pixels);
    const erase = active === "eraser";
    stroke.current = { last: [x, y], erase };
    update(paint(pixels, [x, y], [x, y], erase));
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pixels) return;
    const [x, y] = at(e);
    setHover(inBounds(pixels, x, y) ? [x, y] : null);
    const s = stroke.current;
    if (!s || !live.current || (s.last[0] === x && s.last[1] === y)) return;
    update(paint(live.current, s.last, [x, y], s.erase));
    s.last = [x, y];
  };

  const onUp = () => {
    stroke.current = null;
  };

  const save = useCallback(async () => {
    if (!pixels || saving) return;
    setSaving(true);
    try {
      await api().saveArt(p.root, p.file, toCanvas(pixels).toDataURL("image/png"));
      setDirty(false);
      setIsNew(false);
      setProblem(null);
      p.onSaved();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [pixels, saving, p]);

  const close = useCallback(() => {
    if (dirty && !confirm("Close without saving your drawing?")) return;
    p.onClose();
  }, [dirty, p]);

  // Shortcuts. Registered in the capture phase so Ctrl+S saves the texture, not the spec behind the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tinting || (e.target as HTMLElement).tagName === "INPUT") return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let handled = true;
      if (mod && key === "s") save();
      else if (mod && (key === "y" || (key === "z" && e.shiftKey))) step(redo, undo);
      else if (mod && key === "z") step(undo, redo);
      else if (key === "escape") close();
      else if (!mod && TOOLS.some((t) => t.key === key)) setTool(TOOLS.find((t) => t.key === key)!.tool);
      else if (!mod && key === "m") setMirror((m) => !m);
      else if (!mod && (key === "+" || key === "=")) setZoom((z) => Math.min(48, z + 2));
      else if (!mod && key === "-") setZoom((z) => Math.max(2, z - 2));
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, step, close, tinting]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="texture-editor" role="dialog" aria-label={`Edit ${p.file}`}>
        <div className="te-head">
          <strong>{p.file}</strong>
          {pixels && <span className="muted">{pixels.width}×{pixels.height}{isNew ? " · new file" : ""}</span>}
          <span className="spacer" />
          {problem && <span className="bad">{problem}</span>}
          <button onClick={close}>Close</button>
          <button className="primary" disabled={!pixels || saving || (!dirty && !isNew)} onClick={save}>{saving ? "Saving" : dirty || isNew ? "Save (Ctrl+S)" : "Saved"}</button>
        </div>
        <div className="te-body">
          <div className="te-tools">
            {TOOLS.map((t) => (
              <button key={t.tool} className={tool === t.tool ? "active" : ""} title={`${t.label} (${t.key.toUpperCase()})`} onClick={() => setTool(t.tool)}>
                {t.label}
              </button>
            ))}
            <hr />
            <button title="Recolor the drawing through color masks, or start over from a Minecraft texture" onClick={() => setTinting(true)}>Tint…</button>
            <hr />
            <button className={mirror ? "active" : ""} title="Paint both halves at once, for symmetric sprites (M)" onClick={() => setMirror(!mirror)}>Mirror</button>
            <button className={grid ? "active" : ""} onClick={() => setGrid(!grid)}>Grid</button>
            {p.guide && <button className={showGuide ? "active" : ""} title="Outline where each part of the model reads its pixels" onClick={() => setShowGuide(!showGuide)}>Model guide</button>}
            <hr />
            <button disabled={!undo.current.length} title="Undo (Ctrl+Z)" onClick={() => step(undo, redo)}>Undo</button>
            <button disabled={!redo.current.length} title="Redo (Ctrl+Y)" onClick={() => step(redo, undo)}>Redo</button>
            <hr />
            <label className="te-zoom">
              <span className="muted">Zoom</span>
              <input type="range" min={2} max={48} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
          </div>
          <div className="te-canvas-wrap">
            {pixels ? (
              <canvas
                ref={canvas}
                className={`te-canvas tool-${tool}`}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={() => setHover(null)}
                onContextMenu={(e) => e.preventDefault()}
              />
            ) : (
              !problem && <span className="muted">Loading…</span>
            )}
          </div>
          <div className="te-side">
            <div className="te-current">
              <span className="te-swatch big" style={{ background: cssColor(color) }} />
              <input type="color" value={toHex(color)} onChange={(e) => setColor(fromHex(e.target.value, color[3] || 255))} title="Choose any color" />
            </div>
            <label className="field">
              <span className="field-label">Opacity {Math.round((color[3] / 255) * 100)}%</span>
              <input type="range" min={1} max={255} value={color[3]} onChange={(e) => setColor([color[0], color[1], color[2], Number(e.target.value)])} />
            </label>
            {palette.length > 0 && (
              <>
                <span className="field-label">In this texture</span>
                <div className="te-palette">
                  {palette.map((c) => (
                    <button key={c.join()} className="te-swatch" style={{ background: cssColor(c) }} title={toHex(c)} onClick={() => setColor(c)} />
                  ))}
                </div>
              </>
            )}
            <span className="field-label">Basics</span>
            <div className="te-palette">
              {BASICS.map((hex) => (
                <button key={hex} className="te-swatch" style={{ background: hex }} title={hex} onClick={() => setColor(fromHex(hex))} />
              ))}
            </div>
            {pixels && actual && (
              <>
                <span className="field-label">Actual size</span>
                <img className="te-actual" src={actual} width={pixels.width * 2} height={pixels.height * 2} alt="" />
              </>
            )}
            <p className="field-hint">
              Right-click erases. Alt-click picks a color. {hover && pixels ? `Pixel ${hover[0]}, ${hover[1]}` : ""}
            </p>
          </div>
        </div>
      </div>
      {tinting && pixels && createPortal(
        <TintDialog
          root={p.root}
          file={p.file}
          mode="apply"
          current={pixels}
          onApply={(next) => {
            remember(pixels);
            update(next);
            if (next.width !== pixels.width || next.height !== pixels.height) setZoom(Math.max(2, Math.min(32, Math.floor(512 / Math.max(next.width, next.height)))));
          }}
          onClose={() => setTinting(false)}
        />,
        document.body,
      )}
    </div>
  );
}
