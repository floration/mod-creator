import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { api, type ElementSpec } from "./api";

/** Minecraft's fixed face shading: the top is brightest, the bottom darkest. */
const SHADE = { top: 1.0, bottom: 0.5, northSouth: 0.8, eastWest: 0.6 };

/** Which art file each face of a full cube uses, in three.js BoxGeometry order: +x, -x, +y, -y, +z, -z. */
function cubeFaces(spec: ElementSpec): string[] | null {
  if (spec.kind !== "block") return null;
  const m = spec.block.model;
  if (m.type === "cube_all") return Array(6).fill(m.texture);
  if (m.type === "cube_column") return [m.side, m.side, m.end, m.end, m.side, m.side];
  return null;
}

function pixelTexture(url: string): Promise<THREE.Texture> {
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

async function buildObject(root: string, spec: ElementSpec): Promise<THREE.Object3D | null> {
  const faces = cubeFaces(spec);
  if (faces) {
    const urls = await Promise.all(faces.map((f) => api().dataUrl(root, f)));
    const shades = [SHADE.eastWest, SHADE.eastWest, SHADE.top, SHADE.bottom, SHADE.northSouth, SHADE.northSouth];
    const materials = await Promise.all(
      urls.map(async (url, i) => {
        const color = new THREE.Color(shades[i], shades[i], shades[i]);
        if (!url) return new THREE.MeshBasicMaterial({ color: 0xff00ff });
        return new THREE.MeshBasicMaterial({ map: await pixelTexture(url), color, transparent: true, alphaTest: 0.1 });
      }),
    );
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
    mesh.position.y = 0.5;
    return mesh;
  }
  if (spec.kind === "item") {
    const url = await api().dataUrl(root, spec.item.texture);
    if (!url) return null;
    const material = new THREE.MeshBasicMaterial({ map: await pixelTexture(url), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plane.position.y = 0.6;
    return plane;
  }
  return null;
}

/** 3D view of a block or item spec. Reloads whenever the spec changes. */
export function Preview({ root, spec, version }: { root: string; spec: ElementSpec; version: number }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ scene: THREE.Scene; object: THREE.Object3D | null } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const s = new THREE.Scene();
    s.background = new THREE.Color(0x2b2d31);
    s.add(new THREE.GridHelper(4, 4, 0x6d6f78, 0x45474f));
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(1.8, 1.6, 2.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    scene.current = { scene: s, object: null };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(s, camera);
    });
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    buildObject(root, spec).then((object) => {
      const s = scene.current;
      if (cancelled || !s) return;
      if (s.object) s.scene.remove(s.object);
      s.object = object;
      if (object) s.scene.add(object);
    });
    return () => {
      cancelled = true;
    };
  }, [root, spec, version]);

  const supported = cubeFaces(spec) !== null || spec.kind === "item";
  return (
    <div className="preview">
      <div className="preview-canvas" ref={host} />
      {failed && <div className="preview-note">3D preview needs WebGL, which this computer's graphics driver did not provide.</div>}
      {!failed && !supported && <div className="preview-note">No 3D preview for this element yet.</div>}
    </div>
  );
}
