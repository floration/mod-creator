import type { ReactNode } from "react";

/** A spec as stored on disk. Forms edit it in place by path so fields the form doesn't know are kept. */
export type Draft = Record<string, any>;
export type Errors = Map<string, string>;

export function getAt(obj: Draft, path: string[]): any {
  return path.reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setAt(obj: Draft, path: string[], value: unknown): Draft {
  const [head, ...rest] = path;
  const copy: Draft = Array.isArray(obj) ? [...obj] : { ...obj };
  if (rest.length === 0) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
  } else {
    copy[head] = setAt(obj?.[head] ?? {}, rest, value);
  }
  return copy;
}

interface FieldProps {
  draft: Draft;
  path: string[];
  errors: Errors;
  onChange: (draft: Draft) => void;
  label: string;
  hint?: string;
}

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? " has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextField(p: FieldProps & { placeholder?: string; optional?: boolean }) {
  const value = getAt(p.draft, p.path) ?? "";
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <input
        value={value}
        placeholder={p.placeholder}
        onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value === "" && p.optional ? undefined : e.target.value))}
      />
    </Row>
  );
}

export function NumberField(p: FieldProps & { step?: number; min?: number; max?: number }) {
  const value = getAt(p.draft, p.path);
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <input
        type="number"
        step={p.step ?? 1}
        min={p.min}
        max={p.max}
        value={value ?? ""}
        onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value === "" ? undefined : Number(e.target.value)))}
      />
    </Row>
  );
}

export function SelectField(p: FieldProps & { options: readonly string[]; optional?: boolean }) {
  const value = getAt(p.draft, p.path) ?? "";
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <select value={value} onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value || undefined))}>
        {p.optional && <option value="">(none)</option>}
        {p.options.map((o) => (
          <option key={o} value={o}>
            {o.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function CheckField(p: FieldProps) {
  const value = !!getAt(p.draft, p.path);
  return (
    <label className="field field-check">
      <input type="checkbox" checked={value} onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.checked))} />
      <span className="field-label">{p.label}</span>
      {p.hint && <span className="field-hint">{p.hint}</span>}
    </label>
  );
}

/** Comma-separated list, stored as an array. */
export function ListField(p: FieldProps & { placeholder?: string }) {
  const value: string[] = getAt(p.draft, p.path) ?? [];
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <input
        defaultValue={value.join(", ")}
        key={value.join(",")}
        placeholder={p.placeholder}
        onBlur={(e) => {
          const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
          p.onChange(setAt(p.draft, p.path, list));
        }}
      />
    </Row>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function ColorField(p: FieldProps & { optional?: boolean; fallback?: string }) {
  const value: string | undefined = getAt(p.draft, p.path);
  return (
    <Row label={p.label} hint={p.hint} error={p.errors.get(p.path.join("."))}>
      <span className="color-field">
        <input type="color" value={value ?? p.fallback ?? "#000000"} onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value))} />
        <input value={value ?? ""} placeholder={p.optional ? "(vanilla default)" : undefined} onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.value === "" && p.optional ? undefined : e.target.value))} />
      </span>
    </Row>
  );
}

/** Adds or removes an optional object, like an item's food settings. Its fields show only while it is on. */
export function OptionalGroup(p: { draft: Draft; path: string[]; onChange: (draft: Draft) => void; label: string; template: Draft; children: ReactNode }) {
  const on = getAt(p.draft, p.path) !== undefined;
  return (
    <>
      <label className="field field-check">
        <input type="checkbox" checked={on} onChange={(e) => p.onChange(setAt(p.draft, p.path, e.target.checked ? p.template : undefined))} />
        <span className="field-label">{p.label}</span>
      </label>
      {on && p.children}
    </>
  );
}

export interface Column {
  key: string;
  label: string;
  type: "text" | "number";
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}

/** A list of small objects edited as table rows, like a biome's spawns or a mob's drops. */
export function RowsField(p: { draft: Draft; path: string[]; errors: Errors; onChange: (draft: Draft) => void; label: string; hint?: string; columns: Column[]; template: Draft; addLabel?: string }) {
  const rows: Draft[] = getAt(p.draft, p.path) ?? [];
  const setRows = (next: Draft[]) => p.onChange(setAt(p.draft, p.path, next));
  const listError = p.errors.get(p.path.join("."));
  return (
    <div className="field rows-field">
      <span className="field-label">{p.label}</span>
      {rows.length > 0 && (
        <table className="rows">
          <thead>
            <tr>
              {p.columns.map((c) => <th key={c.key}>{c.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {p.columns.map((c) => {
                  const error = p.errors.get([...p.path, String(i), c.key].join("."));
                  return (
                    <td key={c.key} className={error ? "has-error" : ""} title={error}>
                      <input
                        type={c.type}
                        step={c.step}
                        min={c.min}
                        max={c.max}
                        placeholder={c.placeholder}
                        value={row[c.key] ?? ""}
                        onChange={(e) => {
                          const v = c.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value;
                          setRows(rows.map((r, n) => (n === i ? setAt(r, [c.key], v) : r)));
                        }}
                      />
                    </td>
                  );
                })}
                <td>
                  <button className="icon" title="Remove" onClick={() => setRows(rows.filter((_, n) => n !== i))}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="link" onClick={() => setRows([...rows, p.template])}>{p.addLabel ?? "+ Add"}</button>
      {listError ? <span className="field-error">{listError}</span> : p.hint ? <span className="field-hint">{p.hint}</span> : null}
      {rows.some((_, i) => p.columns.some((c) => p.errors.has([...p.path, String(i), c.key].join(".")))) && (
        <span className="field-error">
          {rows.flatMap((_, i) => p.columns.map((c) => p.errors.get([...p.path, String(i), c.key].join(".")))).filter(Boolean)[0]}
        </span>
      )}
    </div>
  );
}
