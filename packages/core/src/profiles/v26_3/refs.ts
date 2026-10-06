/** `ruby` -> `mymod:ruby`; `minecraft:stick` and `#minecraft:planks` are kept as they are. */
export function resolveRef(modId: string, ref: string): string {
  const tag = ref.startsWith("#");
  const bare = tag ? ref.slice(1) : ref;
  const full = bare.includes(":") ? bare : `${modId}:${bare}`;
  return tag ? `#${full}` : full;
}
