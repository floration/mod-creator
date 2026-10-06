// Vanilla mob models and AI goals, as read from the Minecraft jar by scripts/extract-vanilla.mjs. Nothing here
// lists mobs or goals by hand: a new game version regenerates the JSON and everything below follows it.
import data from "./profiles/v26_3/vanilla/mobs.json" with { type: "json" };

export interface VanillaModel {
  /** ModelLayers field the body is baked from, like `PIG`. */
  layer: string;
  /** Model class; `flags` false booleans follow the part in its constructor (the player's slim arms). */
  model: string;
  flags?: number;
  generic?: boolean;
  /** Render state class the renderer creates for it. */
  state: string;
  /** Entity ids whose renderer uses this body. */
  entities: string[];
  sounds?: { ambient?: string; hurt?: string; death?: string };
  /** Hitbox of the first entity, in blocks. */
  size?: [number, number];
  shadow?: number;
  babyLayer?: string;
  babyModel?: string;
  babyGeneric?: boolean;
  /** The class both adult and baby models share, for AdultAndBabyModelPair. */
  modelType?: string;
  modelTypeGeneric?: boolean;
  /** A vanilla texture in the jar that fits the body, like `textures/entity/zombie/zombie.png`. */
  texture?: string;
  textureSize: [number, number];
  babyTextureSize?: [number, number];
}

/**
 * What a goal constructor parameter takes. `mob`, `level` and `selector` are filled in by the generator; the rest
 * come from the spec.
 */
export type GoalParamType =
  | "mob"
  | "level"
  | "selector"
  | "double"
  | "float"
  | "int"
  | "boolean"
  | "entityClass"
  | "entityClasses"
  | "itemTest"
  | "block"
  | "itemStack"
  | "sound"
  | "fluidTag"
  | "damageTag"
  | `other:${string}`;

export interface GoalParam {
  name: string;
  type: GoalParamType;
  /** For an entity class: the class it must be or extend, like Animal for a breeding partner. */
  bound?: string;
}

export interface GoalSignature {
  /** For a setter: its method name. */
  name?: string;
  params: GoalParam[];
  /** Classes and interfaces the mob must be, for a constructor. */
  mobBounds?: string[];
}

export interface VanillaGoal {
  class: string;
  generic?: boolean;
  /** Target goals pick what to attack and go in the targetSelector. */
  target: boolean;
  constructors: GoalSignature[];
  /** Builder-style methods like HurtByTargetGoal.setAlertOthers. */
  setters?: GoalSignature[];
}

export interface VanillaMobData {
  version: string;
  models: Record<string, VanillaModel>;
  /** By class simple name, like `PanicGoal`. */
  goals: Record<string, VanillaGoal>;
  /**
   * Living entity type id -> its class, then that class's superclasses down to Entity, for goals that
   * target, avoid or ignore a kind of mob.
   */
  entities: Record<string, string[]>;
  /** Every superclass and interface of each base class a generated mob can extend. */
  bases: Record<"animal" | "tameable" | "hostile", string[]>;
}

export const VANILLA_MOBS = data as unknown as VanillaMobData;

/** Mob bodies a spec can borrow, by id: `pig`, `zombie`, `cold_chicken`... */
export const VANILLA_MODEL_IDS = Object.keys(VANILLA_MOBS.models).sort();

/** `PanicGoal` -> `panic`, `NearestAttackableTargetGoal` -> `nearest_attackable_target`. */
export const goalId = (className: string) =>
  className
    .replace(/Goal$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();

const GOALS_BY_ID = new Map(Object.entries(VANILLA_MOBS.goals).map(([cls, g]) => [goalId(cls), g]));

/** Every vanilla goal id, sorted. */
export const VANILLA_GOAL_IDS = [...GOALS_BY_ID.keys()].sort();

export function vanillaGoal(id: string): VanillaGoal | undefined {
  return GOALS_BY_ID.get(id);
}

/** Java class each mob behavior extends, as a key of `bases`. */
export function baseOf(behavior: string): "animal" | "tameable" | "hostile" {
  return behavior === "tameable" ? "tameable" : behavior === "hostile" ? "hostile" : "animal";
}

/** Parameters the generator fills in itself, so a spec never sets them. */
export const AUTO_PARAMS: ReadonlySet<string> = new Set(["mob", "level", "selector"]);

/** Parameters a spec may leave out: item tests default to the mob's food, ignore lists to nobody. */
export const OPTIONAL_PARAMS: ReadonlySet<string> = new Set(["itemTest", "entityClasses"]);

const supported = (p: GoalParam) => !p.type.startsWith("other:");

/**
 * Why a goal can't drive a mob with this behavior, or null if it can. Goals made for one vanilla mob (a wolf's
 * begging, a creeper's swelling) need that mob's class.
 */
export function goalProblem(goal: VanillaGoal, behavior: string): string | null {
  const have = new Set(VANILLA_MOBS.bases[baseOf(behavior)]);
  const usable = goal.constructors.filter((c) => c.params.every(supported));
  if (!usable.length) return "Its constructors take Java values Mod Creator can't write in a spec";
  const fits = usable.filter((c) => (c.mobBounds ?? []).every((b) => have.has(b)));
  if (fits.length) return null;
  const need = [...new Set(usable.flatMap((c) => c.mobBounds ?? []).filter((b) => !have.has(b)))].map(simpleName);
  return `Needs a mob that is a ${need.join(" and ")}`;
}

export const simpleName = (cls: string) => cls.slice(cls.lastIndexOf(".") + 1).replace(/\$/g, ".");

/** A goal's constructors this behavior's base class can use, whose every parameter a spec can express. */
export function usableConstructors(goal: VanillaGoal, behavior: string): GoalSignature[] {
  const have = new Set(VANILLA_MOBS.bases[baseOf(behavior)]);
  return goal.constructors.filter((c) => c.params.every(supported) && (c.mobBounds ?? []).every((b) => have.has(b)));
}

/** Parameters a spec sets for this signature: everything but the mob, the level and selectors. */
export const specParams = (sig: GoalSignature) => sig.params.filter((p) => !AUTO_PARAMS.has(p.type));

/**
 * The constructor a spec's arguments call: one whose parameters cover every argument given, with every
 * non-optional parameter given. Of those, the one using the most arguments.
 */
export function pickConstructor(goal: VanillaGoal, behavior: string, args: Record<string, unknown>): GoalSignature | null {
  const given = Object.keys(args);
  const fits = usableConstructors(goal, behavior).filter((c) => {
    const params = specParams(c);
    const names = new Set(params.map((p) => p.name));
    return given.every((g) => names.has(g)) && params.every((p) => p.name in args || OPTIONAL_PARAMS.has(p.type));
  });
  fits.sort((a, b) => specParams(b).filter((p) => p.name in args).length - specParams(a).filter((p) => p.name in args).length || specParams(a).length - specParams(b).length);
  return fits[0] ?? null;
}

export type GoalArgValue = number | boolean | string | string[];

export interface MobGoalEntry {
  goal: string;
  priority: number;
  args?: Record<string, GoalArgValue>;
  calls?: Record<string, Record<string, GoalArgValue>>;
}

/**
 * The goals a behavior preset gives a mob, in the same form a spec lists its own. The editor copies these into
 * the spec when someone starts customizing.
 */
export function presetGoals(behavior: string, flies: boolean): MobGoalEntry[] {
  const goals: MobGoalEntry[] = [{ goal: "float", priority: 0 }];
  switch (behavior) {
    case "animal":
      goals.push({ goal: "panic", priority: 1, args: { speedModifier: 1.25 } });
      break;
    case "neutral":
      goals.push(
        { goal: "melee_attack", priority: 1, args: { speedModifier: 1.2, followingTargetEvenIfNotSeen: true } },
        { goal: "hurt_by_target", priority: 1, calls: { setAlertOthers: {} } },
      );
      break;
    case "tameable":
      goals.push(
        { goal: "sit_when_ordered_to", priority: 2 },
        { goal: "melee_attack", priority: 3, args: { speedModifier: 1.0, followingTargetEvenIfNotSeen: true } },
        { goal: "follow_owner", priority: 4, args: { speedModifier: 1.0, startDistance: 10, stopDistance: 2 } },
        { goal: "owner_hurt_by_target", priority: 1 },
        { goal: "owner_hurt_target", priority: 2 },
        { goal: "hurt_by_target", priority: 3 },
      );
      break;
    case "hostile":
      goals.push(
        { goal: "melee_attack", priority: 2, args: { speedModifier: 1.0, followingTargetEvenIfNotSeen: false } },
        { goal: "hurt_by_target", priority: 1 },
        { goal: "nearest_attackable_target", priority: 2, args: { targetType: "minecraft:player", mustSee: true } },
      );
      break;
  }
  if (behavior !== "hostile") {
    goals.push(
      { goal: "breed", priority: 5, args: { speedModifier: 1.0 } },
      { goal: "tempt", priority: 6, args: { speedModifier: 1.2, canScare: false } },
      { goal: "follow_parent", priority: 6, args: { speedModifier: 1.1 } },
    );
  }
  goals.push(
    { goal: flies ? "water_avoiding_random_flying" : "water_avoiding_random_stroll", priority: 7, args: { speedModifier: 1.0 } },
    { goal: "look_at_player", priority: 8, args: { lookAtType: "minecraft:player", lookDistance: 6 } },
    { goal: "random_look_around", priority: 8 },
  );
  return goals;
}

/** A reasonable starting value for a parameter, for the editor's "add goal". */
export function defaultArg(p: GoalParam): GoalArgValue | undefined {
  const n = p.name.toLowerCase();
  switch (p.type) {
    case "boolean":
      return false;
    case "double":
    case "float":
      if (n.includes("speed")) return 1;
      if (n.includes("probability") || n.includes("chance")) return 0.02;
      if (n.includes("yd")) return 0.4;
      return 8;
    case "int":
      if (n.includes("interval")) return 120;
      if (n.includes("time") || n.includes("ticks")) return 100;
      return 10;
    case "entityClass":
      return "minecraft:player";
    case "entityClasses":
      return [];
    case "block":
      return "minecraft:grass_block";
    case "itemStack":
      return "minecraft:milk_bucket";
    case "sound":
      return "minecraft:entity.generic.drink";
    case "fluidTag":
      return "#minecraft:water";
    case "damageTag":
      return "#minecraft:panic_causes";
    default:
      return undefined;
  }
}
