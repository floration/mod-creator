import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allParts, parseBlockbench, pickAnimations, sampleChannel } from "../src/blockbench.js";

const GLOWMOTH = fileURLToPath(new URL("../../../examples/ruby/art/glowmoth.bbmodel", import.meta.url));
const glowmoth = async () => JSON.parse(await readFile(GLOWMOTH, "utf8"));

describe("parseBlockbench", () => {
  it("turns groups into parts in Minecraft's model space", async () => {
    const model = parseBlockbench(await glowmoth());
    expect([model.textureWidth, model.textureHeight]).toEqual([32, 32]);
    const [body] = model.parts;
    // Blockbench origin y 2.5 (up from the feet) is 21.5 down from Minecraft's model origin.
    expect(body.pivot).toEqual([0, 21.5, 0]);
    expect(body.boxes[0]).toEqual({ u: 0, v: 0, box: [-2, -1.5, -4, 4, 3, 8], inflate: 0, mirror: false });
    const head = body.children.find((p) => p.name === "head")!;
    expect(head.pivot).toEqual([0, -0.5, -4]);
    // Blockbench's x and y point the other way, so a wing on +x is on -x in the game's model.
    const left = body.children.find((p) => p.name === "wing_left")!;
    expect(left.pivot[0]).toBe(-2);
    expect(left.rotation[2]).toBeCloseTo((-10 * Math.PI) / 180);
  });

  it("wraps a rotated cube in its own part", async () => {
    const model = parseBlockbench(await glowmoth());
    const names = allParts(model.parts).map((p) => p.name);
    expect(names).toEqual(["body", "head", "antenna_left_r", "antenna_right_r", "wing_left", "wing_right"]);
    const antenna = allParts(model.parts).find((p) => p.name === "antenna_left_r")!;
    expect(antenna.rotation[0]).toBeCloseTo(Math.PI / 6);
    expect(antenna.boxes[0].box).toEqual([-0.5, -3, -0.5, 1, 3, 1]);
  });

  it("reads animations and picks the walk and idle ones by name", async () => {
    const model = parseBlockbench(await glowmoth());
    const { walk, idle } = pickAnimations(model);
    expect(walk?.name).toBe("animation.glowmoth.walk");
    expect(idle?.loop).toBe(true);
    const flap = idle!.bones.wing_left.rotation!;
    expect(flap.map((k) => k.time)).toEqual([0, 0.5, 1]);
    // Blockbench z rotation keeps its sign; x and y flip.
    expect(flap[1].value).toEqual([0, 0, 20]);
    expect(sampleChannel(flap, 0.25)).toEqual([0, 0, 10]);
    expect(model.embeddedTexture).toMatch(/^data:image\/png;base64,/);
  });

  it("explains what to change for models Minecraft can't load", async () => {
    const perFace = await glowmoth();
    perFace.meta.box_uv = false;
    for (const e of perFace.elements) delete e.box_uv;
    expect(() => parseBlockbench(perFace)).toThrow(/per-face UV/);
    const molang = await glowmoth();
    molang.animations[0].animators[Object.keys(molang.animations[0].animators)[0]].keyframes[1].data_points[0].z = "math.sin(q.anim_time)";
    expect(() => parseBlockbench(molang)).toThrow(/Molang/);
    expect(() => parseBlockbench({ hello: 1 })).toThrow(/not a Blockbench model/);
  });

  it("puts cubes outside any group in a bb_main part", async () => {
    const file = await glowmoth();
    file.outliner = [file.elements[0].uuid];
    const model = parseBlockbench(file);
    expect(model.parts.map((p) => [p.name, p.pivot])).toEqual([["bb_main", [0, 24, 0]]]);
  });

  it("reads Blockbench 5 files that keep groups in their own list", async () => {
    const file = await glowmoth();
    const groups: any[] = [];
    const flatten = (node: any): any => {
      if (typeof node === "string") return node;
      const { children, ...group } = node;
      groups.push(group);
      return { uuid: node.uuid, isOpen: true, children: children.map(flatten) };
    };
    file.outliner = file.outliner.map(flatten);
    file.groups = groups;
    expect(parseBlockbench(file)).toEqual(parseBlockbench(await glowmoth()));
  });
});
