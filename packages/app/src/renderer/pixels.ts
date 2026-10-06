/** An RGBA image the texture editor paints on, one byte per channel, rows top to bottom. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type Rgba = [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

export function blank(width: number, height: number): Pixels {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function copy(p: Pixels): Pixels {
  return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data) };
}

export function inBounds(p: Pixels, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < p.width && y < p.height;
}

export function getPixel(p: Pixels, x: number, y: number): Rgba {
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]];
}

/** Fully transparent pixels all count as the same color, whatever their RGB. */
function same(a: Rgba, b: Rgba): boolean {
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function setPixel(p: Pixels, x: number, y: number, c: Rgba): void {
  if (!inBounds(p, x, y)) return;
  p.data.set(c[3] === 0 ? TRANSPARENT : c, (y * p.width + x) * 4);
}

/** Every pixel on the straight line between two pixels, so fast strokes leave no gaps. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Paint bucket: recolor the area of same-colored pixels touching (x, y) edge to edge. Returns whether anything changed. */
export function floodFill(p: Pixels, x: number, y: number, c: Rgba): boolean {
  if (!inBounds(p, x, y)) return false;
  const target = getPixel(p, x, y);
  if (same(target, c)) return false;
  const stack: [number, number][] = [[x, y]];
  const seen = new Uint8Array(p.width * p.height);
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (!inBounds(p, cx, cy) || seen[cy * p.width + cx]) continue;
    seen[cy * p.width + cx] = 1;
    if (!same(getPixel(p, cx, cy), target)) continue;
    setPixel(p, cx, cy, c);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return true;
}

/** The colors a texture already uses, most common first, so matching shades are one click away. */
export function colorsIn(p: Pixels, limit = 32): Rgba[] {
  const counts = new Map<number, number>();
  const view = new DataView(p.data.buffer, p.data.byteOffset, p.data.byteLength);
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] === 0) continue;
    const key = view.getUint32(i);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => [(key >>> 24) & 255, (key >>> 16) & 255, (key >>> 8) & 255, key & 255]);
}

export function toHex([r, g, b]: Rgba): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string, alpha = 255): Rgba {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export function cssColor([r, g, b, a]: Rgba): string {
  return `rgba(${r},${g},${b},${a / 255})`;
}
