import { useContext, useMemo, useState } from "react";
import {
  VANILLA_GOAL_IDS,
  VANILLA_MOBS,
  defaultArg,
  goalProblem,
  pickConstructor,
  presetGoals,
  simpleName,
  specParams,
  usableConstructors,
  vanillaGoal,
  type GoalArgValue,
  type GoalParam,
  type MobGoalEntry,
} from "@modcreator/core/vanilla-mobs";
import { getAt, setAt, type Draft, type Errors } from "./forms";
import { ItemContext } from "./items";

const words = (id: string) => id.replaceAll("_", " ");
const label = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** The body picker: a filter box over every vanilla model the jar has, plus Blockbench. */
export function ModelPicker(p: { value: string; error?: string; onChange: (model: string) => void }) {
  const [filter, setFilter] = useState("");
  const ids = useMemo(() => {
    const all = ["blockbench", ...Object.keys(VANILLA_MOBS.models).sort()];
    const q = filter.trim().toLowerCase().replaceAll(" ", "_");
    // Also match the entities a body is used by, so "trader" finds the llama body.
    return all.filter((id) => !q || id.includes(q) || VANILLA_MOBS.models[id]?.entities.some((e) => e.includes(q)) || id === p.value);
  }, [filter, p.value]);
  const v = VANILLA_MOBS.models[p.value];
  return (
    <div className="field">
      <span className="field-label">Body</span>
      <input type="search" placeholder={`Filter ${Object.keys(VANILLA_MOBS.models).length} vanilla bodies`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <select size={7} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id === "blockbench" ? "Your own (Blockbench model)" : words(id)}
          </option>
        ))}
      </select>
      {p.error && <span className="field-error">{p.error}</span>}
      <span className="field-hint">
        {v
          ? `Borrows the ${words(p.value)} model and its animations. ${v.textureSize[0]}x${v.textureSize[1]} texture${v.babyLayer ? ", with a baby body" : ""}.` +
            (v.entities.length ? ` Used by ${v.entities.map((e) => words(e.replace("minecraft:", ""))).join(", ")}.` : "")
          : "Your own model, made in Blockbench"}
      </span>
    </div>
  );
}

/** One goal argument's input, by the kind of value its parameter takes. */
function ArgInput(p: { param: GoalParam; value: GoalArgValue | undefined; error?: string; onChange: (v: GoalArgValue | undefined) => void }) {
  const { param, value } = p;
  const title = `${label(param.name)} (${param.type})`;
  if (param.type === "boolean") {
    return (
      <label className="goal-arg" title={p.error ?? title}>
        <input type="checkbox" checked={value === true} onChange={(e) => p.onChange(e.target.checked)} /> {label(param.name)}
      </label>
    );
  }
  const numeric = param.type === "double" || param.type === "float" || param.type === "int";
  const list = param.type === "entityClass" || param.type === "entityClasses" ? "goal-entities" : undefined;
  const placeholder: Record<string, string> = {
    itemTest: "its food",
    entityClasses: "none",
    block: "minecraft:grass_block",
    itemStack: "minecraft:milk_bucket",
    sound: "minecraft:entity.generic.drink",
    fluidTag: "#minecraft:water",
    damageTag: "#minecraft:panic_causes",
  };
  return (
    <label className={`goal-arg${p.error ? " has-error" : ""}`} title={p.error ?? title}>
      <span>{label(param.name)}</span>
      <input
        type={numeric ? "number" : "text"}
        step={param.type === "int" ? 1 : 0.05}
        list={list}
        placeholder={placeholder[param.type]}
        value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return p.onChange(param.type === "entityClasses" ? [] : undefined);
          if (numeric) return p.onChange(Number(raw));
          if (param.type === "entityClasses") return p.onChange(raw.split(",").map((s) => s.trim()).filter(Boolean));
          p.onChange(raw);
        }}
      />
    </label>
  );
}

const goalName = (id: string) => `${words(id)}${vanillaGoal(id)?.target ? " (target)" : ""}`;

/**
 * The mob's AI goals. Until someone customizes, the behavior preset's goals are shown read-only; customizing copies
 * them into the spec, where any vanilla goal can be added, removed or tuned.
 */
export function GoalsEditor(p: { draft: Draft; errors: Errors; onChange: (draft: Draft) => void }) {
  const world = useContext(ItemContext);
  const behavior: string = getAt(p.draft, ["mob", "behavior"]) ?? "animal";
  const flies: boolean = getAt(p.draft, ["mob", "flies"]) ?? false;
  const own: MobGoalEntry[] | undefined = getAt(p.draft, ["mob", "goals"]);
  const goals = own ?? presetGoals(behavior, flies);
  const [adding, setAdding] = useState("");
  const set = (next: MobGoalEntry[] | undefined) => p.onChange(setAt(p.draft, ["mob", "goals"], next));
  const update = (i: number, entry: MobGoalEntry) => set(goals.map((g, n) => (n === i ? entry : g)));
  const entities = useMemo(
    () => [
      ...Object.keys(VANILLA_MOBS.entities),
      ...(world?.elements ?? []).filter((e) => e.kind === "mob").map((e) => e.id),
    ],
    [world?.elements],
  );
  const options = useMemo(
    () => VANILLA_GOAL_IDS.map((id) => ({ id, problem: goalProblem(vanillaGoal(id)!, behavior) })).sort((a, b) => Number(!!a.problem) - Number(!!b.problem)),
    [behavior],
  );

  const add = () => {
    const goal = vanillaGoal(adding);
    if (!goal) return;
    // The simplest constructor that works, with starting values.
    const ctor = [...usableConstructors(goal, behavior)].sort((a, b) => specParams(a).length - specParams(b).length)[0];
    const args: Record<string, GoalArgValue> = {};
    for (const param of ctor ? specParams(ctor) : []) {
      const d = defaultArg(param);
      if (d !== undefined && param.type !== "itemTest" && param.type !== "entityClasses") args[param.name] = d;
    }
    set([...goals, { goal: adding, priority: goal.target ? 2 : 5, ...(Object.keys(args).length ? { args } : {}) }]);
    setAdding("");
  };

  return (
    <div className="field goals-field">
      <span className="field-label">AI goals</span>
      <span className="field-hint">
        {own
          ? "Lower numbers win when two goals want to run. Target goals choose what to attack; the rest choose what to do."
          : `The ${behavior} goals. Customize to add any of Minecraft's ${VANILLA_GOAL_IDS.length} goals, or change these.`}
      </span>
      <datalist id="goal-entities">
        {entities.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <table className="rows goals">
        <tbody>
          {goals.map((g, i) => {
            const goal = vanillaGoal(g.goal);
            const at = `mob.goals.${i}`;
            const ctor = goal ? pickConstructor(goal, behavior, g.args ?? {}) : null;
            // Show the picked constructor's parameters, or every parameter the goal has if none fits yet.
            const params = ctor ? specParams(ctor) : goal ? [...new Map(usableConstructors(goal, behavior).flatMap(specParams).map((q) => [q.name, q])).values()] : [];
            const rowError = [...p.errors.entries()].find(([k]) => k === at || k.startsWith(`${at}.goal`) || k === `${at}.args`)?.[1];
            return (
              <tr key={i} className={rowError ? "has-error" : ""} title={rowError}>
                <td>
                  <input type="number" className="priority" min={0} max={100} value={g.priority} disabled={!own} title="Priority" onChange={(e) => update(i, { ...g, priority: Number(e.target.value) })} />
                </td>
                <td>
                  <span className="goal-name" title={goal ? simpleName(goal.class) : undefined}>{goalName(g.goal)}</span>
                  {rowError && <span className="field-error">{rowError}</span>}
                </td>
                <td className="goal-args">
                  {params.map((param) => (
                    <ArgInput
                      key={param.name}
                      param={param}
                      value={g.args?.[param.name]}
                      error={p.errors.get(`${at}.args.${param.name}`)}
                      onChange={(v) => {
                        if (!own) return;
                        const args = { ...(g.args ?? {}) };
                        if (v === undefined) delete args[param.name];
                        else args[param.name] = v;
                        update(i, { ...g, args });
                      }}
                    />
                  ))}
                  {goal?.setters?.map((s) => (
                    <label key={s.name} className="goal-arg" title={s.params.length ? `Also takes ${s.params.map((q) => label(q.name)).join(", ")}` : undefined}>
                      <input
                        type="checkbox"
                        disabled={!own}
                        checked={!!g.calls?.[s.name!]}
                        onChange={(e) => {
                          const calls = { ...(g.calls ?? {}) };
                          if (e.target.checked) calls[s.name!] = Object.fromEntries(s.params.map((q) => [q.name, defaultArg(q)!]).filter(([, v]) => v !== undefined));
                          else delete calls[s.name!];
                          update(i, { ...g, calls: Object.keys(calls).length ? calls : undefined });
                        }}
                      />{" "}
                      {label(s.name!.replace(/^set/, ""))}
                    </label>
                  ))}
                </td>
                <td>{own && <button className="icon" title="Remove" onClick={() => set(goals.filter((_, n) => n !== i))}>×</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {own ? (
        <div className="goal-add">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">Add a goal...</option>
            {options.map(({ id, problem }) => (
              <option key={id} value={id} disabled={!!problem} title={problem ?? undefined}>
                {goalName(id)}
                {problem ? ` (${problem.toLowerCase()})` : ""}
              </option>
            ))}
          </select>
          <button type="button" disabled={!adding} onClick={add}>Add</button>
          <button type="button" className="link" onClick={() => set(undefined)}>Go back to the {behavior} goals</button>
        </div>
      ) : (
        <button type="button" className="link" onClick={() => set(presetGoals(behavior, flies))}>Customize goals</button>
      )}
    </div>
  );
}
