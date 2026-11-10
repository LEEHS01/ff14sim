import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { DEFAULT_MAP, TEAMS } from './mapData.js';
import {
  WORLD_SIZE, toWorld, toPx, makeHeightField, buildTerrainGeometry, updateTerrainGeometry,
  buildWaterMeshes, buildRocks, pickGround,
} from './terrain.js';
import { PRESETS } from './presets.js';

// ---------------------------------------------------------------- 상태
const LS = { scn: 'onsal.scn.v1', map: 'onsal.map.v1', ov: 'onsal.overlay.v1', view: 'onsal.view.v1' };
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 8);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

let map = lsGet(LS.map) || clone(DEFAULT_MAP);
let scn = lsGet(LS.scn) || clone(PRESETS[1].data);
let stepIdx = 0;
let tool = 'select';
let side = 'b1';
let editMap = false;
let hs = 1.5; // 높이 과장 배율
let selected = null; // {kind:'unit'|'drawing', id} | {kind:'feat', ...}
const undoStack = [];

const view = Object.assign({ fov: 50, hs: 1.5, labels: true, xray: true }, lsGet(LS.view) || {});
hs = view.hs;

const step = () => scn.steps[stepIdx];

// ---------------------------------------------------------------- three 기본
const vp = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
vp.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
vp.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fb9cf');
scene.fog = new THREE.Fog('#9fb9cf', 380, 900);

const camera = new THREE.PerspectiveCamera(view.fov, 1, 0.5, 3000);
camera.position.set(0, 230, 260);

scene.add(new THREE.HemisphereLight('#dfeaf5', '#5b5040', 1.1));
const sun = new THREE.DirectionalLight('#fff4dd', 1.8);
sun.position.set(-150, 260, -120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 10, far: 700 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// 맵 바깥 바닥
const outerShape = new THREE.Shape([[-1500, -1500], [1500, -1500], [1500, 1500], [-1500, 1500]].map(([x, y]) => new THREE.Vector2(x, y)));
const hw = WORLD_SIZE / 2 - 1;
outerShape.holes.push(new THREE.Path([[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map(([x, y]) => new THREE.Vector2(x, y))));
const outer = new THREE.Mesh(new THREE.ShapeGeometry(outerShape), new THREE.MeshLambertMaterial({ color: '#6e6252' }));
outer.rotation.x = -Math.PI / 2;
scene.add(outer);

// 지형
let field = makeHeightField(map);
const hAt = (wx, wz) => field.heightAt(wx, wz) * hs;
const hPx = (px, py) => field.heightPx(px, py) * hs;
const ground = { heightAt: hAt };

const terrainGeo = buildTerrainGeometry(240);
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

const overlayMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const overlay = new THREE.Mesh(terrainGeo, overlayMat);
overlay.visible = false;
overlay.renderOrder = 2;
scene.add(overlay);

let waterGroup = new THREE.Group(), rockGroup = new THREE.Group();
scene.add(waterGroup, rockGroup);
const nodeGroup = new THREE.Group(), unitGroup = new THREE.Group(), drawGroup = new THREE.Group(), handleGroup = new THREE.Group(), baseGroup = new THREE.Group();
scene.add(nodeGroup, unitGroup, drawGroup, handleGroup, baseGroup);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 15;
controls.maxDistance = 700;
controls.screenSpacePanning = false;
controls.target.set(0, 0, 0);

const lineMats = new Set();
function lineMat(opts) {
  const m = new LineMaterial(opts);
  m.resolution.set(vp.clientWidth, vp.clientHeight);
  lineMats.add(m);
  return m;
}

function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(w, h);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- 공통 유틸
function sideColor(s) {
  if (s === 'neutral') return '#f4f4f4';
  const t = TEAMS[scn.baseTeams?.[s]];
  return t ? t.color : '#cccccc';
}
function sideName(s) {
  const b = map.bases.find((b) => b.id === s);
  return b ? b.name : '중립';
}
function label(text, cls) {
  const div = document.createElement('div');
  div.className = 'lbl3d ' + cls;
  div.textContent = text;
  return new CSS2DObject(div);
}
function disposeGroup(g) {
  for (const o of [...g.children]) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material && !c.material.shared) { if (lineMats.has(c.material)) lineMats.delete(c.material); c.material.dispose?.(); }
      if (c.isCSS2DObject) c.element.remove();
    });
    g.remove(o);
  }
}

// 바닥에 붙는 원판 (지형 굴곡을 따라감)
function conformGeo(geo, cx, cz, lift) {
  const p = geo.attributes.position;
  if (!geo.userData.base) geo.userData.base = Float32Array.from(p.array);
  const b = geo.userData.base;
  for (let i = 0; i < p.count; i++) {
    const x = b[i * 3], z = b[i * 3 + 2];
    p.setXYZ(i, x, hAt(cx + x, cz + z) + lift, z);
  }
  p.needsUpdate = true;
  geo.computeBoundingSphere();
}
function flatCircle(r, seg = 40) { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2); return g; }
function flatRing(r0, r1, seg = 48) { const g = new THREE.RingGeometry(r0, r1, seg); g.rotateX(-Math.PI / 2); return g; }

// ---------------------------------------------------------------- 지형 빌드
let rebuildQueued = false;
function rebuildTerrain() {
  field = makeHeightField(map);
  outer.position.y = (map.features.find((f) => f.type === 'boundary')?.h ?? 30) * hs - 0.5;
  updateTerrainGeometry(terrainGeo, field, map, hs);
  disposeGroup(waterGroup); disposeGroup(rockGroup);
  scene.remove(waterGroup, rockGroup);
  waterGroup = buildWaterMeshes(map, hs);
  rockGroup = buildRocks(map, field, hs);
  scene.add(waterGroup, rockGroup);
  buildBases();
  buildNodes();
  renderStep(false);
  if (editMap) buildHandles();
}
function queueRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => { rebuildQueued = false; rebuildTerrain(); });
}

function buildBases() {
  disposeGroup(baseGroup);
  for (const b of map.bases) {
    const [wx, wz] = toWorld(b.x, b.y);
    const color = sideColor(b.id);
    const g = new THREE.Group();
    const y = hAt(wx, wz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 16, 8), new THREE.MeshStandardMaterial({ color: '#d8d0c0' }));
    pole.position.set(wx, y + 8, wz);
    pole.castShadow = true;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    flag.position.set(wx + 3.5, y + 13.5, wz);
    const pad = new THREE.Mesh(flatRing(6, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    pad.position.set(wx, 0, wz);
    conformGeo(pad.geometry, wx, wz, 0.3);
    const teamName = TEAMS[scn.baseTeams?.[b.id]]?.name || '';
    const l = label(`${b.name} 본진 · ${teamName}`, 'base');
    l.position.set(wx, y + 18, wz);
    l.element.style.borderBottom = `3px solid ${color}`;
    g.add(pole, flag, pad, l);
    baseGroup.add(g);
  }
}

// ---------------------------------------------------------------- 노드
const GRADE = {
  B: { color: '#4aa3ff', seg: 3, label: 'B' },
  A: { color: '#ff4d5a', seg: 4, label: 'A' },
  S: { color: '#ffc83d', seg: 5, label: 'S' },
};
const nodeObjs = new Map();
function buildNodes() {
  disposeGroup(nodeGroup);
  nodeObjs.clear();
  for (const n of map.nodes) {
    const [wx, wz] = toWorld(n.x, n.y);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(flatRing(3.2, 4.2, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 }));
    ring.position.set(wx, 0, wz);
    conformGeo(ring.geometry, wx, wz, 0.25);
    const l = label(n.name, 'node');
    l.position.set(wx, hAt(wx, wz) + 3, wz);
    const marker = new THREE.Group();
    marker.position.set(wx, hAt(wx, wz), wz);
    g.add(ring, l, marker);
    nodeGroup.add(g);
    nodeObjs.set(n.id, { g, marker, l, wx, wz });
  }
  applyNodeGrades();
}
function applyNodeGrades() {
  const grades = step()?.nodes || {};
  for (const [id, o] of nodeObjs) {
    disposeGroup(o.marker);
    const gr = GRADE[grades[id]];
    o.l.position.y = hAt(o.wx, o.wz) + (gr ? 13 : 3);
    o.l.element.style.background = gr ? gr.color + 'cc' : '';
    o.l.element.style.color = gr && grades[id] === 'S' ? '#222' : '';
    if (!gr) continue;
    const shape = new THREE.Mesh(new THREE.CircleGeometry(3, gr.seg), new THREE.MeshBasicMaterial({ color: gr.color, side: THREE.DoubleSide }));
    shape.position.y = 9;
    shape.userData.spin = true;
    const edge = new THREE.Mesh(new THREE.RingGeometry(3, 3.6, gr.seg), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
    shape.add(edge);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.8, 9, 24, 1, true), new THREE.MeshBasicMaterial({ color: gr.color, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 4.5;
    const disk = new THREE.Mesh(flatCircle(3.6, 32), new THREE.MeshBasicMaterial({ color: gr.color, transparent: true, opacity: 0.45, depthWrite: false }));
    conformGeo(disk.geometry, o.wx, o.wz, 0.3);
    disk.position.y = -o.marker.position.y;
    o.marker.add(shape, beam, disk);
  }
}

// ---------------------------------------------------------------- 유닛
const UNIT_R = { main: 7, small: 3.5 };
const unitObjs = new Map(); // id -> {group, data, cur:{x,y}, anim}

function makeUnitObj(u) {
  const r = UNIT_R[u.kind] || 4;
  const color = sideColor(u.side);
  const group = new THREE.Group();
  const disk = new THREE.Mesh(flatCircle(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false }));
  const ring = new THREE.Mesh(flatRing(r - 0.7, r, 48), new THREE.MeshBasicMaterial({ color }));
  disk.renderOrder = 3; ring.renderOrder = 3;
  const pin = new THREE.Group();
  const hgt = u.kind === 'main' ? 9 : 5;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, hgt, 6), new THREE.MeshStandardMaterial({ color: '#333' }));
  stick.position.y = hgt / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(u.kind === 'main' ? 1.8 : 1.1, 16, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }));
  head.position.y = hgt;
  stick.castShadow = head.castShadow = true;
  pin.add(stick, head);
  const l = label(u.label || '', 'unit');
  l.element.style.borderBottom = `3px solid ${color}`;
  l.position.y = hgt + 3;
  pin.add(l);
  group.add(disk, ring, pin);
  unitGroup.add(group);
  const o = { group, disk, ring, pin, l, data: u, cur: { x: u.x, y: u.y }, anim: null };
  placeUnit(o, u.x, u.y);
  return o;
}
function placeUnit(o, px, py) {
  o.cur = { x: px, y: py };
  const [wx, wz] = toWorld(px, py);
  o.group.position.set(wx, 0, wz);
  conformGeo(o.disk.geometry, wx, wz, 0.45);
  conformGeo(o.ring.geometry, wx, wz, 0.5);
  o.pin.position.y = hAt(wx, wz);
}
function refreshUnitLook(o) {
  const color = sideColor(o.data.side);
  o.disk.material.color.set(color);
  o.ring.material.color.set(color);
  o.pin.children[1].material.color.set(color);
  o.pin.children[1].material.emissive.set(color);
  o.l.element.textContent = o.data.label || '';
  o.l.element.style.borderBottom = `3px solid ${color}`;
}

// ---------------------------------------------------------------- 그림(경로/표시/메모)
const drawObjs = new Map();

function smoothPath(pts) {
  const world = pts.map(([x, y]) => { const [wx, wz] = toWorld(x, y); return new THREE.Vector3(wx, 0, wz); });
  if (world.length < 2) return world;
  let len = 0;
  for (let i = 1; i < world.length; i++) len += world[i].distanceTo(world[i - 1]);
  const curve = new THREE.CatmullRomCurve3(world, false, 'centripetal');
  const out = curve.getSpacedPoints(Math.max(8, Math.ceil(len / 0.8)));
  for (const p of out) p.y = hAt(p.x, p.z) + 0.9;
  return out;
}

function makePathObj(d, reveal) {
  const color = sideColor(d.side);
  const pts = smoothPath(d.pts);
  if (pts.length < 2) return null;
  const flat = pts.flatMap((p) => [p.x, p.y, p.z]);
  const group = new THREE.Group();
  const dashed = d.type === 'retreat';
  const geo = new LineGeometry(); geo.setPositions(flat);
  const main = new Line2(geo, lineMat({ color, linewidth: 5, dashed, dashSize: 2.6, gapSize: 1.8, worldUnits: false }));
  main.computeLineDistances();
  main.renderOrder = 5;
  const geo2 = new LineGeometry(); geo2.setPositions(flat);
  const xray = new Line2(geo2, lineMat({ color, linewidth: 3, dashed, dashSize: 2.6, gapSize: 1.8, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
  xray.computeLineDistances();
  xray.renderOrder = 6;
  xray.visible = view.xray;
  xray.userData.xray = true;
  // 화살촉
  const a = pts[pts.length - 1], b = pts[Math.max(0, pts.length - 4)];
  const dir = new THREE.Vector3().subVectors(a, b).normalize();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 14), new THREE.MeshBasicMaterial({ color }));
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  cone.position.copy(a).addScaledVector(dir, 1.2);
  cone.renderOrder = 5;
  group.add(main, xray, cone);
  drawGroup.add(group);
  const o = { group, data: d, pts, main, xray, cone };
  if (reveal) {
    const n = pts.length - 1;
    o.reveal = { t0: performance.now(), dur: Math.min(1400, 300 + n * 6), n };
    geo.instanceCount = 0; geo2.instanceCount = 0; cone.visible = false;
  }
  return o;
}

function makeMarkObj(d) {
  const [wx, wz] = toWorld(d.x, d.y);
  const group = new THREE.Group();
  const s = 4.5, pts = [];
  const corners = [[-s, -s], [s, -s], [s, s], [-s, s], [-s, -s]];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i], [x1, z1] = corners[i + 1];
    for (let k = 0; k <= 8; k++) {
      const x = wx + x0 + ((x1 - x0) * k) / 8, z = wz + z0 + ((z1 - z0) * k) / 8;
      pts.push(x, hAt(x, z) + 0.7, z);
    }
  }
  const geo = new LineGeometry(); geo.setPositions(pts);
  const line = new Line2(geo, lineMat({ color: '#111111', linewidth: 4 }));
  line.renderOrder = 5;
  const l = label(d.text || 'X', 'mark');
  l.position.set(wx + s + 2, hAt(wx, wz) + 3, wz);
  group.add(line, l);
  drawGroup.add(group);
  return { group, data: d };
}

function makeTextObj(d) {
  const [wx, wz] = toWorld(d.x, d.y);
  const group = new THREE.Group();
  const y = hAt(wx, wz);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 6), new THREE.MeshBasicMaterial({ color: '#fffbe6' }));
  stick.position.set(wx, y + 3, wz);
  const l = label(d.text || '메모', 'memo');
  l.position.set(wx, y + 7, wz);
  if (d.side && d.side !== 'neutral') l.element.style.borderLeft = `4px solid ${sideColor(d.side)}`;
  group.add(stick, l);
  drawGroup.add(group);
  return { group, data: d };
}

function makeDrawObj(d, reveal) {
  if (d.type === 'advance' || d.type === 'retreat') return makePathObj(d, reveal);
  if (d.type === 'mark') return makeMarkObj(d);
  if (d.type === 'text') return makeTextObj(d);
  return null;
}

// ---------------------------------------------------------------- 단계 렌더
let lastRenderedStep = -1;
function renderStep(animate) {
  const st = step();
  // 유닛: id 로 매칭해서 이동 애니메이션
  const seen = new Set();
  for (const u of st.units) {
    seen.add(u.id);
    let o = unitObjs.get(u.id);
    if (!o || o.data.kind !== u.kind) {
      if (o) { disposeGroup(o.group); unitGroup.remove(o.group); }
      o = makeUnitObj(u);
      unitObjs.set(u.id, o);
      continue;
    }
    o.data = u;
    refreshUnitLook(o);
    if (animate && (o.cur.x !== u.x || o.cur.y !== u.y)) o.anim = { from: { ...o.cur }, to: { x: u.x, y: u.y }, t0: performance.now(), dur: 900 };
    else { o.anim = null; placeUnit(o, u.x, u.y); }
  }
  for (const [id, o] of unitObjs) {
    if (!seen.has(id)) { disposeGroup(o.group); unitGroup.remove(o.group); unitObjs.delete(id); }
  }
  // 그림: 새로 생긴 경로만 그려지는 애니메이션
  const prevIds = new Set(drawObjs.keys());
  disposeGroup(drawGroup);
  drawObjs.clear();
  for (const d of st.drawings) {
    const o = makeDrawObj(d, animate && !prevIds.has(d.id));
    if (o) drawObjs.set(d.id, o);
  }
  applyNodeGrades();
  updateSelectionHighlight();
  lastRenderedStep = stepIdx;
}

// ---------------------------------------------------------------- UI: 단계
function refreshStepsUI() {
  const ol = $('#steps');
  ol.innerHTML = '';
  scn.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.title || `단계 ${i + 1}`;
    if (i === stepIdx) li.className = 'on';
    li.onclick = () => gotoStep(i, true);
    ol.appendChild(li);
  });
  $('#step-title').value = step().title || '';
  $('#step-note').value = step().note || '';
  const st = step();
  $('#step-caption').innerHTML = '';
  if (st.title || st.note) {
    const b = document.createElement('b');
    b.textContent = `${stepIdx + 1}. ${st.title || ''}`;
    $('#step-caption').append(b, document.createTextNode(st.note ? '\n' + st.note : ''));
  }
}
function gotoStep(i, animate) {
  if (i < 0 || i >= scn.steps.length) return;
  stepIdx = i;
  selected = null;
  renderStep(animate);
  refreshStepsUI();
  refreshSelPanel();
}

$('#step-add').onclick = () => {
  pushUndo();
  const copy = clone(step());
  copy.title = '';
  copy.note = '';
  scn.steps.splice(stepIdx + 1, 0, copy);
  gotoStep(stepIdx + 1, false);
  save();
  toast('현재 배치를 복사한 새 단계를 만들었어요. 유닛을 옮기고 경로를 그려보세요.');
};
$('#step-del').onclick = () => {
  if (scn.steps.length <= 1) return toast('마지막 단계는 지울 수 없어요.');
  pushUndo();
  scn.steps.splice(stepIdx, 1);
  gotoStep(Math.min(stepIdx, scn.steps.length - 1), false);
  save();
};
$('#step-title').oninput = (e) => { step().title = e.target.value; refreshStepsUI(); save(); };
$('#step-note').oninput = (e) => { step().note = e.target.value; const t = $('#step-title').value; refreshStepsUI(); $('#step-title').value = t; save(); };

let playTimer = null;
$('#step-play').onclick = () => {
  if (playTimer) return stopPlay();
  $('#step-play').textContent = '■ 정지';
  if (stepIdx >= scn.steps.length - 1) gotoStep(0, false);
  playTimer = setInterval(() => {
    if (stepIdx >= scn.steps.length - 1) return stopPlay();
    gotoStep(stepIdx + 1, true);
  }, 2800);
};
function stopPlay() { clearInterval(playTimer); playTimer = null; $('#step-play').textContent = '▶ 재생'; }

// ---------------------------------------------------------------- UI: 시나리오
const presetSel = $('#preset');
for (const p of PRESETS) { const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; presetSel.appendChild(o); }
$('#preset-load').onclick = () => {
  const p = PRESETS.find((p) => p.key === presetSel.value);
  if (!p) return;
  pushUndo();
  loadScenario(clone(p.data));
};
$('#scn-new').onclick = () => { pushUndo(); loadScenario(clone(PRESETS[0].data)); };
function loadScenario(s) {
  scn = s;
  scn.baseTeams ||= { b1: 'flames', b10: 'maelstrom', b6: 'adder' };
  stepIdx = 0;
  for (const [, o] of unitObjs) { disposeGroup(o.group); unitGroup.remove(o.group); }
  unitObjs.clear();
  buildBases();
  refreshGcUI();
  gotoStep(0, false);
  save();
}
$('#scn-export').onclick = () => download(`onsal-${(scn.title || 'scenario').replace(/\s+/g, '_')}.json`, JSON.stringify({ scenario: scn, map }, null, 1));
$('#scn-import').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    pushUndo();
    if (j.map) { map = j.map; rebuildTerrain(); lsSet(LS.map, map); }
    loadScenario(j.scenario || j);
    toast('불러왔어요.');
  } catch { toast('파일을 읽을 수 없어요.'); }
  e.target.value = '';
};
$('#scn-share').onclick = async () => {
  const payload = { scenario: scn };
  if (JSON.stringify(map) !== JSON.stringify(DEFAULT_MAP)) payload.map = map;
  const code = await compress(JSON.stringify(payload));
  const url = `${location.origin}${location.pathname}#s=${code}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('공유 링크를 복사했어요.'); } catch { toast('주소창의 링크를 복사해서 공유하세요.'); }
};

async function compress(str) {
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = ''; for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function decompress(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64); const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(ds).text();
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- UI: 총사령부 배정
function refreshGcUI() {
  const box = $('#gc-assign');
  box.innerHTML = '';
  for (const b of map.bases) {
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.textContent = `${b.name} 본진`;
    const sel = document.createElement('select');
    for (const [k, t] of Object.entries(TEAMS)) {
      const o = document.createElement('option'); o.value = k; o.textContent = t.name; sel.appendChild(o);
    }
    sel.value = scn.baseTeams[b.id];
    sel.onchange = () => {
      pushUndo();
      // 겹치면 서로 바꿔준다
      const other = Object.keys(scn.baseTeams).find((k) => k !== b.id && scn.baseTeams[k] === sel.value);
      if (other) scn.baseTeams[other] = scn.baseTeams[b.id];
      scn.baseTeams[b.id] = sel.value;
      refreshGcUI(); refreshSideButtons(); buildBases();
      for (const [, o] of unitObjs) refreshUnitLook(o);
      renderStep(false); save();
    };
    lab.appendChild(sel);
    box.appendChild(lab);
  }
}
function refreshSideButtons() {
  for (const b of $$('#sides button')) {
    const c = sideColor(b.dataset.side);
    b.style.borderColor = c;
    b.classList.toggle('on', b.dataset.side === side);
    if (b.dataset.side === side) { b.style.background = c; b.style.color = b.dataset.side === 'b6' || b.dataset.side === 'neutral' ? '#222' : '#fff'; }
    else { b.style.background = ''; b.style.color = ''; }
  }
}
for (const b of $$('#sides button')) b.onclick = () => { side = b.dataset.side; refreshSideButtons(); };

// ---------------------------------------------------------------- UI: 도구
const DRAW_TOOLS = new Set(['advance', 'retreat']);
function setTool(t) {
  tool = t;
  for (const b of $$('#tools button')) b.classList.toggle('on', b.dataset.tool === t);
  const draw = DRAW_TOOLS.has(t);
  controls.mouseButtons.LEFT = draw ? null : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = draw ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE = draw ? null : THREE.TOUCH.ROTATE;
  renderer.domElement.style.cursor = draw ? 'crosshair' : t === 'erase' ? 'not-allowed' : t === 'select' ? 'default' : 'copy';
}
for (const b of $$('#tools button')) b.onclick = () => setTool(b.dataset.tool);

// ---------------------------------------------------------------- UI: 카메라/보기
function camPreset(kind) {
  const fovK = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const d = 150 * fovK;
  let pos, target = new THREE.Vector3(0, 0, 0);
  if (kind === 'top') pos = new THREE.Vector3(0, d * 1.15, 0.01);
  else if (kind === 'quarter') pos = new THREE.Vector3(0, d * 0.75, d * 0.8);
  else {
    const b = map.bases.find((b) => b.id === kind);
    const [wx, wz] = toWorld(b.x, b.y);
    const bv = new THREE.Vector3(wx, 0, wz);
    const away = bv.clone().normalize();
    target = bv.clone().lerp(new THREE.Vector3(0, 0, 0), 0.6);
    target.y = hAt(target.x, target.z);
    pos = bv.clone().addScaledVector(away, 4);
    pos.y = Math.max(hAt(wx, wz) + 70, outer.position.y + 30);
  }
  flyTo(pos, target);
}
let fly = null;
function flyTo(pos, target) {
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, s: performance.now(), dur: 700 };
}
for (const b of $$('[data-cam]')) b.onclick = () => camPreset(b.dataset.cam);

const fovIn = $('#fov');
fovIn.value = view.fov; $('#fov-val').textContent = view.fov + '°';
fovIn.oninput = () => { view.fov = +fovIn.value; camera.fov = view.fov; camera.updateProjectionMatrix(); $('#fov-val').textContent = view.fov + '°'; lsSet(LS.view, view); };
const hsIn = $('#hscale');
hsIn.value = hs; $('#hs-val').textContent = '×' + hs;
hsIn.oninput = () => { hs = view.hs = +hsIn.value; $('#hs-val').textContent = '×' + hs; lsSet(LS.view, view); queueRebuild(); };
$('#show-labels').checked = view.labels;
$('#show-labels').onchange = (e) => { view.labels = e.target.checked; document.body.classList.toggle('hide-node-labels', !view.labels); lsSet(LS.view, view); };
document.body.classList.toggle('hide-node-labels', !view.labels);
$('#show-xray').checked = view.xray;
$('#show-xray').onchange = (e) => { view.xray = e.target.checked; drawGroup.traverse((o) => { if (o.userData.xray) o.visible = view.xray; }); lsSet(LS.view, view); };
$('#btn-panel').onclick = () => document.body.classList.toggle('panels-open');

// ---------------------------------------------------------------- 선택 패널
function findDrawing(id) { return step().drawings.find((d) => d.id === id); }
function findUnit(id) { return step().units.find((u) => u.id === id); }

function refreshSelPanel() {
  const panel = $('#sel-panel'), body = $('#sel-body');
  body.innerHTML = '';
  if (!selected || (selected.kind !== 'unit' && selected.kind !== 'drawing')) { panel.hidden = true; return; }
  const data = selected.kind === 'unit' ? findUnit(selected.id) : findDrawing(selected.id);
  if (!data) { panel.hidden = true; return; }
  panel.hidden = false;
  const addField = (labelText, el) => { const l = document.createElement('label'); l.className = 'field'; l.textContent = labelText; l.appendChild(el); body.appendChild(l); return el; };
  const sideSelect = (val, on) => {
    const s = document.createElement('select');
    for (const b of [...map.bases.map((b) => [b.id, `${b.name} (${TEAMS[scn.baseTeams[b.id]]?.name})`]), ['neutral', '흰색']]) {
      const o = document.createElement('option'); o.value = b[0]; o.textContent = b[1]; s.appendChild(o);
    }
    s.value = val || 'neutral';
    s.onchange = () => { pushUndo(); on(s.value); save(); renderStep(false); };
    return s;
  };
  if (selected.kind === 'unit') {
    const inp = document.createElement('input'); inp.value = data.label || '';
    inp.oninput = () => { data.label = inp.value; const o = unitObjs.get(data.id); if (o) refreshUnitLook(o); save(); };
    addField('이름', inp);
    addField('소속', sideSelect(data.side, (v) => { data.side = v; }));
    const kind = document.createElement('select');
    for (const [k, n] of [['main', '본대 (큰 원)'], ['small', '소수 (작은 원)']]) { const o = document.createElement('option'); o.value = k; o.textContent = n; kind.appendChild(o); }
    kind.value = data.kind;
    kind.onchange = () => { pushUndo(); data.kind = kind.value; save(); renderStep(false); };
    addField('크기', kind);
    const row = document.createElement('div'); row.className = 'row wrap';
    const pov = document.createElement('button'); pov.textContent = '👁 이 위치에서 보기';
    pov.onclick = () => {
      const [wx, wz] = toWorld(data.x, data.y);
      const p = new THREE.Vector3(wx, 0, wz);
      const fwd = new THREE.Vector3(-wx, 0, -wz).normalize();
      const pos = p.clone().addScaledVector(fwd, -14); pos.y = hAt(wx, wz) + 9;
      const tgt = p.clone().addScaledVector(fwd, 30); tgt.y = hAt(tgt.x, tgt.z) + 2;
      flyTo(pos, tgt);
    };
    row.appendChild(pov);
    body.appendChild(row);
  } else if (data.type === 'advance' || data.type === 'retreat') {
    addField('소속', sideSelect(data.side, (v) => { data.side = v; }));
    const t = document.createElement('select');
    for (const [k, n] of [['advance', '진격 (실선)'], ['retreat', '퇴로 (점선)']]) { const o = document.createElement('option'); o.value = k; o.textContent = n; t.appendChild(o); }
    t.value = data.type;
    t.onchange = () => { pushUndo(); data.type = t.value; save(); renderStep(false); };
    addField('종류', t);
  } else {
    const ta = document.createElement(data.type === 'text' ? 'textarea' : 'input');
    ta.value = data.text || '';
    ta.oninput = () => { data.text = ta.value; save(); renderStep(false); };
    addField(data.type === 'text' ? '메모 내용' : '표시 글자', ta);
    if (data.type === 'text') addField('색', sideSelect(data.side, (v) => { data.side = v; }));
  }
  const del = document.createElement('button'); del.textContent = '🗑 삭제';
  del.onclick = deleteSelected;
  body.appendChild(del);
}
function deleteSelected() {
  if (!selected) return;
  const st = step();
  if (selected.kind === 'unit') { pushUndo(); st.units = st.units.filter((u) => u.id !== selected.id); }
  else if (selected.kind === 'drawing') { pushUndo(); st.drawings = st.drawings.filter((d) => d.id !== selected.id); }
  else if (selected.kind === 'feat') return deleteFeature();
  selected = null;
  renderStep(false); refreshSelPanel(); save();
}
function updateSelectionHighlight() {
  for (const [id, o] of unitObjs) {
    const on = selected?.kind === 'unit' && selected.id === id;
    o.ring.material.color.set(on ? '#ffffff' : sideColor(o.data.side));
    o.disk.material.opacity = on ? 0.6 : 0.42;
  }
  for (const [id, o] of drawObjs) {
    if (!o.main) continue;
    const on = selected?.kind === 'drawing' && selected.id === id;
    o.main.material.linewidth = on ? 8 : 5;
  }
}

// ---------------------------------------------------------------- 저장/되돌리기
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { lsSet(LS.scn, scn); lsSet(LS.map, map); }, 250);
}
function pushUndo() {
  undoStack.push(JSON.stringify({ scn, map, stepIdx }));
  if (undoStack.length > 80) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('되돌릴 작업이 없어요.');
  const j = JSON.parse(s);
  const mapChanged = JSON.stringify(j.map) !== JSON.stringify(map);
  scn = j.scn; map = j.map; stepIdx = Math.min(j.stepIdx, scn.steps.length - 1);
  selected = null;
  if (mapChanged) rebuildTerrain();
  buildBases(); refreshGcUI(); refreshSideButtons();
  renderStep(false); refreshStepsUI(); refreshSelPanel(); refreshFeatPanel();
  save();
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------- 포인터 입력
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayFrom(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}
function groundPx(e) {
  const p = pickGround(rayFrom(e), ground);
  if (!p) return null;
  const [x, y] = toPx(p.x, p.z);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: p };
}
function screenOf(v) {
  const r = renderer.domElement.getBoundingClientRect();
  const p = v.clone().project(camera);
  return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top, p.z];
}

// 화면 좌표 근처의 대상 찾기
function hitTest(e, g) {
  const sx = e.clientX, sy = e.clientY;
  if (editMap) {
    let best = null, bd = 14;
    for (const h of handleGroup.children) {
      const [x, y, z] = screenOf(h.position);
      if (z > 1) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) return { kind: 'handle', h: best };
  }
  // 유닛: 작은 것 우선
  if (g) {
    const cands = step().units
      .map((u) => ({ u, d: Math.hypot(u.x - g.x, u.y - g.y) / (UNIT_R[u.kind] / 0.5) }))
      .filter((c) => c.d < 1.05)
      .sort((a, b) => UNIT_R[a.u.kind] - UNIT_R[b.u.kind] || a.d - b.d);
    if (cands.length) return { kind: 'unit', id: cands[0].u.id };
  }
  // 유닛 핀 머리 (화면상)
  for (const [id, o] of unitObjs) {
    const head = new THREE.Vector3(); o.pin.children[1].getWorldPosition(head);
    const [x, y, z] = screenOf(head);
    if (z < 1 && Math.hypot(x - sx, y - sy) < 12) return { kind: 'unit', id };
  }
  // 표시/메모
  for (const d of step().drawings) {
    if (d.type !== 'mark' && d.type !== 'text') continue;
    const [wx, wz] = toWorld(d.x, d.y);
    const [x, y, z] = screenOf(new THREE.Vector3(wx, hAt(wx, wz) + (d.type === 'text' ? 7 : 1), wz));
    if (z < 1 && Math.hypot(x - sx, y - sy) < 22) return { kind: 'drawing', id: d.id };
  }
  // 경로 (화면 거리)
  let best = null, bd = 10;
  for (const [id, o] of drawObjs) {
    if (!o.pts) continue;
    for (let i = 0; i < o.pts.length; i += 2) {
      const [x, y, z] = screenOf(o.pts[i]);
      if (z > 1) continue;
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) { bd = d; best = id; }
    }
  }
  if (best) return { kind: 'drawing', id: best };
  // 노드
  if (g) {
    for (const n of map.nodes) if (Math.hypot(n.x - g.x, n.y - g.y) < 9) return { kind: 'node', id: n.id };
  }
  return null;
}

let drag = null; // {kind, ...}
let downInfo = null;
const canvas = renderer.domElement;

vp.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas && !labelRenderer.domElement.contains(e.target)) return;
  downInfo = { x: e.clientX, y: e.clientY, button: e.button, t: performance.now() };
  if (e.button !== 0) return;
  const g = groundPx(e);

  if (DRAW_TOOLS.has(tool)) {
    if (!g) return;
    controls.enabled = false;
    drag = { kind: 'draw', pts: [[g.x, g.y]], temp: null };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (tool === 'select' || editMap) {
    const hit = hitTest(e, g);
    if (!hit) return;
    if (hit.kind === 'handle') {
      controls.enabled = false;
      pushUndo();
      drag = { kind: 'handle', h: hit.h, moved: false };
      selectFeature(hit.h.userData);
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (editMap) return;
    if (hit.kind === 'unit' || hit.kind === 'drawing') {
      controls.enabled = false;
      selected = { kind: hit.kind, id: hit.id };
      updateSelectionHighlight(); refreshSelPanel();
      drag = { kind: 'move', target: hit, start: g, moved: false, undoPushed: false, orig: clone(hit.kind === 'unit' ? findUnit(hit.id) : findDrawing(hit.id)) };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }
}, true);

vp.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const g = groundPx(e);
  if (!g) return;
  if (drag.kind === 'draw') {
    const last = drag.pts[drag.pts.length - 1];
    if (Math.hypot(g.x - last[0], g.y - last[1]) > 2.2) {
      drag.pts.push([g.x, g.y]);
      if (drag.temp) { disposeGroup(drag.temp); drawGroup.remove(drag.temp); }
      const o = makePathObj({ type: tool, side, pts: drag.pts }, false);
      drag.temp = o?.group || null;
    }
  } else if (drag.kind === 'move') {
    if (!drag.start) return;
    const dx = g.x - drag.start.x, dy = g.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 0.8) return;
    if (!drag.undoPushed) { undoStack.push(JSON.stringify({ scn: { ...scn, steps: scn.steps.map((s, i) => (i === stepIdx ? { ...s, units: s.units.map((u) => (u.id === drag.orig.id ? drag.orig : u)), drawings: s.drawings.map((d) => (d.id === drag.orig.id ? drag.orig : d)) } : s)) }, map, stepIdx })); drag.undoPushed = true; }
    drag.moved = true;
    const t = drag.target;
    if (t.kind === 'unit') {
      const u = findUnit(t.id);
      u.x = Math.round((drag.orig.x + dx) * 10) / 10; u.y = Math.round((drag.orig.y + dy) * 10) / 10;
      const o = unitObjs.get(t.id); o.anim = null; placeUnit(o, u.x, u.y);
    } else {
      const d = findDrawing(t.id);
      if (d.pts) d.pts = drag.orig.pts.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]);
      else { d.x = drag.orig.x + dx; d.y = drag.orig.y + dy; }
      rebuildDrawing(d);
    }
  } else if (drag.kind === 'handle') {
    drag.moved = true;
    moveHandle(drag.h, g.x, g.y);
  }
}, true);

vp.addEventListener('pointerup', (e) => {
  const wasClick = downInfo && Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y) < 5 && performance.now() - downInfo.t < 600;
  const btn = downInfo?.button;
  downInfo = null;
  if (drag) {
    const d = drag; drag = null;
    controls.enabled = true;
    if (d.kind === 'draw') {
      if (d.temp) { disposeGroup(d.temp); drawGroup.remove(d.temp); }
      const pts = simplify(d.pts, 1.2);
      if (pts.length >= 2 && pathLen(pts) > 6) {
        pushUndo();
        const nd = { id: uid('d'), type: tool, side, pts };
        step().drawings.push(nd);
        const o = makeDrawObj(nd, false); if (o) drawObjs.set(nd.id, o);
        save();
      }
      return;
    }
    if (d.kind === 'move') { if (d.moved) save(); return; }
    if (d.kind === 'handle') { if (d.moved) { save(); queueRebuild(); } else undoStack.pop(); return; }
  }
  if (!wasClick || btn !== 0) return;
  const g = groundPx(e);
  onClick(e, g);
}, true);

function onClick(e, g) {
  if (editMap) {
    const hit = hitTest(e, g);
    if (!hit) { selectFeature(null); }
    return;
  }
  if (tool === 'select') {
    const hit = hitTest(e, g);
    if (hit?.kind === 'node') {
      pushUndo();
      const st = step(); st.nodes ||= {};
      const order = [undefined, 'B', 'A', 'S'];
      const next = order[(order.indexOf(st.nodes[hit.id]) + 1) % order.length];
      if (next) st.nodes[hit.id] = next; else delete st.nodes[hit.id];
      applyNodeGrades(); save();
      return;
    }
    if (!hit) { selected = null; updateSelectionHighlight(); refreshSelPanel(); }
    return;
  }
  if (tool === 'erase') {
    const hit = hitTest(e, g);
    if (hit && (hit.kind === 'unit' || hit.kind === 'drawing')) { selected = { kind: hit.kind, id: hit.id }; deleteSelected(); }
    return;
  }
  if (!g) return;
  if (tool === 'main' || tool === 'small') {
    pushUndo();
    const count = step().units.filter((u) => u.side === side && u.kind === tool).length;
    const name = side === 'neutral' ? (tool === 'main' ? '본대' : '소수') : `${sideName(side)} ${tool === 'main' ? '본대' : '소수'}${count ? ' ' + (count + 1) : ''}`;
    const u = { id: uid('u'), side, kind: tool, label: name, x: g.x, y: g.y };
    step().units.push(u);
    renderStep(false);
    selected = { kind: 'unit', id: u.id }; updateSelectionHighlight(); refreshSelPanel();
    save();
  } else if (tool === 'mark') {
    pushUndo();
    const used = step().drawings.filter((d) => d.type === 'mark').map((d) => d.text);
    const letter = ['X', 'Y', 'Z', 'W', 'V'].find((l) => !used.includes(l)) || 'X';
    step().drawings.push({ id: uid('d'), type: 'mark', text: letter, x: g.x, y: g.y });
    renderStep(false); save();
  } else if (tool === 'text') {
    pushUndo();
    const d = { id: uid('d'), type: 'text', text: '메모', side, x: g.x, y: g.y };
    step().drawings.push(d);
    renderStep(false); save();
    selected = { kind: 'drawing', id: d.id }; refreshSelPanel();
    document.body.classList.add('panels-open');
    const ta = $('#sel-body textarea'); if (ta) { ta.focus(); ta.select(); }
  }
}

function rebuildDrawing(d) {
  const old = drawObjs.get(d.id);
  if (old) { disposeGroup(old.group); drawGroup.remove(old.group); }
  const o = makeDrawObj(d, false);
  if (o) drawObjs.set(d.id, o);
  updateSelectionHighlight();
}
function pathLen(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  const map_ = { v: 'select', 1: 'main', 2: 'small', 3: 'advance', 4: 'retreat', 5: 'mark', 6: 'text', e: 'erase' };
  const t = map_[e.key.toLowerCase()];
  if (t) setTool(t);
  if (e.key === 'ArrowRight' || e.key === 'PageDown') gotoStep(stepIdx + 1, true);
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') gotoStep(stepIdx - 1, true);
});

// ---------------------------------------------------------------- 지형 편집
const HANDLE_COLORS = { circle: '#ffd84a', strip: '#5ab0ff', poly: '#ff9a3c', water: '#46d1c8', boundary: '#ff5470', rock: '#b0a080', node: '#ffffff', base: '#ff66ff' };
const handleGeo = new THREE.SphereGeometry(1.3, 12, 8);

function buildHandles() {
  disposeGroup(handleGroup);
  const add = (px, py, ref, type) => {
    const mat = new THREE.MeshBasicMaterial({ color: HANDLE_COLORS[type], depthTest: false, transparent: true, opacity: 0.95 });
    mat.shared = false;
    const m = new THREE.Mesh(handleGeo.clone(), mat);
    const [wx, wz] = toWorld(px, py);
    m.position.set(wx, hPx(px, py) + 1.6, wz);
    m.renderOrder = 20;
    m.userData = { ...ref, type };
    if (isSelectedRef(ref)) m.scale.setScalar(1.8);
    handleGroup.add(m);
  };
  map.features.forEach((f, fi) => {
    if (f.type === 'circle') add(f.x, f.y, { fi }, 'circle');
    else f.pts.forEach(([x, y], pi) => add(x, y, { fi, pi }, f.type));
  });
  map.rocks.forEach((r, ri) => add(r.x, r.y, { ri }, 'rock'));
  map.nodes.forEach((n, ni) => add(n.x, n.y, { ni }, 'node'));
  map.bases.forEach((b, bi) => add(b.x, b.y, { bi }, 'base'));
}
function isSelectedRef(ref) {
  if (!selected || selected.kind !== 'feat') return false;
  const s = selected.ref;
  if (ref.fi !== undefined) return s.fi === ref.fi;
  if (ref.ri !== undefined) return s.ri === ref.ri;
  if (ref.ni !== undefined) return s.ni === ref.ni;
  if (ref.bi !== undefined) return s.bi === ref.bi;
  return false;
}
function moveHandle(h, x, y) {
  const r = h.userData;
  x = Math.round(x); y = Math.round(y);
  if (r.fi !== undefined) {
    const f = map.features[r.fi];
    if (f.type === 'circle') { f.x = x; f.y = y; } else f.pts[r.pi] = [x, y];
  } else if (r.ri !== undefined) Object.assign(map.rocks[r.ri], { x, y });
  else if (r.ni !== undefined) Object.assign(map.nodes[r.ni], { x, y });
  else if (r.bi !== undefined) Object.assign(map.bases[r.bi], { x, y });
  const [wx, wz] = toWorld(x, y);
  h.position.set(wx, hPx(x, y) + 1.6, wz);
  queueRebuild();
}
function selectFeature(ref) {
  selected = ref ? { kind: 'feat', ref } : null;
  refreshFeatPanel();
  if (editMap) buildHandles();
}
const FEAT_NAMES = { circle: '원형 (언덕/단상)', strip: '길/다리/경사로', poly: '영역', water: '물', boundary: '맵 외곽', rock: '바위', node: '노드', base: '본진' };
function refreshFeatPanel() {
  const body = $('#feat-body');
  body.innerHTML = '';
  if (!selected || selected.kind !== 'feat') { body.textContent = '선택된 지형 없음'; return; }
  const r = selected.ref;
  let obj, type;
  if (r.fi !== undefined) { obj = map.features[r.fi]; type = obj?.type; }
  else if (r.ri !== undefined) { obj = map.rocks[r.ri]; type = 'rock'; }
  else if (r.ni !== undefined) { obj = map.nodes[r.ni]; type = 'node'; }
  else if (r.bi !== undefined) { obj = map.bases[r.bi]; type = 'base'; }
  if (!obj) { body.textContent = '선택된 지형 없음'; return; }
  const title = document.createElement('div');
  title.innerHTML = `<b>${FEAT_NAMES[type]}</b> <span class="hint">${obj.id || obj.name || ''}</span>`;
  body.appendChild(title);
  const slider = (key, label, min, max, stepv) => {
    if (obj[key] === undefined && key !== 'h2') return;
    const l = document.createElement('label'); l.className = 'field';
    const val = document.createElement('b');
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = stepv;
    inp.value = obj[key] ?? obj.h;
    val.textContent = ' ' + (obj[key] ?? '—');
    inp.onpointerdown = () => pushUndo();
    inp.oninput = () => { obj[key] = +inp.value; val.textContent = ' ' + inp.value; queueRebuild(); save(); };
    l.append(label, val, inp); body.appendChild(l);
  };
  if (type === 'circle') { slider('h', '높이', -20, 30, 0.5); slider('r', '반지름', 3, 80, 1); slider('edge', '경사 폭 (작을수록 절벽)', 0.5, 30, 0.5); }
  if (type === 'strip') { slider('h', '시작 높이', -20, 30, 0.5); if (obj.h2 !== undefined) slider('h2', '끝 높이', -20, 30, 0.5); slider('w', '폭', 2, 40, 0.5); slider('edge', '가장자리', 0.5, 20, 0.5); }
  if (type === 'poly' || type === 'water' || type === 'boundary') { slider('h', type === 'boundary' ? '벽 높이' : '높이', -20, 40, 0.5); slider('edge', '경사 폭', 0.5, 30, 0.5); if (type === 'water') slider('level', '수면 높이', -10, 10, 0.5); }
  if (type === 'rock') slider('s', '크기', 2, 40, 0.5);
  if (type === 'node' || type === 'base') {
    const l = document.createElement('label'); l.className = 'field'; l.textContent = '이름';
    const inp = document.createElement('input'); inp.value = obj.name;
    inp.onchange = () => { pushUndo(); obj.name = inp.value; buildNodes(); buildBases(); save(); };
    l.appendChild(inp); body.appendChild(l);
  }
  const row = document.createElement('div'); row.className = 'row wrap';
  if (r.pi !== undefined && obj.pts) {
    const addPt = document.createElement('button'); addPt.textContent = '+ 점 추가';
    addPt.onclick = () => {
      pushUndo();
      const a = obj.pts[r.pi], b = obj.pts[(r.pi + 1) % obj.pts.length];
      obj.pts.splice(r.pi + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]);
      queueRebuild(); save();
    };
    const delPt = document.createElement('button'); delPt.textContent = '− 이 점 삭제';
    delPt.onclick = () => {
      const min = obj.type === 'strip' ? 2 : 3;
      if (obj.pts.length <= min) return toast('점이 너무 적어요.');
      pushUndo(); obj.pts.splice(r.pi, 1); selected = null; refreshFeatPanel(); queueRebuild(); save();
    };
    row.append(addPt, delPt);
  }
  if (type !== 'boundary' && type !== 'base') {
    const del = document.createElement('button'); del.textContent = '🗑 삭제';
    del.onclick = deleteFeature;
    row.appendChild(del);
  }
  body.appendChild(row);
}
function deleteFeature() {
  if (!selected || selected.kind !== 'feat') return;
  const r = selected.ref;
  pushUndo();
  if (r.fi !== undefined) { if (map.features[r.fi].type === 'boundary') return; map.features.splice(r.fi, 1); }
  else if (r.ri !== undefined) map.rocks.splice(r.ri, 1);
  else if (r.ni !== undefined) map.nodes.splice(r.ni, 1);
  else return;
  selected = null; refreshFeatPanel(); queueRebuild(); save();
}
function targetPx() { return toPx(controls.target.x, controls.target.z).map(Math.round); }
function insertBeforeBoundary(f) {
  const bi = map.features.findIndex((x) => x.type === 'boundary');
  map.features.splice(bi < 0 ? map.features.length : bi, 0, f);
  return bi < 0 ? map.features.length - 1 : bi;
}
$('#feat-add-hill').onclick = () => {
  pushUndo(); const [x, y] = targetPx();
  const fi = insertBeforeBoundary({ id: uid('hill-'), type: 'circle', x, y, r: 15, h: 6, edge: 5 });
  selectFeature({ fi }); queueRebuild(); save();
};
$('#feat-add-ramp').onclick = () => {
  pushUndo(); const [x, y] = targetPx();
  const fi = insertBeforeBoundary({ id: uid('ramp-'), type: 'strip', w: 8, h: 6, h2: 0, edge: 2, pts: [[x - 15, y], [x + 15, y]] });
  selectFeature({ fi, pi: 0 }); queueRebuild(); save();
};
$('#feat-add-rock').onclick = () => {
  pushUndo(); const [x, y] = targetPx();
  map.rocks.push({ x, y, s: 10 });
  selectFeature({ ri: map.rocks.length - 1 }); queueRebuild(); save();
};
$('#btn-edit-map').onclick = () => {
  editMap = !editMap;
  $('#btn-edit-map').classList.toggle('on', editMap);
  $('#map-panel').hidden = !editMap;
  selected = null; refreshSelPanel(); refreshFeatPanel();
  unitGroup.visible = drawGroup.visible = !editMap;
  if (editMap) { buildHandles(); toast('지형 편집 모드: 구슬을 드래그하세요. 유닛/경로는 잠시 숨겨져요.'); }
  else disposeGroup(handleGroup);
};
$('#map-export').onclick = () => download('onsal-map.json', JSON.stringify(map, null, 1));
$('#map-import').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const j = JSON.parse(await f.text()); pushUndo(); map = j.map || j; rebuildTerrain(); applyOverlayParams(); save(); toast('지형을 불러왔어요.'); }
  catch { toast('파일을 읽을 수 없어요.'); }
  e.target.value = '';
};
$('#map-reset').onclick = () => {
  pushUndo(); map = clone(DEFAULT_MAP); rebuildTerrain(); applyOverlayParams(); save();
  toast('지형을 기본값으로 되돌렸어요. Ctrl+Z 로 취소할 수 있어요.');
};

// ---------------------------------------------------------------- 참고 지도 오버레이
function applyOverlayParams() {
  const o = map.overlay ||= { opacity: 0.6, scale: 1, rot: 0, dx: 0, dy: 0 };
  overlayMat.opacity = o.opacity;
  const t = overlayMat.map;
  if (t) {
    t.center.set(0.5, 0.5);
    t.repeat.set(1 / o.scale, 1 / o.scale);
    t.rotation = THREE.MathUtils.degToRad(o.rot);
    t.offset.set(-o.dx, o.dy);
  }
  for (const k of ['opacity', 'scale', 'rot', 'dx', 'dy']) $('#ov-' + k).value = o[k];
}
function setOverlayImage(src) {
  const img = new Image();
  img.onload = () => {
    // 가장자리를 투명하게 해서 바깥으로 늘어나지 않게
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N + 4;
    c.getContext('2d').drawImage(img, 2, 2, N, N);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    overlayMat.map?.dispose();
    overlayMat.map = tex; overlayMat.needsUpdate = true;
    overlay.visible = true;
    applyOverlayParams();
  };
  img.src = src;
}
$('#ov-file').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    setOverlayImage(rd.result);
    if (!lsSet(LS.ov, rd.result)) toast('이미지가 커서 브라우저에 저장하지 못했어요 (새로고침하면 사라져요).');
  };
  rd.readAsDataURL(f);
  e.target.value = '';
};
$('#ov-clear').onclick = () => { overlay.visible = false; overlayMat.map?.dispose(); overlayMat.map = null; try { localStorage.removeItem(LS.ov); } catch {} };
for (const k of ['opacity', 'scale', 'rot', 'dx', 'dy']) {
  $('#ov-' + k).oninput = (e) => { (map.overlay ||= {})[k] = +e.target.value; applyOverlayParams(); save(); };
}

// ---------------------------------------------------------------- 애니메이션 루프
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const now = performance.now();
  if (fly) {
    const k = Math.min(1, (now - fly.s) / fly.dur), e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (k >= 1) fly = null;
  }
  for (const [, o] of unitObjs) {
    if (!o.anim) continue;
    const k = Math.min(1, (now - o.anim.t0) / o.anim.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    placeUnit(o, o.anim.from.x + (o.anim.to.x - o.anim.from.x) * e, o.anim.from.y + (o.anim.to.y - o.anim.from.y) * e);
    if (k >= 1) o.anim = null;
  }
  for (const [, o] of drawObjs) {
    if (!o.reveal) continue;
    const k = Math.min(1, (now - o.reveal.t0) / o.reveal.dur);
    const n = Math.max(1, Math.floor(o.reveal.n * k));
    o.main.geometry.instanceCount = n; o.xray.geometry.instanceCount = n;
    if (k >= 1) { o.cone.visible = true; o.main.geometry.instanceCount = Infinity; o.xray.geometry.instanceCount = Infinity; o.reveal = null; }
  }
  const t = clock.getElapsedTime();
  nodeGroup.traverse((o) => { if (o.userData.spin) { o.rotation.y = t * 1.5; o.position.y = 9 + Math.sin(t * 2) * 0.5; } });
  // 리트리트 점선 흐름 효과
  for (const m of lineMats) if (m.dashed) m.dashOffset = -t * 4;
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// ---------------------------------------------------------------- 시작
async function init() {
  if (location.hash.startsWith('#s=')) {
    try {
      const j = JSON.parse(await decompress(location.hash.slice(3)));
      if (j.map) map = j.map;
      if (j.scenario) scn = j.scenario;
      toast('공유된 시나리오를 불러왔어요.');
    } catch { toast('공유 링크를 읽지 못했어요.'); }
  }
  scn.baseTeams ||= { b1: 'flames', b10: 'maelstrom', b6: 'adder' };
  resize();
  rebuildTerrain();
  refreshGcUI();
  refreshSideButtons();
  refreshStepsUI();
  setTool('select');
  const ov = lsGet(LS.ov);
  if (ov) setOverlayImage(ov);
  applyOverlayParams();
  camPreset('quarter');
  tick();
}
init();

// 디버그/테스트용
window.__onsal = { get map() { return map; }, get scn() { return scn; }, gotoStep, camPreset, setTool, camera, controls };
