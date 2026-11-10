import * as THREE from 'three';
import { WORLD_SCALE as S, MAP_PX } from './mapData.js';

export const WORLD_SIZE = MAP_PX * S;
export const toWorld = (px, py) => [(px - MAP_PX / 2) * S, (py - MAP_PX / 2) * S];
export const toPx = (wx, wz) => [wx / S + MAP_PX / 2, wz / S + MAP_PX / 2];

const smooth = (e0, e1, x) => {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return [Math.sqrt(cx * cx + cy * cy), t];
}

// 다각형 내부면 +, 외부면 - 인 거리
function polySd(pts, x, y) {
  let dmin = Infinity, inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const [d] = segDist(x, y, xi, yi, xj, yj);
    if (d < dmin) dmin = d;
  }
  return inside ? dmin : -dmin;
}

function bboxOf(pts, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// 지형 높이 계산기를 만든다 (features 전처리)
export function makeHeightField(map) {
  const fs = map.features.map((f) => {
    const e = f.edge ?? 2;
    if (f.type === 'circle') return { ...f, e, bb: [f.x - f.r - e, f.y - f.r - e, f.x + f.r + e, f.y + f.r + e] };
    if (f.type === 'strip') {
      const lens = [0];
      for (let i = 1; i < f.pts.length; i++) {
        const [ax, ay] = f.pts[i - 1], [bx, by] = f.pts[i];
        lens.push(lens[i - 1] + Math.hypot(bx - ax, by - ay));
      }
      return { ...f, e, lens, total: lens[lens.length - 1] || 1, bb: bboxOf(f.pts, f.w / 2 + e) };
    }
    if (f.type === 'boundary') return { ...f, e };
    return { ...f, e, bb: bboxOf(f.pts, e) };
  });

  function heightPx(x, y) {
    let h = 0.55 * Math.sin(x * 0.045) * Math.cos(y * 0.038) + 0.3 * Math.sin(x * 0.11 + y * 0.07);
    for (const f of fs) {
      if (f.bb && (x < f.bb[0] || y < f.bb[1] || x > f.bb[2] || y > f.bb[3])) continue;
      let w = 0, target = f.h;
      switch (f.type) {
        case 'circle': {
          const d = Math.hypot(x - f.x, y - f.y);
          w = smooth(f.r + f.e / 2, f.r - f.e / 2, d);
          break;
        }
        case 'poly':
        case 'water':
          w = smooth(-f.e / 2, f.e / 2, polySd(f.pts, x, y));
          break;
        case 'boundary':
          w = smooth(0, -f.e, polySd(f.pts, x, y));
          break;
        case 'strip': {
          let best = Infinity, along = 0;
          for (let i = 1; i < f.pts.length; i++) {
            const [ax, ay] = f.pts[i - 1], [bx, by] = f.pts[i];
            const [d, t] = segDist(x, y, ax, ay, bx, by);
            if (d < best) { best = d; along = f.lens[i - 1] + t * (f.lens[i] - f.lens[i - 1]); }
          }
          w = smooth(f.w / 2 + f.e / 2, f.w / 2 - f.e / 2, best);
          if (f.h2 !== undefined) target = f.h + (f.h2 - f.h) * (along / f.total);
          break;
        }
      }
      if (w > 0) h += (target - h) * w;
    }
    return h;
  }

  return {
    heightPx,
    heightAt: (wx, wz) => { const [x, y] = toPx(wx, wz); return heightPx(x, y); },
  };
}

const C_GRASS = new THREE.Color('#7f9a52');
const C_GRASS_HI = new THREE.Color('#a9b56e');
const C_SAND = new THREE.Color('#c9b98a');
const C_ROCK = new THREE.Color('#8a7a62');
const C_PIT = new THREE.Color('#3d342b');
const C_WALL = new THREE.Color('#6e6252');
const C_STONE = new THREE.Color('#b8b2a4');

export function buildTerrainGeometry(seg = 240) {
  const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  return g;
}

export function updateTerrainGeometry(g, field, map, hs = 1) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, field.heightAt(pos.getX(i), pos.getZ(i)) * hs);
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();

  // 돌다리/단상(strip, circle 중 이름이 walk/plat/bridge/plaza)은 돌 색으로
  const stoneFs = map.features.filter((f) => /^(walk|plat|bridge|plaza|stair)/.test(f.id));
  const col = g.attributes.color, nrm = g.attributes.normal;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / hs, ny = nrm.getY(i);
    const [px, py] = toPx(pos.getX(i), pos.getZ(i));
    const slope = 1 - ny;
    if (y > 16) c.copy(C_WALL);
    else if (y < -6) c.copy(C_PIT).lerp(C_ROCK, Math.max(0, (y + 14) / 16));
    else {
      c.copy(C_GRASS).lerp(C_GRASS_HI, Math.min(1, Math.max(0, y / 10)));
      const n = 0.5 + 0.5 * Math.sin(px * 0.09) * Math.sin(py * 0.07);
      c.lerp(C_SAND, 0.25 * n);
      let onStone = false;
      for (const f of stoneFs) {
        if (f.type === 'circle' ? Math.hypot(px - f.x, py - f.y) < f.r - 1 : nearStrip(f, px, py)) { onStone = true; break; }
      }
      if (onStone) c.lerp(C_STONE, 0.75);
    }
    if (slope > 0.25) c.lerp(C_ROCK, Math.min(1, (slope - 0.25) * 2.2));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

function nearStrip(f, x, y) {
  for (let i = 1; i < f.pts.length; i++) {
    const [d] = segDist(x, y, f.pts[i - 1][0], f.pts[i - 1][1], f.pts[i][0], f.pts[i][1]);
    if (d < f.w / 2 - 0.5) return true;
  }
  return false;
}

export function buildWaterMeshes(map, hs = 1) {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: '#5f8f8c', transparent: true, opacity: 0.72, shininess: 80, depthWrite: false });
  for (const f of map.features) {
    if (f.type !== 'water') continue;
    const shape = new THREE.Shape(f.pts.map(([x, y]) => { const [wx, wz] = toWorld(x, y); return new THREE.Vector2(wx, -wz); }));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.y = (f.level ?? -1) * hs;
    m.renderOrder = 1;
    group.add(m);
  }
  return group;
}

// 결정적 의사난수 (바위 모양 고정용)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function buildRocks(map, field, hs = 1) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#7d6d58', roughness: 0.95, flatShading: true });
  map.rocks.forEach((r, idx) => {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const rand = rng(idx * 97 + 13);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + rand() * 0.35;
      p.setXYZ(i, p.getX(i) * k, Math.max(-0.2, p.getY(i)) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    const rad = r.s * S * 0.55;
    m.scale.set(rad, rad * 1.5 * Math.max(1, hs * 0.8), rad * (0.85 + rand() * 0.3));
    m.rotation.y = rand() * Math.PI;
    const [wx, wz] = toWorld(r.x, r.y);
    m.position.set(wx, field.heightAt(wx, wz) * hs - 0.3, wz);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  });
  return group;
}

// 레이를 지형까지 진행시켜 교차점을 찾는다
export function pickGround(ray, field, maxDist = 2000) {
  const p = new THREE.Vector3();
  let prevT = 0, step = 1.0;
  ray.at(0, p);
  if (p.y < field.heightAt(p.x, p.z)) return null;
  for (let t = step; t < maxDist; t += step) {
    ray.at(t, p);
    if (Math.abs(p.x) > WORLD_SIZE / 2 + 5 || Math.abs(p.z) > WORLD_SIZE / 2 + 5) {
      if (p.y < -40) return null;
      prevT = t; continue;
    }
    if (p.y < field.heightAt(p.x, p.z)) {
      let a = prevT, b = t;
      for (let k = 0; k < 18; k++) {
        const m = (a + b) / 2; ray.at(m, p);
        if (p.y < field.heightAt(p.x, p.z)) b = m; else a = m;
      }
      ray.at(b, p);
      return p.clone();
    }
    prevT = t;
  }
  return null;
}
