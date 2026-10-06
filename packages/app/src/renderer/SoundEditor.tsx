import { useContext } from "react";
import { api } from "./api";
import { CheckField, Section, TextField, getAt, setAt, type Draft, type Errors } from "./forms";
import { TextureContext } from "./TextureField";

interface EditorProps {
  draft: Draft;
  errors: Errors;
  onChange: (draft: Draft) => void;
}

interface SoundFile {
  file: string;
  volume?: number;
  pitch?: number;
  weight?: number;
}

/** Play one file the way the game would: its volume, and pitch as a change of speed. */
async function play(root: string, f: SoundFile) {
  const url = await api().dataUrl(root, f.file);
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, f.volume ?? 1));
  audio.preservesPitch = false;
  audio.playbackRate = f.pitch ?? 1;
  await audio.play().catch(() => undefined);
}

/** Pick a file by weight, as Minecraft does each time the sound plays. */
function pickByWeight(files: SoundFile[]): SoundFile | undefined {
  const total = files.reduce((n, f) => n + (f.weight ?? 1), 0);
  let r = Math.random() * total;
  return files.find((f) => (r -= f.weight ?? 1) < 0) ?? files[files.length - 1];
}

/** A sound event: its subtitle, its .ogg files and how each one plays. */
export function SoundEditor(p: EditorProps) {
  const f = { draft: p.draft, errors: p.errors, onChange: p.onChange };
  const world = useContext(TextureContext);
  const path = ["sound", "files"];
  const files: SoundFile[] = getAt(p.draft, path) ?? [];
  const setFiles = (next: SoundFile[]) => p.onChange(setAt(p.draft, path, next));
  const setFile = (i: number, next: SoundFile) => setFiles(files.map((x, n) => (n === i ? next : x)));
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const id: string = getAt(p.draft, ["id"]) ?? "";
  const importInto = async (i: number | null) => {
    if (!world) return;
    const rel = await api().importFile(world.root, "ogg").catch(() => null);
    if (!rel) return;
    if (i === null) setFiles([...files, { file: rel }]);
    else setFile(i, { ...files[i], file: rel });
  };
  const rowError = files.map((_, i) => p.errors.get(`sound.files.${i}.file`)).find(Boolean);
  return (
    <>
      <Section title="General">
        <TextField {...f} path={["name"]} label="Subtitle" hint="Shown when subtitles are on, like Bluetusk grunts" />
        <TextField {...f} path={["id"]} label="Id" hint={`Mobs name it by this id. In game: /playsound ${id ? `<modid>:${id}` : "<modid>:<id>"} master @s`} />
      </Section>
      <Section title="Files">
        <span className="field-hint">Ogg Vorbis files. Each time the sound plays, one is picked; a higher weight picks it more often. Mono files fade with distance.</span>
        {files.length > 0 && (
          <table className="rows sound-files">
            <thead>
              <tr>
                <th>File</th>
                <th>Volume</th>
                <th>Pitch</th>
                <th>Weight</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((x, i) => {
                const error = p.errors.get(`sound.files.${i}.file`);
                return (
                  <tr key={i}>
                    <td className={error ? "has-error" : ""} title={error}>
                      <span className="icon-input">
                        <button className="icon" title="Play" disabled={!world || !x.file.endsWith(".ogg")} onClick={() => world && play(world.root, x)}>▶</button>
                        <input value={x.file} placeholder="art/sound.ogg" onChange={(e) => setFile(i, { ...x, file: e.target.value.trim() })} />
                        <button className="link" title="Choose an .ogg to copy into art/" onClick={() => importInto(i)}>…</button>
                      </span>
                    </td>
                    <td><input type="number" step={0.1} min={0} max={1} value={x.volume ?? 1} onChange={(e) => setFile(i, { ...x, volume: num(e.target.value) })} /></td>
                    <td><input type="number" step={0.1} min={0.5} max={2} value={x.pitch ?? 1} onChange={(e) => setFile(i, { ...x, pitch: num(e.target.value) })} /></td>
                    <td><input type="number" min={1} max={100} value={x.weight ?? 1} onChange={(e) => setFile(i, { ...x, weight: num(e.target.value) })} /></td>
                    <td><button className="icon" title="Remove" onClick={() => setFiles(files.filter((_, n) => n !== i))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <span className="sound-actions">
          <button className="link" onClick={() => importInto(null)}>+ Import .ogg</button>
          <button className="link" onClick={() => setFiles([...files, { file: `art/${id || "sound"}.ogg` }])}>+ Add by path</button>
          {files.length > 1 && (
            <button className="link" disabled={!world} onClick={() => { const x = pickByWeight(files); if (x && world) play(world.root, x); }}>▶ Play a random one</button>
          )}
        </span>
        {(p.errors.get(path.join(".")) ?? rowError) && <span className="field-error">{p.errors.get(path.join(".")) ?? rowError}</span>}
        <CheckField {...f} path={["sound", "stream"]} label="Stream from disk" hint="For music and other long sounds" />
      </Section>
    </>
  );
}
