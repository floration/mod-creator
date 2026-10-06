import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getAt, Row, setAt, type Draft, type Errors } from "./forms";
import { api } from "./api";
import { TextureEditor } from "./TextureEditor";

/** What texture fields need from the open project: where it is, and a way to tell the app a PNG changed. */
export interface TextureWorld {
  root: string;
  /** Bumps whenever art changes, so thumbnails and the 3D preview reload. */
  version: number;
  saved: () => void;
}

export const TextureContext = createContext<TextureWorld | null>(null);

/** A path to a PNG in art/, with a thumbnail and a button that opens it in the pixel editor (or starts a blank one). */
export function TextureField(p: {
  draft: Draft;
  path: string[];
  errors: Errors;
  onChange: (draft: Draft) => void;
  label: string;
  hint?: string;
  optional?: boolean;
  /** Size of a new blank texture. */
  size?: [number, number];
  guide?: [number, number, number, number][] | null;
}) {
  const world = useContext(TextureContext);
  const value: string = getAt(p.draft, p.path) ?? "";
  const [thumb, setThumb] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const usable = /\.png$/i.test(value) && !value.endsWith("/.png");

  useEffect(() => {
    setThumb(null);
    if (!world || !usable) return;
    let live = true;
    api().dataUrl(world.root, value).then((url) => live && setThumb(url), () => live && setThumb(null));
    return () => {
      live = false;
    };
  }, [world?.root, world?.version, value, usable]);

  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <span className="texture-field">
        <span className={`texture-thumb${thumb ? "" : " missing"}`} onClick={(e) => { e.preventDefault(); if (world && usable) setEditing(true); }}>
          {thumb ? <img src={thumb} alt="" /> : "?"}
        </span>
        <input
          value={value}
          placeholder="art/name.png"
          onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value === "" && p.optional ? undefined : e.target.value))}
        />
        <button
          type="button"
          disabled={!world || !usable}
          title={usable ? "Open in the pixel editor" : "Type a .png path in art/ first"}
          onClick={(e) => { e.preventDefault(); setEditing(true); }}
        >
          {thumb ? "Edit" : "Draw"}
        </button>
      </span>
      {editing && world && createPortal(
        <TextureEditor
          root={world.root}
          file={value}
          size={p.size ?? [16, 16]}
          guide={p.guide}
          onSaved={world.saved}
          onClose={() => setEditing(false)}
        />,
        // Outside the field's <label>, so clicks in the editor don't focus the path box.
        document.body,
      )}
    </Row>
  );
}
