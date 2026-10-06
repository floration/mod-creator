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
