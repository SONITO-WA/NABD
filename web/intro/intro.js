// NABD - opening sequence: NISAR launch (GSLV-F16, Sriharikota, 30 July 2025) -> orbit.
// Everything is built in code (no photos): pad, rocket, smoke, Earth, the NISAR spacecraft.
// The timeline is a pure function of time t, so "skip" just jumps to the end.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

// ------------------------------------------------------------------ timeline (seconds)
export const T = {
  ign: 0.25, lift: 0.95, cut: 1.2, shotB: 2.45, space: 3.85,
  boost: 4.45, core: 5.1, fair: 5.75, sep: 6.45,
  deploy: 6.75, deployEnd: 8.55, ui: 8.85, end: 9.5,
};
const R_E = 6371000;
const ALT0 = 230000, ALT1 = 747000;            // metres: end of ascent -> NISAR orbit

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const deg = THREE.MathUtils.degToRad;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ------------------------------------------------------------------ procedural textures
function cnv(w, h = w) { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; }
function tex(c, srgb = true, rep) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  return t;
}
function paintTex(R, soot, o = {}) {
  // o.len / o.circ: section size in metres (keeps lettering undistorted); o.draw(g, W, H, mu, mv) paints decals
  const W = 1024, H = o.len ? Math.min(1536, Math.round(W * o.len / o.circ / 128) * 128 || 1024) : 1024, [c, g] = cnv(W, H);
  g.fillStyle = "#f2f1ed"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(110,104,96,${R() * 0.032})`;
    g.fillRect(R() * W, R() * H, 2 + R() * 34, 1 + R() * 5);
  }
  for (let i = 0; i < 140; i++) {                                                // faint streaks from rain and handling
    const x = R() * W, y = R() * H; g.fillStyle = `rgba(120,112,100,${0.025 + R() * 0.04})`; g.fillRect(x, y, 1 + R() * 2, 20 + R() * 120);
  }
  g.fillStyle = "rgba(80,80,80,.26)";
  for (let k = 0; k < 24; k++) g.fillRect(k * W / 24, 0, 1.4, H);            // panel seams
  const rings = Math.max(4, Math.round((o.len || 20) / 2.6));
  for (let k = 1; k < rings; k++) g.fillRect(0, k * H / rings, W, 1.2);      // weld rings
  if (o.draw) { g.save(); o.draw(g, W, H, W / (o.circ || 8.8), H / (o.len || 8.8)); g.restore(); }
  if (soot) {
    const gr = g.createLinearGradient(0, H, 0, H * 0.8);
    gr.addColorStop(0, "rgba(55,48,40,.5)"); gr.addColorStop(1, "rgba(55,48,40,0)");
    g.fillStyle = gr; g.fillRect(0, H * 0.8, W, H * 0.2);
  }
  return tex(c);
}
function seamTex(len = 20) {
  const W = 512, H = 512, [c, g] = cnv(W, H); g.fillStyle = "#808080"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#3a3a3a"; for (let k = 0; k < 24; k++) g.fillRect(k * W / 24, 0, 1.5, H);
  const rings = Math.max(4, Math.round(len / 2.6)); for (let k = 1; k < rings; k++) g.fillRect(0, k * H / rings, W, 2);
  g.fillStyle = "#9a9a9a"; for (let k = 0; k < 24; k++) for (let y = 6; y < H; y += 12) g.fillRect(k * W / 24 + 4, y, 2, 2);   // rivet rows
  return tex(c, false);
}
// lettering in a vertical column centred at u (0..1 around the body), top at metre `top` from the section top
function vText(g, W, H, mu, mv, u, top, text, hM, font = "800", col = "#1d2a5c") {
  g.save(); g.translate(u * W, top * mv); g.scale(1, mv / mu); g.rotate(Math.PI / 2);
  g.fillStyle = col; g.font = `${font} ${hM * mu}px "Archivo", "Segoe UI", "Nirmala UI", sans-serif`; g.textBaseline = "middle";
  g.fillText(text, 0, 0); g.restore();
}
function flag(g, W, H, mu, mv, u, top, wM) {                                        // Indian tricolour, mounted vertically
  const w = wM * mu, h = wM * 1.5 * mv, x = u * W - w / 2, y = top * mv;
  const cols = ["#ff9933", "#ffffff", "#138808"];
  for (let i = 0; i < 3; i++) { g.fillStyle = cols[i]; g.fillRect(x + (2 - i) * w / 3, y, w / 3 + 0.5, h); }
  g.strokeStyle = "#000080"; g.lineWidth = Math.max(1, w * 0.02);
  g.beginPath(); g.ellipse(x + w / 2, y + h / 2, w * 0.13, w * 0.13 * mv / mu, 0, 0, 7); g.stroke();
  g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 1; g.strokeRect(x, y, w, h);
}
function foilTex(R) {
  const N = 512, [c, g] = cnv(N);
  g.fillStyle = "#8c6a2b"; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 1600; i++) {
    const x = R() * N, y = R() * N, s = 6 + R() * 42;
    g.fillStyle = `hsla(${38 + R() * 10},${55 + R() * 30}%,${22 + R() * 50}%,${0.3 + R() * 0.45})`;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 3 + (R() * 3 | 0); k++) g.lineTo(x + (R() - 0.5) * s * 2, y + (R() - 0.5) * s * 2);
    g.closePath(); g.fill();
  }
  const src = g.getImageData(0, 0, N, N).data, [nc, ng] = cnv(N), out = ng.createImageData(N, N);
  const h = (x, y) => { x = (x + N) % N; y = (y + N) % N; const i = (y * N + x) * 4; return (src[i] + src[i + 1] + src[i + 2]) / 765; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 4, dy = (h(x, y + 1) - h(x, y - 1)) * 4, l = Math.hypot(dx, dy, 1), i = (y * N + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  ng.putImageData(out, 0, 0);
  return { map: tex(c, true, [2, 2]), normal: tex(nc, false, [2, 2]) };
}
function cellTex(R) {
  const N = 512, [c, g] = cnv(N), cols = 6, rows = 10, gap = 4;
  g.fillStyle = "#b9bdc4"; g.fillRect(0, 0, N, N);
  const w = (N - gap * (cols + 1)) / cols, hh = (N - gap * (rows + 1)) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = gap + i * (w + gap), y = gap + j * (hh + gap), b = R() * 0.18;
    const gr = g.createLinearGradient(x, y, x + w, y + hh);
    gr.addColorStop(0, `rgb(${18 + b * 50},${32 + b * 60},${78 + b * 70})`); gr.addColorStop(1, "rgb(7,14,40)");
    g.fillStyle = gr; g.fillRect(x, y, w, hh);
    g.strokeStyle = "rgba(170,182,205,.16)"; g.lineWidth = 1;
    for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x + w * k / 5, y); g.lineTo(x + w * k / 5, y + hh); g.stroke(); }
  }
  return tex(c);
}
function meshAlphaTex() {
  const N = 256, [c, g] = cnv(N);
  g.fillStyle = "rgb(70,70,70)"; g.fillRect(0, 0, N, N);
  g.strokeStyle = "#fff"; g.lineWidth = 1.2;
  for (let i = 0; i <= N; i += 8) {
    g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, N); g.stroke();
    g.beginPath(); g.moveTo(0, i + 0.5); g.lineTo(N, i + 0.5); g.stroke();
  }
  return tex(c, false, [10, 10]);
}
function puffTex(R) {
  const N = 128, [c, g] = cnv(N);
  for (let i = 0; i < 26; i++) {
    const a = R() * 6.283, r = R() * 28, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, s = 14 + R() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, `rgba(255,255,255,${0.22 + R() * 0.22})`); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 7); g.fill();
  }
  return tex(c, false);
}
function groundTex(R) {
  const N = 1024, [c, g] = cnv(N);
  g.fillStyle = "#5f6a3c"; g.fillRect(0, 0, N, N);
  const cols = ["#4a5730", "#77714a", "#3d4a2a", "#86805a", "#56633a"];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.12 + R() * 0.25;
    g.beginPath(); g.ellipse(R() * N, R() * N, 4 + R() * 46, 3 + R() * 26, R() * 3, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  return tex(c, true, [90, 90]);
}
function concreteTex(R) {
  const N = 512, [c, g] = cnv(N);
  g.fillStyle = "#b1ada3"; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${R() < 0.5 ? 70 : 230},${R() < 0.5 ? 66 : 225},60,${R() * 0.06})`; g.fillRect(R() * N, R() * N, 1 + R() * 3, 1 + R() * 3); }
  g.strokeStyle = "rgba(60,58,54,.35)"; g.lineWidth = 1.5;
  for (let k = 0; k <= N; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, N); g.moveTo(0, k); g.lineTo(N, k); g.stroke(); }
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.42);
  gr.addColorStop(0, "rgba(40,36,32,.55)"); gr.addColorStop(1, "rgba(40,36,32,0)");
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return tex(c, true);
}

// ------------------------------------------------------------------ smoke particles
const SMOKE_VS = `
attribute float size; attribute float alpha; attribute float heat; attribute float rot; attribute float tint;
uniform float scale; varying float vA; varying float vH; varying float vR; varying float vT;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
  gl_PointSize = min(scale * size / -mv.z, 520.0); vA = alpha; vH = heat; vR = rot; vT = tint; }`;
const SMOKE_FS = `
uniform sampler2D map; uniform vec3 lit; uniform vec3 shade;
varying float vA; varying float vH; varying float vR; varying float vT;
void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR);
  vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + 0.5;
  float a = texture2D(map, q).a * vA; if (a < 0.004) discard;
  float l = clamp(1.05 - gl_PointCoord.y, 0.0, 1.0);
  vec3 col = mix(shade, lit, l) * vT + vec3(1.0, 0.42, 0.1) * vH * 3.5;
  gl_FragColor = vec4(col, a); }`;
class Smoke {
  constructor(n, map, { lit = 0xefebe5, shade = 0x86817b, drag = 0.7, buoy = 1.2, ground = null, maxA = 0.9 } = {}) {
    Object.assign(this, { n, drag, buoy, ground, maxA, i: 0 });
    const f = k => new Float32Array(n * k);
    this.p = f(3); this.v = f(3); this.age = f(1).fill(1e9); this.life = f(1).fill(1);
    this.s0 = f(1); this.gr = f(1); this.h0 = f(1);
    this.size = f(1); this.alpha = f(1); this.heat = f(1); this.rot = f(1); this.tint = f(1);
    const geo = new THREE.BufferGeometry();
    const at = (name, arr, k) => geo.setAttribute(name, new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage));
    at("position", this.p, 3); at("size", this.size, 1); at("alpha", this.alpha, 1); at("heat", this.heat, 1); at("rot", this.rot, 1); at("tint", this.tint, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, scale: { value: 500 }, lit: { value: new THREE.Color(lit) }, shade: { value: new THREE.Color(shade) } },
      vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }
  spawn(x, y, z, vx, vy, vz, s0, grow, life, heat, R) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.gr[i] = grow; this.h0[i] = heat;
    this.rot[i] = R() * 6.283; this.tint[i] = 0.68 + R() * 0.34;
  }
  clear() { this.age.fill(1e9); this.alpha.fill(0); this.points.geometry.attributes.alpha.needsUpdate = true; }
  update(dt) {
    const { p, v } = this, k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] > this.life[i]) { this.alpha[i] = 0; continue; }
      const a = (this.age[i] += dt), j = i * 3;
      v[j] *= k; v[j + 1] = v[j + 1] * k + this.buoy * dt; v[j + 2] *= k;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (this.ground !== null && p[j + 1] < this.ground) {                 // hits the pad: spreads sideways
        p[j + 1] = this.ground; const sp = Math.abs(v[j + 1]) * 0.55;
        const r = Math.hypot(p[j], p[j + 2]) || 1; v[j] += p[j] / r * sp; v[j + 2] += p[j + 2] / r * sp; v[j + 1] = Math.abs(v[j + 1]) * 0.12;
      }
      this.size[i] = this.s0[i] + this.gr[i] * a;
      this.alpha[i] = Math.min(1, a / 0.12) * (1 - sstep(0.5 * this.life[i], this.life[i], a)) * this.maxA;
      this.heat[i] = Math.max(0, 1 - a / 0.4) * this.h0[i];
    }
    const at = this.points.geometry.attributes;
    at.position.needsUpdate = at.size.needsUpdate = at.alpha.needsUpdate = at.heat.needsUpdate = true;
    at.rot.needsUpdate = at.tint.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ engine plume
const PLUME_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const PLUME_FS = `uniform float time; uniform float power; uniform float vac; uniform float seed;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vec3 V = normalize(cameraPosition - vW); float f = abs(dot(normalize(vN), V));
  float along = vUv.y;                                  // 1 at the nozzle, 0 at the tail
  float core = pow(f, mix(2.6, 1.4, vac));
  float tail = pow(along, mix(1.5, 0.9, vac));
  float fl = 0.82 + 0.18 * sin(time*63.0 + along*27.0 + seed) * sin(time*41.0 + along*13.0);
  float diamonds = 1.0 + (1.0 - vac) * 0.25 * pow(max(0.0, sin(along * 34.0)), 6.0) * smoothstep(0.55, 0.95, along);
  vec3 hot = vec3(1.0, 0.95, 0.8), mid = vec3(1.0, 0.56, 0.2), cool = vec3(0.85, 0.24, 0.06), vc = vec3(0.7, 0.8, 1.0);
  vec3 col = mix(cool, mid, smoothstep(0.0, 0.55, along));
  col = mix(col, hot, smoothstep(0.5, 1.0, along) * core);
  col = mix(col, mix(vc, hot, 0.35), vac * 0.55);
  float a = core * tail * fl * diamonds * power;
  gl_FragColor = vec4(col * a * mix(7.0, 2.2, vac), 1.0); }`;
function makePlume(len, rTop, rBot, seed) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, 28, 1, true);
  geo.translate(0, -len / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, power: { value: 0 }, vac: { value: 0 }, seed: { value: seed } },
    vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5; return m;
}

// ------------------------------------------------------------------ rocket (GSLV Mk II layout)
function lathe(profile, mat, seg = 48, phi0 = 0, phiLen = Math.PI * 2) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiLen);
  const n = profile.length, cum = [0];                                // v along the real length, so lettering is not stretched
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, cum[Math.round(uv.getY(i) * (n - 1))] / cum[n - 1]);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true; return m;
}
function ring(r, y, h, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), mat); m.position.y = y; m.castShadow = true; return m;
}
export function buildRocket(R) {
  const U = 0.09;                                     // side of the body that faces the pad camera
  const paintMat = (soot, o, len) => new THREE.MeshStandardMaterial({ color: 0xe9e7e2, map: paintTex(R, soot, o), bumpMap: seamTex(len), bumpScale: 0.6,
    roughness: soot ? 0.48 : 0.38, metalness: 0.03 });
  const white = paintMat(true, { len: 20, circ: 8.8, draw: (g, W, H, mu, mv) => vText(g, W, H, mu, mv, U, 3.0, "GSLV", 1.55, "800", "#1d2a5c") }, 20);
  const strap = paintMat(true, { len: 17, circ: 6.6 }, 17);
  const upperM = paintMat(false, { len: 11.5, circ: 8.8, draw: (g, W, H, mu, mv) => { flag(g, W, H, mu, mv, U, 1.2, 1.15); vText(g, W, H, mu, mv, U, 3.4, "भारत  INDIA", 0.62, "700", "#1d2a5c"); } }, 11.5);
  const clean = paintMat(false, { len: 8.7, circ: 8.8 }, 8.7);
  const fairM = paintMat(false, { len: 11.5, circ: 6.3, draw: (g, W, H, mu, mv) => vText(g, W, H, mu, mv, 0.17, 4.2, "NISAR", 0.75, "700", "#25314f") }, 11.5);
  const black = new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.6, metalness: 0.15 });
  const nozzle = new THREE.MeshStandardMaterial({ color: 0x3b3936, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide });
  const rocket = new THREE.Group();
  const P = { boosters: [], plumes: {} };

  // core stage S139 (solid)
  const core = new THREE.Group();
  core.add(lathe([[1.32, 0], [1.4, 0.35], [1.4, 20]], white));
  core.add(ring(1.425, 0.9, 0.7, black), ring(1.425, 19.5, 0.9, black));
  core.add(lathe([[1.05, -1.7], [0.55, -0.25], [0.45, 0.05]], nozzle, 32));
  P.plumes.core = makePlume(55, 0.95, 4.5, 1.3); P.plumes.core.position.y = -1.7; core.add(P.plumes.core);
  rocket.add(core); P.core = core;

  // four L40 liquid strap-ons
  for (let k = 0; k < 4; k++) {
    const a = deg(45 + k * 90), g = new THREE.Group();
    g.position.set(Math.cos(a) * 2.55, 0, Math.sin(a) * 2.55);
    g.add(lathe([[0.95, 0.4], [1.05, 1.0], [1.05, 16.9], [0.98, 17.8], [0.7, 18.9], [0.32, 19.6], [0.0, 19.95]], strap));
    g.add(ring(1.075, 9.0, 0.35, black));
    g.add(lathe([[0.78, -1.35], [0.38, -0.1], [0.32, 0.4]], nozzle, 32));
    const pl = makePlume(48, 0.72, 3.8, 2.1 + k); pl.position.y = -1.35; g.add(pl);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1.3), black);
    strut.position.set(-Math.cos(a) * 1.1, 2.2, -Math.sin(a) * 1.1); strut.lookAt(0, 2.2, 0); g.add(strut);
    const strut2 = strut.clone(); strut2.position.y = 16.2; g.add(strut2);
    rocket.add(g); P.boosters.push({ g, a, plume: pl, base: g.position.clone() });
  }

  // upper part: GS2 (Vikas) + cryogenic stage + payload adapter
  const upper = new THREE.Group();
  upper.add(lathe([[1.4, 20], [1.4, 31.5]], upperM));
  upper.add(ring(1.425, 20.5, 1.0, black), ring(1.425, 31.9, 0.8, black));
  upper.add(lathe([[1.4, 31.5], [1.4, 40.2]], clean));
  const vikas = lathe([[0.95, 18.0], [0.42, 19.6], [0.35, 20.0]], nozzle, 32); upper.add(vikas);
  P.plumes.upper = makePlume(70, 0.9, 12, 7.7); P.plumes.upper.position.y = 18.0; upper.add(P.plumes.upper);
  const adapter = lathe([[1.4, 40.2], [0.75, 41.1]], black, 32); upper.add(adapter);
  rocket.add(upper); P.upper = upper;

  // 4 m ogive fairing, two halves hinged at the base
  const prof = [[1.4, 40.2], [2.0, 41.3], [2.0, 46.1], [1.92, 47.2], [1.64, 48.4], [1.16, 49.5], [0.6, 50.3], [0.18, 50.8], [0.0, 50.95]];
  P.fair = [];
  for (const [phi0, sx] of [[0, 1], [Math.PI, -1]]) {
    const hinge = new THREE.Group(); hinge.position.set(2.0 * sx, 41.3, 0);
    const half = lathe(prof, fairM, 48, phi0, Math.PI); half.material = fairM.clone(); half.material.side = THREE.DoubleSide;
    half.position.set(-2.0 * sx, -41.3, 0); hinge.add(half); rocket.add(hinge);
    P.fair.push({ hinge, sx, base: hinge.position.clone() });
  }
  P.satMount = new THREE.Group(); P.satMount.position.set(0.15, 42.15, 0); P.satMount.rotation.z = Math.PI / 2; rocket.add(P.satMount);
  P.group = rocket;
  return P;
}

// ------------------------------------------------------------------ NISAR spacecraft
export function buildNisar(R) {
  const foil = foilTex(R);
  const gold = new THREE.MeshStandardMaterial({ emissive: 0x2a1c05, color: 0xfff0c0, map: foil.map, normalMap: foil.normal, normalScale: new THREE.Vector2(0.7, 0.7), metalness: 1, roughness: 0.3 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9cdd3, metalness: 0.7, roughness: 0.5 });
  const whiteM = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e34, metalness: 0.4, roughness: 0.6 });
  const cells = new THREE.MeshStandardMaterial({ map: cellTex(R), metalness: 0.35, roughness: 0.28 });
  const back = new THREE.MeshStandardMaterial({ color: 0x8d8f92, metalness: 0.5, roughness: 0.6 });
  const g = new THREE.Group();

  const bus = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.5, 1.7), gold); g.add(bus);
  const inst = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 3.3, 8), gold);
  inst.rotation.z = Math.PI / 2; inst.position.set(2.15, 0.12, 0); g.add(inst);
  for (const x of [0.6, 3.75]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.06, 8), silver); cap.rotation.z = Math.PI / 2; cap.position.set(x, 0.12, 0); g.add(cap); }
  const feed = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.14, 1.05), dark); feed.position.set(2.15, 0.88, 0); g.add(feed);
  for (let k = 0; k < 6; k++) { const el = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.9), silver); el.position.set(1.0 + k * 0.46, 0.965, 0); g.add(el); }
  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, 0.45, 32), silver); adapter.position.y = -0.98; g.add(adapter);
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.04), silver); ladder.position.set(1.4, -1.0, 0.9); g.add(ladder);

  // solar wings: accordion of 3 panels each side
  const wings = [];
  for (const side of [1, -1]) {
    const yoke = new THREE.Group(); yoke.position.set(-0.2, 0.1, side * 0.86); g.add(yoke);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.2, 8), silver);
    rod.rotation.x = Math.PI / 2; rod.position.z = side * 0.6; yoke.add(rod);
    const qStow = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(0, 1, 0), V3(0, 0, side), V3(side, 0, 0)));
    let parent = yoke, z0 = side * 1.2; const hinges = [];
    for (let k = 0; k < 3; k++) {
      const hg = new THREE.Group(); hg.position.z = z0; parent.add(hg);
      const front = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.035, 2.3), [back, back, cells, cells, back, back]);
      front.position.z = side * 1.15; hg.add(front);
      hinges.push(hg); parent = hg; z0 = side * 2.32;
    }
    wings.push({ yoke, hinges, side, qStow, qOpen: new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), -0.75) });
  }

  // 9 m boom with an elbow, then the 12 m mesh reflector
  const root = new THREE.Group(); root.position.set(3.7, 0.98, 0); g.add(root);
  const tube = (L) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, L, 10), whiteM); m.position.y = L / 2; return m; };
  root.add(tube(4.5));
  const elbow = new THREE.Group(); elbow.position.y = 4.5; root.add(elbow);
  elbow.add(tube(4.5));
  const hingeBall = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), silver); elbow.add(hingeBall);
  const tip = new THREE.Group(); tip.position.y = 4.5; elbow.add(tip);
  const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 12), whiteM); gps.position.set(0, 0.1, 0.25); tip.add(gps);

  const refl = new THREE.Group(); tip.add(refl);
  const F = 8.5, RD = 6.0, pts = [];
  for (let i = 0; i <= 24; i++) { const r = RD * i / 24; pts.push(new THREE.Vector2(r, r * r / (4 * F))); }
  const meshMat = new THREE.MeshStandardMaterial({
    color: 0xe7c27a, metalness: 0.85, roughness: 0.42, alphaMap: meshAlphaTex(), transparent: true,
    opacity: 0.95, side: THREE.DoubleSide, depthWrite: false,
  });
  const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), meshMat); dish.renderOrder = 2; refl.add(dish);
  const rimY = RD * RD / (4 * F), H = 0.85, bays = 32;
  const truss = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), silver, bays * 2);
  const m4 = new THREE.Matrix4(), up = V3(0, 1, 0);
  const beam = (i, a, b) => { const d = b.clone().sub(a), L = d.length(); m4.compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), V3(1, L, 1)); truss.setMatrixAt(i, m4); };
  for (let k = 0; k < bays; k++) {
    const a0 = k / bays * Math.PI * 2, a1 = (k + 1) / bays * Math.PI * 2;
    const p0 = V3(Math.cos(a0) * RD, rimY, Math.sin(a0) * RD), p1 = V3(Math.cos(a1) * RD, rimY + H, Math.sin(a1) * RD);
    beam(k * 2, p0, V3(p0.x, rimY + H, p0.z)); beam(k * 2 + 1, p0, p1);
  }
  refl.add(truss);
  for (const y of [rimY, rimY + H]) { const t = new THREE.Mesh(new THREE.TorusGeometry(RD, 0.04, 6, 96), silver); t.rotation.x = Math.PI / 2; t.position.y = y; refl.add(t); }
  const cordPts = [];
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; for (let i = 0; i < 12; i++) { const r0 = RD * i / 12, r1 = RD * (i + 1) / 12; cordPts.push(V3(Math.cos(a) * r0, r0 * r0 / (4 * F) + 0.01, Math.sin(a) * r0), V3(Math.cos(a) * r1, r1 * r1 / (4 * F) + 0.01, Math.sin(a) * r1)); } }
  refl.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cordPts), new THREE.LineBasicMaterial({ color: 0xc9cdd3, transparent: true, opacity: 0.55 })));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 0.5, 16), silver); hub.position.y = 0.1; refl.add(hub);

  // final boom pose: root tilted toward the upper left; reflector faces the feed
  const ROOT_OPEN = 0.5, ROOT_FOLD = Math.PI / 2 + 0.02, ELBOW_FOLD = Math.PI - 0.04;
  root.rotation.z = ROOT_OPEN; elbow.rotation.z = 0; g.updateMatrixWorld(true);
  const tipW = tip.getWorldPosition(V3()), feedW = feed.getWorldPosition(V3());
  const look = feedW.clone().sub(tipW).normalize().lerp(V3(0, -1, 0), 0.35).normalize();
  const qOpen = tip.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(up, look));
  root.rotation.z = ROOT_FOLD; elbow.rotation.z = ELBOW_FOLD; g.updateMatrixWorld(true);
  const qStowR = tip.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(up, V3(1, 0, 0)));
  const QI = new THREE.Quaternion();

  function set(s, e, o) {
    const f = sstep(0, 0.45, s), g2 = sstep(0.35, 1, s);
    for (const w of wings) {
      w.yoke.quaternion.copy(w.qStow).slerp(w.qOpen, f);
      w.hinges[1].rotation.x = Math.PI * 0.995 * (1 - g2);
      w.hinges[2].rotation.x = -Math.PI * 0.995 * (1 - g2);
      w.hinges[1].position.y = w.hinges[2].position.y = 0.04 * (1 - g2);
    }
    root.rotation.z = lerp(ROOT_FOLD, ROOT_OPEN, sstep(0, 0.55, e));
    elbow.rotation.z = lerp(ELBOW_FOLD, 0, sstep(0.35, 1, e));
    refl.quaternion.copy(qStowR).slerp(qOpen, sstep(0.1, 0.9, e));
    const oo = Math.pow(o, 0.8);
    refl.scale.set(lerp(0.09, 1, oo), lerp(1.2, 1, o), lerp(0.09, 1, oo));
    meshMat.opacity = lerp(0.5, 0.95, o);
  }
  set(0, 0, 0);
  g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { group: g, set };
}

// ------------------------------------------------------------------ launch pad (Sriharikota-like)
function beamMesh(defs, mat) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, defs.length);
  const m4 = new THREE.Matrix4(), up = V3(0, 1, 0);
  defs.forEach(([a, b, t], i) => { const d = b.clone().sub(a), L = d.length(); m4.compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), V3(t, L, t)); im.setMatrixAt(i, m4); });
  im.castShadow = im.receiveShadow = true; return im;
}
function buildPad(R) {
  const g = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), new THREE.MeshStandardMaterial({ map: groundTex(R), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.receiveShadow = true; g.add(ground);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(150, 2, 150), new THREE.MeshStandardMaterial({ map: concreteTex(R), roughness: 0.92 }));
  pad.position.y = -1; pad.receiveShadow = true; g.add(pad);
  const steel = new THREE.MeshStandardMaterial({ color: 0x5f7477, roughness: 0.55, metalness: 0.5 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.7, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x6c7173, roughness: 0.6, metalness: 0.5 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8e8d88, roughness: 0.85 });
  // launch table: a frame around the flame hole, so the engines fire down into the trench
  for (const [w, d, x, z] of [[11, 2.3, 0, 4.35], [11, 2.3, 0, -4.35], [2.3, 6.4, 4.35, 0], [2.3, 6.4, -4.35, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), grey); b.position.set(x, 0.5, z); b.castShadow = b.receiveShadow = true; g.add(b);
  }
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1 }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.03; g.add(scorch);
  for (const [x, z] of [[1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]) {           // hold-down posts under the strap-ons
    for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.35), grey); post.position.set(x + s * Math.sign(x) * 1.15, 1.3, z); post.castShadow = true; g.add(post); }
  }
  for (const s of [1, -1]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 26), new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 1 })); tr.position.set(0, 0.02, s * 19); g.add(tr); }

  // umbilical tower: steel lattice 9 x 9 m, 78 m tall, red service platforms
  const x0 = -17.5, x1 = -8.5, z0 = -4.5, z1 = 4.5, H = 78, defs = [];
  const cs = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (const [x, z] of cs) defs.push([V3(x, 0, z), V3(x, H, z), 0.55]);
  for (let y = 0; y <= H; y += 4) {
    for (let k = 0; k < 4; k++) { const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4]; defs.push([V3(ax, y, az), V3(bx, y, bz), 0.3]); }
    if (y + 4 <= H) for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4], f = (y / 4) % 2;
      defs.push([V3(ax, y + 4 * f, az), V3(bx, y + 4 * (1 - f), bz), 0.18]);
    }
  }
  defs.push([V3(x0 - 2, H + 1, 0), V3(x1 + 8, H + 1, 0), 0.6], [V3(x0, H, 0), V3(x0, H + 9, 0), 0.25]);
  g.add(beamMesh(defs, steel));
  const arms = [];
  for (const y of [18, 31, 41, 47]) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 9.6), red); deck.position.set((x0 + x1) / 2, y, 0); deck.castShadow = true; g.add(deck);
    const piv = new THREE.Group(); piv.position.set(x1, y, 3.6); g.add(piv);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.1, 1.6), accent); arm.position.set(2.5, 0, -3.6); arm.castShadow = true; piv.add(arm);
    arms.push(piv);
  }
  // lightning masts and a few buildings for scale
  for (const [x, z] of [[62, 62], [-62, 62], [62, -62], [-62, -62]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 118, 8), grey); m.position.set(x, 59, z); m.castShadow = true; g.add(m);
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 3, 8), k % 2 ? new THREE.MeshStandardMaterial({ color: 0xf1f1ee }) : accent); b.position.set(x, 104 + k * 3, z); g.add(b); }
  }
  const bld = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const a = R() * 6.28, d = 260 + R() * 600, w = 15 + R() * 40, h = 8 + R() * 30;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 12 + R() * 30), bld); b.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d - 200); g.add(b);
  }
  const vab = new THREE.Mesh(new THREE.BoxGeometry(40, 82, 32), bld); vab.position.set(-330, 41, -520); g.add(vab);
  return { group: g, arms };
}

// ------------------------------------------------------------------ ascent sky (shot B) and contrail
const DOME_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const DOME_FS = `uniform float space; varying vec3 vW;
void main(){ vec3 d = normalize(vW - cameraPosition); float e = clamp(d.y, 0.0, 1.0);
  vec3 hor = mix(vec3(0.58,0.74,0.93), vec3(0.05,0.11,0.26), space);
  vec3 zen = mix(vec3(0.16,0.38,0.78), vec3(0.0,0.004,0.016), space);
  gl_FragColor = vec4(mix(hor, zen, pow(e, 0.42)) * 1.9, 1.0); }`;
const TRAIL_VS = `attribute float along; varying vec3 vN; varying vec3 vW; varying float vU;
void main(){ vU = along; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`;
const TRAIL_FS = `uniform vec3 sunDir; uniform float opacity; varying vec3 vN; varying vec3 vW; varying float vU;
void main(){ vec3 V = normalize(cameraPosition - vW); float f = abs(dot(normalize(vN), V));
  float a = pow(f, 1.7) * opacity * smoothstep(0.0, 0.25, vU) * (0.55 + 0.45 * vU);
  float l = dot(normalize(vN), sunDir) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.5,0.5,0.52), vec3(1.15,1.12,1.08), l);
  col = mix(col, vec3(2.4,1.3,0.6), smoothstep(0.965, 1.0, vU));
  gl_FragColor = vec4(col, a); }`;
class Trail {
  constructor(rings = 64, seg = 16, sunDir) {
    Object.assign(this, { rings, seg });
    const n = rings * seg, geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3); const al = new Float32Array(n), idx = [];
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      al[i * seg + j] = i / (rings - 1);
      if (i < rings - 1) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg; idx.push(a, b, c, b, d, c); }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(this.nor, 3));
    geo.setAttribute("along", new THREE.BufferAttribute(al, 1)); geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sunDir }, opacity: { value: 0.85 } },
      vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }
  update(path, h0, h1) {
    const t = V3(), n1 = V3(), n2 = V3(), p = V3(), q = V3();
    for (let i = 0; i < this.rings; i++) {
      const u = i / (this.rings - 1), h = lerp(h0, h1, Math.pow(u, 0.7));
      path(h, p); path(h + 5, q); t.subVectors(q, p).normalize();
      n1.set(0, 0, 1).cross(t).normalize(); n2.crossVectors(t, n1);
      const r = 3.5 + (h1 - h) * 0.018 + Math.max(0, 300 - h) * 0.25;
      for (let j = 0; j < this.seg; j++) {
        const a = j / this.seg * Math.PI * 2, cx = Math.cos(a), sx = Math.sin(a), k = (i * this.seg + j) * 3;
        const nx = n1.x * cx + n2.x * sx, ny = n1.y * cx + n2.y * sx, nz = n1.z * cx + n2.z * sx;
        this.pos[k] = p.x + nx * r; this.pos[k + 1] = p.y + ny * r; this.pos[k + 2] = p.z + nz * r;
        this.nor[k] = nx; this.nor[k + 1] = ny; this.nor[k + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ Earth
const EARTH_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`;
const EARTH_FS = `uniform sampler2D day; uniform sampler2D night; uniform sampler2D water; uniform sampler2D relief; uniform vec3 sunDir; uniform vec3 axis;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vec3 N0 = normalize(vN), V = normalize(cameraPosition - vW);
  vec3 E = normalize(cross(axis, N0) + 1e-5), Nn = cross(N0, E);
  vec3 rn = texture2D(relief, vUv).xyz * 2.0 - 1.0;
  vec3 N = normalize(N0 + (rn.x * E + rn.y * Nn) * 0.55);
  float NL = dot(N, sunDir), lit = smoothstep(-0.12, 0.28, NL);
  vec3 d = texture2D(day, vUv).rgb, n = texture2D(night, vUv).rgb; float w = texture2D(water, vUv).r;
  vec3 col = d * (0.012 + 1.05 * max(NL, 0.0));
  col += n * vec3(1.0, 0.78, 0.45) * 1.6 * (1.0 - lit);
  vec3 H = normalize(sunDir + V); col += vec3(1.0, 0.92, 0.78) * pow(max(dot(N, H), 0.0), 60.0) * w * 0.9 * lit;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 sky = mix(vec3(0.9,0.45,0.2), vec3(0.32,0.56,1.0), smoothstep(-0.05, 0.3, NL));
  col = mix(col, sky * 0.9 * smoothstep(-0.2, 0.25, NL), rim * 0.5);
  gl_FragColor = vec4(col, 1.0); }`;
const CLOUD_FS = `uniform sampler2D clouds; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vec3 N = normalize(vN); float NL = dot(N, sunDir);
  float c = texture2D(clouds, vUv).r; float lit = smoothstep(-0.1, 0.3, NL);
  vec3 col = mix(vec3(1.0,0.62,0.4), vec3(1.0), smoothstep(0.0, 0.35, NL)) * (0.02 + 1.0 * max(NL, 0.0));
  gl_FragColor = vec4(col, c * c * (0.25 + 0.75 * lit) * 0.85); }`;
const ATMO_VS = `varying vec3 vNv; varying vec3 vP; varying vec3 vNw;
void main(){ vNw = normalize(mat3(modelMatrix)*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vP = mv.xyz; vNv = normalize(normalMatrix*normal); gl_Position = projectionMatrix*mv; }`;
const ATMO_FS = `uniform vec3 sunDir; varying vec3 vNv; varying vec3 vP; varying vec3 vNw;
void main(){ float d = dot(normalize(vNv), normalize(-vP)); float i = pow(max(0.6 + d, 0.0), 12.0) * 1.6;
  float day = smoothstep(-0.35, 0.35, dot(normalize(vNw), sunDir));
  vec3 col = mix(vec3(1.0,0.45,0.18), vec3(0.3,0.58,1.0), smoothstep(-0.1, 0.5, dot(normalize(vNw), sunDir)));
  gl_FragColor = vec4(col * i * day * 2.2, 1.0); }`;
function latLonDir(lat, lon) { const a = deg(lat), b = deg(lon); return V3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)); }
function earthQuat(lat, lon, heading = 0) {
  const P = latLonDir(lat, lon), Np = V3(0, 1, 0), E = Np.clone().cross(P).normalize(), N = P.clone().cross(E).normalize();
  const M = new THREE.Matrix4().makeBasis(E, P, N.clone().negate()).transpose();
  const q = new THREE.Quaternion().setFromRotationMatrix(M);
  return new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), heading).multiply(q);
}
function buildEarth(tx, sunDir) {
  const g = new THREE.Group();
  const sphere = (r, seg = 160) => new THREE.SphereGeometry(r, seg, seg / 2);
  const earth = new THREE.Mesh(sphere(R_E, 256), new THREE.ShaderMaterial({ uniforms: { day: { value: tx.day }, night: { value: tx.night }, water: { value: tx.water }, relief: { value: tx.relief }, sunDir: { value: sunDir }, axis: { value: V3(0, 1, 0) } }, vertexShader: EARTH_VS, fragmentShader: EARTH_FS }));
  const clouds = new THREE.Mesh(sphere(R_E + 9000), new THREE.ShaderMaterial({ uniforms: { clouds: { value: tx.clouds }, sunDir: { value: sunDir } }, vertexShader: EARTH_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false }));
  const atmo = new THREE.Mesh(sphere(R_E * 1.022, 128), new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sunDir } }, vertexShader: ATMO_VS, fragmentShader: ATMO_FS, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  g.add(earth, clouds, atmo);
  return { group: g, clouds, mat: earth.material };
}
function buildStars(R, radius, count) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * radius, u * radius, Math.sin(a) * s * radius], i * 3);
    const b = Math.pow(R(), 6) * 2.4 + 0.12, w = R();
    col.set([b * (w < 0.2 ? 0.8 : 1), b * (w < 0.2 ? 0.88 : w > 0.85 ? 0.9 : 1), b * (w > 0.85 ? 0.75 : 1)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
  const p = new THREE.Points(geo, mat); p.frustumCulled = false; return p;
}


// ------------------------------------------------------------------ deep sky: Milky Way, Moon, planets, meteors
function noise2(seed) {
  const P = new Uint8Array(512), R = rng(seed);
  const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (R() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
  const f = t => t * t * (3 - 2 * t);
  const n = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const a = P[P[X] + Y] / 255, b = P[P[X + 1] + Y] / 255, c = P[P[X] + Y + 1] / 255, d = P[P[X + 1] + Y + 1] / 255, u = f(xf), v = f(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
  return (x, y, oct = 5) => { let s = 0, a = 0.5, fr = 1; for (let o = 0; o < oct; o++) { s += a * n(x * fr, y * fr); a *= 0.5; fr *= 2.03; } return s; };
}
function milkyWayTex(nrm, centre) {
  const W = 1024, H = 512, [c, g] = cnv(W, H), img = g.createImageData(W, H), R = rng(77), fbm = noise2(5), fbm2 = noise2(9);
  const n = nrm.clone().normalize(), e1 = centre.clone().sub(n.clone().multiplyScalar(centre.dot(n))).normalize(), e2 = n.clone().cross(e1);
  for (let j = 0; j < H; j++) {
    const lat = Math.PI / 2 - Math.PI * (j + 0.5) / H, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lon = 2 * Math.PI * (i + 0.5) / W - Math.PI, x = cl * Math.cos(lon), y = sl, z = -cl * Math.sin(lon);
      const b = Math.asin(clamp(x * n.x + y * n.y + z * n.z, -1, 1)), l = Math.atan2(x * e2.x + y * e2.y + z * e2.z, x * e1.x + y * e1.y + z * e1.z);
      const core = Math.exp(-(l * l) / 0.55), wid = 0.11 + 0.1 * core;
      let dens = Math.exp(-(b * b) / (wid * wid)) * (0.35 + 0.9 * fbm(l * 4 + 9, b * 14 + 3)) * (0.55 + 1.6 * core);
      const dust = Math.exp(-Math.pow((b + 0.012 * Math.sin(l * 5)) / (0.03 + 0.02 * core), 2)) * Math.pow(fbm2(l * 7, b * 30), 1.4) * 1.7;
      dens = Math.max(0, dens * (1 - Math.min(0.92, dust)));
      const neb = Math.pow(Math.max(0, fbm2(l * 2.2 + 4, b * 5) - 0.55), 2) * 3 * Math.exp(-(b * b) / 0.08);
      const k = (j * W + i) * 4, w = 0.6 + 0.4 * core;
      img.data[k] = clamp(dens * (150 * w + 60) + neb * 120, 0, 255);
      img.data[k + 1] = clamp(dens * (138 * w + 70) + neb * 40, 0, 255);
      img.data[k + 2] = clamp(dens * (118 * w + 95) + neb * 70, 0, 255);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}
function moonTex(R) {
  const W = 1024, H = 512, [c, g] = cnv(W, H), fbm = noise2(21), img = g.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const v = 0.55 + 0.25 * fbm(i / 90, j / 90) - 0.32 * Math.max(0, fbm(i / 220 + 3, j / 220 + 7) - 0.52) * 3.2, k = (j * W + i) * 4;
    img.data[k] = img.data[k + 1] = clamp(v * 205, 0, 255); img.data[k + 2] = clamp(v * 198, 0, 255); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 700; i++) {
    const x = R() * W, y = H * 0.1 + R() * H * 0.8, r = Math.pow(R(), 3) * 26 + 1.5;
    g.fillStyle = `rgba(40,38,36,${0.18 + R() * 0.2})`; g.beginPath(); g.ellipse(x, y, r, r * 0.92, 0, 0, 7); g.fill();
    g.strokeStyle = `rgba(255,252,245,${0.18 + R() * 0.2})`; g.lineWidth = Math.max(1, r * 0.18); g.beginPath(); g.arc(x - r * 0.08, y - r * 0.08, r, 3.6, 6.1); g.stroke();
  }
  return tex(c);
}
const METEOR_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const METEOR_FS = `uniform float a; uniform float hue; varying vec2 vUv;
void main(){ float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0;
  float body = pow(x, 2.6) * pow(1.0 - y, 2.5);
  float head = exp(-(1.0 - x) * 38.0) * exp(-y * y * 3.0);
  vec3 col = mix(vec3(0.45, 1.0, 0.7), vec3(1.0, 0.75, 0.45), hue);
  col = mix(col, vec3(1.0, 0.98, 0.92), smoothstep(0.75, 1.0, x));
  gl_FragColor = vec4(col * (body * 1.6 + head * 4.0) * a, 1.0); }`;
class Meteors {
  constructor(n = 4) {
    this.list = [];
    this.group = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0), new THREE.ShaderMaterial({ uniforms: { a: { value: 0 }, hue: { value: 0 } },
        vertexShader: METEOR_VS, fragmentShader: METEOR_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; m.renderOrder = 20; m.visible = false; this.group.add(m);
      this.list.push({ m, age: 1e9, life: 1, x: 0, y: 0, vx: 0, vy: 0, len: 0 });
    }
    this.next = 1.2; this.R = rng(1234);
  }
  update(dt, cam, active) {
    const R = this.R;
    this.next -= dt;
    if (active && this.next <= 0) {
      this.next = 1.6 + R() * 3.4;
      const f = this.list.find(q => q.age > q.life);
      if (f) {
        const ang = deg(200 + R() * 60) * (R() < 0.5 ? 1 : -1), sp = 0.35 + R() * 0.5;
        Object.assign(f, { age: 0, life: 0.45 + R() * 0.7, x: (R() - 0.3) * 1.6, y: 0.1 + R() * 0.8, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6 - 0.15, len: 0.07 + R() * 0.12 });
        f.m.material.uniforms.hue.value = R();
      }
    }
    const D = 5e6, h = 2 * D * Math.tan(deg(cam.fov) / 2), q = cam.quaternion;
    for (const f of this.list) {
      f.age += dt;
      if (f.age > f.life) { f.m.visible = false; continue; }
      const px = f.x + f.vx * f.age, py = f.y + f.vy * f.age, k = f.age / f.life;
      f.m.visible = true;
      f.m.material.uniforms.a.value = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 0.9;
      f.m.position.set(px * h * 0.5 * cam.aspect, py * h * 0.5, -D).applyQuaternion(q).add(cam.position);
      f.m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), Math.atan2(f.vy, f.vx)));
      f.m.scale.set(f.len * h * (0.4 + 0.6 * Math.min(1, k * 3)), h * 0.0022, 1);
    }
  }
}


// ------------------------------------------------------------------ galaxy sky, computed per pixel (sharp at any screen resolution)
const GALAXY_VS = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const GALAXY_FS = `uniform vec3 gN; uniform vec3 gE1; uniform vec3 gE2; uniform float time; uniform float bright; uniform samplerCube neb; varying vec3 vDir;
float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
vec3 starLayer(vec3 d, float scale, float thr, float px){
  vec3 p = d * scale, c = floor(p); float h = h3(c);
  if (h < thr) return vec3(0.0);
  vec3 o = vec3(h3(c + 1.3), h3(c + 2.7), h3(c + 5.1));
  vec3 sp = normalize((c + o) / scale);                       // star position on the sphere
  float r = length(d - sp) / px;                               // distance in pixels
  float m = pow((h - thr) / (1.0 - thr), 3.5);
  float tw = 0.85 + 0.15 * sin(time * (1.5 + h * 3.0) + h * 40.0);
  float t = h3(c + 9.9);
  vec3 col = t < 0.15 ? vec3(0.62, 0.74, 1.0) : (t > 0.85 ? vec3(1.0, 0.78, 0.55) : vec3(1.0, 0.96, 0.9));
  return col * m * tw * (exp(-r * r * 0.9) * 2.2 + exp(-r * 0.7) * 0.06 * m);
}
void main(){
  vec3 d = normalize(vDir);
  float px = length(fwidth(d)) * 0.75 + 1e-6;
  float b = asin(clamp(dot(d, gN), -1.0, 1.0)), l = atan(dot(d, gE2), dot(d, gE1));
  float core = exp(-l * l / 0.12);
  float w = 0.075 + 0.07 * core;
  float band = exp(-(b * b) / (w * w));
  float halo = exp(-(b * b) / (w * w * 7.0)) * 0.22;
#ifdef BAKE
  float big = fbm(d * 2.6 + 3.0), fine = fbm(d * 11.0);
  float clump = smoothstep(0.35, 0.75, fine);
  float dens = (band * (0.15 + 1.4 * big * clump + 0.5 * clump * clump) + halo * big * 0.8) * (0.55 + 1.6 * core);
  float lane = exp(-pow((b + 0.018 * sin(l * 4.0)) / (0.03 + 0.035 * core), 2.0)) * smoothstep(0.42, 0.72, fbm(d * 6.0 + 11.0));
  float lane2 = band * smoothstep(0.55, 0.8, fbm(d * 14.0 + 4.0)) * 0.55;
  dens *= 1.0 - min(0.8, lane * 1.1 + lane2);
  vec3 blue = vec3(0.36, 0.42, 0.95), violet = vec3(0.55, 0.4, 0.9), warm = vec3(1.0, 0.76, 0.52);
  vec3 col = mix(mix(blue, violet, fbm(d * 3.0 + 20.0)), warm, clamp(core * 0.75 * clump, 0.0, 1.0)) * dens;
  float neb = smoothstep(0.6, 0.86, fbm(d * 4.5 + 7.0)) * band;
  col += vec3(0.85, 0.22, 0.42) * neb * 0.35 + vec3(0.25, 0.55, 0.9) * smoothstep(0.65, 0.9, fbm(d * 3.5 + 31.0)) * band * 0.18;
  gl_FragColor = vec4(col * 0.24, 1.0 - min(0.85, lane * 1.1));
#else
  vec4 nb = textureCube(neb, d);
  vec3 col = nb.rgb * bright;
  float sb = 0.03 * band + 0.008 * halo, dim = nb.a;
  col += starLayer(d, 1100.0, 0.968 - sb, px) * 0.42 * dim;
  col += starLayer(d, 480.0, 0.984 - sb * 0.4, px) * 0.75 * dim;
  col += starLayer(d, 160.0, 0.991, px) * 1.5;
  gl_FragColor = vec4(col, 1.0);
#endif
}`;
function buildGalaxy(nrm, centre, renderer, size = 512) {
  const n = nrm.clone().normalize(), e1 = centre.clone().sub(n.clone().multiplyScalar(centre.dot(n))).normalize(), e2 = n.clone().cross(e1);
  const U = () => ({ gN: { value: n }, gE1: { value: e1 }, gE2: { value: e2 }, time: { value: 0 }, bright: { value: 1 }, neb: { value: null } });
  // one-off bake of the nebula (rgb) and its dust lanes (a) into a cube map
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const bakeScene = new THREE.Scene();
  const bakeMat = new THREE.ShaderMaterial({ uniforms: U(), vertexShader: GALAXY_VS, fragmentShader: GALAXY_FS, side: THREE.BackSide, depthWrite: false, defines: { BAKE: 1 } });
  const bakeMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), bakeMat); bakeScene.add(bakeMesh);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  new THREE.CubeCamera(0.1, 10, rt).update(renderer, bakeScene);
  renderer.toneMapping = tm; bakeMesh.geometry.dispose(); bakeMat.dispose();
  const uniforms = U(); uniforms.neb.value = rt.texture;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: GALAXY_VS, fragmentShader: GALAXY_FS, side: THREE.BackSide, depthWrite: false });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.1e8, 64, 32), mat); m.renderOrder = -2; m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------ cinematic finish: grade, vignette, grain, aberration, letterbox
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.045 }, vig: { value: 0.42 }, ab: { value: 0.0016 },
    bars: { value: 0 }, fade: { value: 1 }, aspect: { value: 1.7 }, warm: { value: 0 }, haze: { value: 0 }, flash: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time, grain, vig, ab, bars, fade, aspect, warm, haze, flash; varying vec2 vUv;
  float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){ vec2 d = vUv - 0.5; float r2 = dot(d * vec2(aspect, 1.0), d * vec2(aspect, 1.0));
    vec2 o = d * ab * (1.0 + r2 * 3.0);
    // heat shimmer above the exhaust: small, fast ripples in the lower part of the frame
    float hm = haze * smoothstep(0.62, 0.12, vUv.y);
    vec2 uv = vUv + hm * vec2(sin(vUv.y * 160.0 + time * 23.0) * sin(vUv.x * 37.0 + time * 7.0), sin(vUv.x * 130.0 - time * 19.0)) * vec2(0.0016, 0.0011);
    vec3 c = vec3(texture2D(tDiffuse, uv + o).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - o).b);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, c * vec3(0.9, 1.0, 1.08), (1.0 - l) * 0.4);                   // cool shadows
    c = mix(c, c * vec3(1.07, 1.0, 0.9), smoothstep(0.35, 1.0, l) * (0.3 + warm * 0.4)); // warm highlights
    c = (c - 0.5) * 1.06 + 0.5; c = mix(vec3(l), c, 1.06);
    c *= mix(1.0, smoothstep(1.05, 0.2, sqrt(r2)), vig);
    c += (rnd(vUv * vec2(1931.0, 1087.0) + fract(time * 7.13)) - 0.5) * grain;
    float b = step(vUv.y, bars) + step(1.0 - bars, vUv.y);
    c = mix(c, vec3(1.0, 0.97, 0.92), flash) + flash * 0.25;
    gl_FragColor = vec4(mix(c * fade, vec3(0.0), clamp(b, 0.0, 1.0)), 1.0); }`,
};


// ------------------------------------------------------------------ launch-site atmosphere: cumulus deck and tree line
const DECK_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const DECK_FS = `uniform vec3 sunDir; uniform float time; uniform float fade; varying vec3 vW;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec2 p = vW.xz / 2600.0 + vec2(time * 0.004, 0.0);
  float c = fbm(p), d = fbm(p * 2.7 + 4.0);
  float cov = smoothstep(0.52, 0.72, c * 0.75 + d * 0.35);
  float thick = smoothstep(0.55, 0.85, c * 0.75 + d * 0.35);
  float dist = length(vW.xz - cameraPosition.xz);
  float a = cov * (1.0 - smoothstep(18000.0, 42000.0, dist)) * fade;
  vec3 lit = vec3(1.0, 0.98, 0.95) * 1.25, shade = vec3(0.55, 0.6, 0.68);
  vec3 col = mix(lit, shade, thick * 0.55 * (1.0 - max(sunDir.y, 0.0) * 0.3));
  gl_FragColor = vec4(col, a * 0.92); }`;
function treeLineTex(R) {
  const W = 2048, H = 128, [c, g] = cnv(W, H);
  g.fillStyle = "rgba(0,0,0,0)"; g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 2 + R() * 5) {
    const h = 40 + R() * 70, w = 6 + R() * 18, t = R();
    g.fillStyle = t < 0.25 ? "#2f3a24" : t < 0.6 ? "#3a4a2c" : "#46542f";
    g.beginPath(); g.ellipse(x, H - h * 0.55, w, h * 0.55, 0, 0, 7); g.fill();
    if (R() < 0.12) { g.fillRect(x - 1, H - h - 26, 2, h); g.beginPath(); g.ellipse(x, H - h - 26, 14, 6, 0, 0, 7); g.fill(); }   // palms
  }
  g.fillStyle = "#3a4529"; g.fillRect(0, H - 22, W, 22);
  const t = tex(c); t.wrapS = THREE.RepeatWrapping; t.repeat.set(10, 1); return t;
}

// ------------------------------------------------------------------ main
export async function createIntro({ canvas, lang = "fr", onCaption = () => {}, onReveal = () => {}, onSlow = () => {}, quality = 1 }) {
  const R = rng(20250730);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  // quality tier: integrated / mobile / software GPUs, small memory or few cores get the light version
  const gl = renderer.getContext(), dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const weak = /intel|uhd|iris|hd graphics|mali|adreno|powervr|apple gpu|swiftshader|llvmpipe|basic render|vivante|videocore/i.test(gpu)
    || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const tier = quality >= 1 && !weak ? 1 : 0;
  const small = innerWidth * innerHeight < 520000;                       // phones: few pixels, so render them sharper
  const DPR = tier ? Math.min(window.devicePixelRatio || 1, 1.25) : small ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = tier === 1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const loader = new THREE.TextureLoader();
  const base = new URL("./textures/", import.meta.url).href;
  const load = (n, srgb) => new Promise(res => loader.load(base + n, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; res(t); }, undefined, () => res(null)));
  const [day, night, water, clouds, relief] = await Promise.all([load("earth_day.jpg", true), load("earth_night.jpg", true), load("earth_water.jpg"), load("clouds.jpg"), load("earth_normal.jpg")]);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600000);
  const bgCam = new THREE.PerspectiveCamera(38, 1, 2e4, 1.2e8);

  // ----- ground scene
  const ground = new THREE.Scene();
  const sunG = V3().setFromSphericalCoords(1, deg(90 - 15), deg(-24));
  const sky = new Sky(); sky.scale.setScalar(450000);
  Object.assign(sky.material.uniforms, {}); const su = sky.material.uniforms;
  su.turbidity.value = 6.5; su.rayleigh.value = 2.1; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.86; su.sunPosition.value.copy(sunG);
  ground.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const skyEnvScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
  for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) sky2.material.uniforms[k].value = su[k].value;
  sky2.material.uniforms.sunPosition.value.copy(sunG); skyEnvScene.add(sky2);
  ground.environment = pm.fromScene(skyEnvScene, 0.02, 1, 2000).texture;
  ground.environmentIntensity = 0.55;
  const sunLight = new THREE.DirectionalLight(0xffd6a8, 3.6); sunLight.position.copy(sunG).multiplyScalar(400);
  sunLight.castShadow = tier === 1; sunLight.shadow.mapSize.set(1536, 1536);
  Object.assign(sunLight.shadow.camera, { left: -90, right: 90, top: 120, bottom: -40, near: 50, far: 1200 }); sunLight.shadow.bias = -0.0004;
  ground.add(sunLight, sunLight.target, new THREE.HemisphereLight(0xb9cbe6, 0x6e5e48, 0.75));
  const pad = buildPad(R); ground.add(pad.group);
  const clouds3 = new THREE.Mesh(new THREE.PlaneGeometry(120000, 120000).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunG }, time: { value: 0 }, fade: { value: 1 } }, vertexShader: DECK_VS, fragmentShader: DECK_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  clouds3.position.y = 2600; clouds3.frustumCulled = false; ground.add(clouds3);
  const trees = new THREE.Mesh(new THREE.CylinderGeometry(1700, 1700, 42, 96, 1, true), new THREE.MeshStandardMaterial({ map: treeLineTex(R), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1 }));
  trees.position.y = 20; ground.add(trees);
  const fireLight = new THREE.PointLight(0xff8a3c, 0, 260, 1.6); ground.add(fireLight);
  const holeGlow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: (() => { const [c, g] = cnv(128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,240,210,1)"); gr.addColorStop(0.35, "rgba(255,170,80,.75)"); gr.addColorStop(1, "rgba(255,120,40,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c); })(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
  holeGlow.position.y = 1.04; ground.add(holeGlow);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400000, 32, 16), new THREE.ShaderMaterial({ uniforms: { space: { value: 0 } }, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false }));
  dome.visible = false; ground.add(dome);
  const starsG = buildStars(R, 350000, 2500); starsG.material.opacity = 0; ground.add(starsG);
  const trail = new Trail(64, 16, sunG); trail.mesh.visible = false; ground.add(trail.mesh);
  const puff = puffTex(R);
  const puffBig = puffTex(rng(99));
  const cloudLayer = new THREE.Group(); cloudLayer.visible = false; ground.add(cloudLayer);
  for (let i = 0; i < 0; i++) {                                       // (cloud deck disabled: sprites read as smudges) the rocket climbs through
    const h = 1650 + R() * 1900, side = (R() - 0.5) * 2;
    const toCam = V3(3600, 0, 5200).normalize(), across = V3(-toCam.z, 0, toCam.x);
    const p = V3(-(h * h) / 95000, h, -(h * h) / 260000).addScaledVector(across, side * 260).addScaledVector(toCam, (R() - 0.35) * 700);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: R() < 0.5 ? puff : puffBig, color: new THREE.Color().setScalar(0.86 + R() * 0.16), transparent: true, opacity: 0.75 + R() * 0.25, depthWrite: false, fog: false }));
    sp.position.copy(p); const w = 70 + R() * 190; sp.scale.set(w, w * (0.45 + R() * 0.3), 1); sp.material.rotation = (R() - 0.5) * 0.5; cloudLayer.add(sp);
  }  const SM = tier ? 1 : 0.45;                                          // smoke budget
  const smoke = new Smoke(tier ? 3200 : 1400, puff, { ground: 0.6, drag: 0.5, buoy: 1.8, lit: 0xf7f3ec, shade: 0x7b746b, maxA: 1 }); ground.add(smoke.points);

  const rk = buildRocket(R); ground.add(rk.group);
  const sat = buildNisar(R); rk.satMount.add(sat.group);
  // incandescent flame at each nozzle exit (what the eye actually sees at ignition)
  const flameTex = (() => { const [c, g] = cnv(128); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,245,1)"); gr.addColorStop(0.18, "rgba(255,236,190,.95)"); gr.addColorStop(0.45, "rgba(255,160,70,.45)"); gr.addColorStop(1, "rgba(255,110,40,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c); })();
  const flames = [];
  const addFlame = (parent, y, r) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: new THREE.Color(5, 3.6, 2.2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true, opacity: 0 }));
    sp.position.y = y; sp.userData.r = r; sp.renderOrder = 10; parent.add(sp); flames.push(sp); };
  addFlame(rk.core, -2.2, 3.0); for (const b of rk.boosters) addFlame(b.g, -1.8, 2.5);

  // ----- space scenes (background: stars + Earth with its own depth range; foreground: vehicles)
  const spaceBg = new THREE.Scene(), spaceFg = new THREE.Scene();
  const sunS = V3(-0.62, 0.42, 0.66).normalize();
  const stars = buildStars(R, 1.0e8, 1800); spaceBg.add(stars);
  // Milky Way and Moon placed for the final shot (band across the top, Moon upper left)
  const camD = V3(-0.522, -0.264, -0.811), camU = V3(-0.143, 0.965, -0.222), camR = V3(0.841, 0, -0.541);
  const bandA = camD.clone().addScaledVector(camU, 0.12).normalize(), bandB = camR.clone().multiplyScalar(0.82).addScaledVector(camU, 0.57);
  const milky = buildGalaxy(bandA.clone().cross(bandB), bandA.clone().addScaledVector(bandB, -0.15).normalize(), renderer, tier ? 768 : 512); spaceBg.add(milky);
  const moonDir = camD.clone().addScaledVector(camU, 0.2).addScaledVector(camR, -0.36).normalize();
  const moon = new THREE.Mesh(new THREE.SphereGeometry(9.5e5, 64, 32), new THREE.MeshStandardMaterial({ map: moonTex(R), roughness: 1, metalness: 0 }));
  spaceBg.add(moon);
  const moonSun = new THREE.DirectionalLight(0xffffff, 2.6); spaceBg.add(moonSun, moonSun.target);
  const planetTex = (() => { const [c, g] = cnv(64); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.12, "rgba(255,250,235,.85)"); gr.addColorStop(0.4, "rgba(255,240,210,.08)"); gr.addColorStop(1, "rgba(255,240,210,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return tex(c); })();
  const planets = [[V3(-0.35, 0.25, -0.9), 0xfff4dc, 1.0], [V3(0.25, 0.42, -0.87), 0xffd2a8, 0.6], [V3(-0.75, 0.55, -0.35), 0xf2f6ff, 0.75]].map(([dir, col, sz]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: planetTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sp.userData.dir = dir.normalize(); sp.userData.sz = sz; spaceBg.add(sp); return sp; });
  const meteors = new Meteors(4); spaceBg.add(meteors.group);
  const earth = buildEarth({ day, night, water, clouds, relief }, sunS);
  spaceBg.add(earth.group);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const [c, g] = cnv(256); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.08, "rgba(255,248,230,.9)"); gr.addColorStop(0.3, "rgba(255,220,170,.12)"); gr.addColorStop(1, "rgba(255,200,150,0)"); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return tex(c); })(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sunGlow.scale.setScalar(9e6); spaceBg.add(sunGlow);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { sunDir: { value: sunS } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 sunDir; varying vec3 vD; void main(){ float e = vD.y;
      vec3 c = mix(vec3(0.0), vec3(0.32,0.46,0.75), smoothstep(0.05, -0.55, e));
      c += vec3(5.0,4.7,4.2) * pow(max(dot(vD, sunDir), 0.0), 400.0) + vec3(0.35,0.32,0.3) * pow(max(dot(vD, sunDir), 0.0), 12.0);
      gl_FragColor = vec4(c, 1.0); }` })));
  spaceFg.environment = pm.fromScene(envScene, 0.0).texture;
  const sunLightS = new THREE.DirectionalLight(0xfff6ea, 2.3); sunLightS.position.copy(sunS).multiplyScalar(100);
  spaceFg.add(sunLightS, sunLightS.target, new THREE.HemisphereLight(0x0a0c12, 0x2b4a7a, 0.55));
  const sparks = new Smoke(400, puff, { lit: 0xf4f2ee, shade: 0x9a9894, drag: 0.1, buoy: 0, maxA: 0.45 }); spaceFg.add(sparks.points);

  // ----- post
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: tier ? 4 : 0 }));
  const rpGround = new RenderPass(ground, camera);
  const rpBg = new RenderPass(spaceBg, bgCam);
  const rpFg = new RenderPass(spaceFg, camera); rpFg.clear = false; rpFg.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.55, 0.88);
  const film = new ShaderPass(FilmShader);
  composer.addPass(rpGround); composer.addPass(rpBg); composer.addPass(rpFg); composer.addPass(bloom); composer.addPass(new OutputPass()); composer.addPass(film);
  let level = 0;

  // ----- state
  const qAxis = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), V3(Math.sin(deg(64)), Math.cos(deg(64)), 0));
  const qIndia = earthQuat(13.0, 82.0, deg(-35));
  const qMed = earthQuat(37.5, -1.0, deg(8));
  const satFinalQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(-6), deg(-28), deg(3)));
  const look = { s: 0, ts: 0, x: 0, tx: 0, y: 0, ty: 0 };
  let inSpace = false, satFree = false, lastCap = -1, revealed = false, t = 0, simT = 0;
  const satSep = { pos: V3(), q: new THREE.Quaternion() };

  const captions = {
    fr: [[0, "30 juillet 2025, Sriharikota (Inde) : NISAR décolle à bord d'une fusée GSLV."], [T.space, "Les quatre propulseurs d'appoint se détachent, puis le premier étage."],
      [T.fair, "La coiffe s'ouvre : NISAR est dans l'espace."], [T.deploy, "Le bras de 9 m se déplie, puis l'antenne de 12 m s'ouvre."]],
    en: [[0, "30 July 2025, Sriharikota (India): NISAR lifts off on a GSLV rocket."], [T.space, "The four strap-on boosters separate, then the first stage."],
      [T.fair, "The fairing opens: NISAR is in space."], [T.deploy, "The 9 m boom unfolds, then the 12 m antenna opens."]],
  };

  const path = (h, out) => out.set(-(h * h) / 95000, h, -(h * h) / 260000);
  const H = tt => tt < T.lift ? 0 : 15.5 * Math.pow(tt - T.lift, 2.15);
  let W = 1, Hh = 1;

  // portrait screens: keep part of the horizontal field of a landscape shot (compromise between width and height)
  const fitFov = f => { const a = W / Hh; if (a >= 1.6) return f;
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(f) / 2) * Math.pow(1.6 / a, 0.5))); };
  function resize() {
    W = canvas.clientWidth || window.innerWidth; Hh = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, Hh, false); composer.setSize(W, Hh);
    camera.aspect = bgCam.aspect = W / Hh; camera.updateProjectionMatrix(); bgCam.updateProjectionMatrix();
    bloom.resolution.set(W * (tier ? 0.5 : 0.33), Hh * (tier ? 0.5 : 0.33));
    film.uniforms.aspect.value = W / Hh;
  }
  resize();

  function setPlume(pl, power, vac, len = 1, width = 1) {
    pl.visible = power > 0.001; pl.material.uniforms.power.value = power; pl.material.uniforms.vac.value = vac;
    pl.material.uniforms.time.value = simT; pl.scale.set(width, len, width);
  }

  // ======== ground phase: pad close-up, then long-lens tracking ========
  function groundPhase(dt) {
    rpGround.enabled = true; rpBg.enabled = rpFg.enabled = false;
    renderer.toneMappingExposure = 0.52; bloom.threshold = 3.2; bloom.strength = 0.32;
    const ign = sstep(T.ign, T.ign + 0.35, t);
    pad.arms.forEach((a, i) => { a.rotation.y = lerp(0, -1.45, sstep(0.0, 0.7 + i * 0.05, t)); });
    for (const b of rk.boosters) setPlume(b.plume, ign * (0.92 + 0.08 * Math.sin(simT * 40 + b.a)), 0, lerp(0.35, 1, ign));
    setPlume(rk.plumes.core, sstep(T.ign + 0.25, T.lift, t), 0, lerp(0.3, 1, sstep(T.ign + 0.25, T.lift + 0.3, t)));
    setPlume(rk.plumes.upper, 0, 0);
    smoke.mat.uniforms.scale.value = Hh / (2 * Math.tan(deg(camera.fov) / 2));
    clouds3.material.uniforms.time.value = simT;

    if (t < T.shotB) {
      ground.fog = ground.fog || new THREE.Fog(0xd9c6ad, 900, 14000);
      sky.visible = true; dome.visible = false; trail.mesh.visible = false; cloudLayer.visible = false; starsG.material.opacity = 0;
      const h = H(t);
      rk.group.position.set(0, 2.6 + h, 0); rk.group.rotation.set(0, 0, 0);
      // exhaust hits the pad and billows out of the trenches
      if (ign > 0 && dt > 0) {
        const n = Math.round(lerp(14, 40, ign) * dt * 60 * SM);
        for (let k = 0; k < n; k++) {
          const s = R() < 0.5 ? 1 : -1, fromTrench = h < 18;
          if (fromTrench) smoke.spawn((R() - 0.5) * 6, 1 + R() * 2, s * (14 + R() * 6), (R() - 0.5) * 10, 5 + R() * 12, s * (30 + R() * 42), 7 + R() * 5, 9 + R() * 6, 3.5 + R() * 3, 0.7, R);
          else { const y = rk.group.position.y - 3 - R() * 10; smoke.spawn((R() - 0.5) * 4, y, (R() - 0.5) * 4, (R() - 0.5) * 6, -38 - R() * 25, (R() - 0.5) * 6, 5 + R() * 3, 5 + R() * 4, 3 + R() * 2, 0.9, R); }
        }
      }
      if (ign > 0 && dt > 0 && h < 25) {                    // water-deluge steam boiling up around the launch table
        const n = Math.round(lerp(1, 4, ign) * dt * 60 * SM);
        for (let k = 0; k < n; k++) { const a = R() * 6.283, r = 5.8 + R() * 2;
          smoke.spawn(Math.cos(a) * r, 0.8 + R() * 1.5, Math.sin(a) * r, Math.cos(a) * (3 + R() * 5), 1.5 + R() * 3.5, Math.sin(a) * (3 + R() * 5), 1.2 + R() * 1.2, 2 + R() * 2.5, 1.6 + R() * 1.4, 0.15, R); }
      }
      for (const f of flames) { const fl = 0.85 + 0.15 * Math.sin(simT * 53 + f.id); f.material.opacity = ign * (1 - sstep(20, 60, h)) * fl; f.scale.set(f.userData.r * 1.1 * fl, f.userData.r * 1.9 * fl, 1); f.visible = f.material.opacity > 0.01; }
      holeGlow.material.opacity = ign * (1 - sstep(4, 30, h)) * (0.85 + 0.15 * Math.sin(simT * 47));
      smoke.update(dt);
      fireLight.position.set(0, h < 6 ? 0.4 : Math.max(2, rk.group.position.y - 6), 0); fireLight.intensity = ign * (h < 6 ? 900 : 3800) * (1 + 0.3 * Math.sin(simT * 33));
      const shake = 0.16 * ign * (1 - sstep(1.9, T.shotB, t));
      const ty = lerp(26, 26 + h * 0.92, sstep(T.lift, T.shotB, t));
      camera.near = 0.5; camera.far = 600000;
      if (t < T.cut) {                                   // shot A1: engines igniting, low and close, slow push-in
        const u = sstep(0, T.cut, t), sh = 0.05 * ign;
        camera.fov = lerp(30, 25, u);
        camera.position.set(lerp(19, 16.5, u) + Math.sin(simT * 41) * sh, 3.2 + Math.sin(simT * 57) * sh, lerp(7.5, 6.5, u));
        camera.lookAt(0, lerp(2.7, 3.9, u) + h * 0.85, 0);
      } else {                                           // shot A2: the classic wide pad view, the rocket clears the tower
        camera.fov = lerp(36, 31, sstep(T.lift, T.shotB, t));
        camera.position.set(47 + Math.sin(simT * 37) * shake, 4.2 + Math.sin(simT * 51) * shake, 80);
        camera.lookAt(0, ty, 0);
      }
    } else {
      // long-lens tracking from 12 km away, sky darkening toward space
      for (const f of flames) f.visible = false;
      ground.fog = null; sky.visible = false; dome.visible = true; trail.mesh.visible = true; cloudLayer.visible = false;
      const u = (t - T.shotB) / (T.space - T.shotB), alt = lerp(1400, 26000, Math.pow(u, 1.5));
      const p = V3(), q = V3(); path(alt, p); path(alt + 30, q);
      rk.group.position.copy(p).add(V3(0, -25, 0));
      rk.group.quaternion.setFromUnitVectors(V3(0, 1, 0), q.sub(p).normalize());
      for (const b of rk.boosters) setPlume(b.plume, 1, sstep(0.3, 1, u) * 0.6, lerp(1, 2.2, u), lerp(1, 1.8, u));
      setPlume(rk.plumes.core, 1, sstep(0.3, 1, u) * 0.6, lerp(1, 2.2, u), lerp(1, 1.8, u));
      trail.update(path, 80, alt - 20);
      smoke.update(dt);
      fireLight.intensity = 0;
      const space = sstep(0.05, 1.0, u); dome.material.uniforms.space.value = space; starsG.material.opacity = sstep(0.55, 1, u);
      camera.near = 40; camera.far = 600000;
      camera.position.set(3600, 40, 5200);
      const dist = camera.position.distanceTo(rk.group.position);
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lerp(260, 520, u) / 2 / dist));
      camera.lookAt(rk.group.position.clone().add(V3(0, -lerp(45, 110, u), 0)));
      dome.position.copy(camera.position); starsG.position.copy(camera.position);
    }
    camera.fov = fitFov(camera.fov);
    camera.updateProjectionMatrix();
  }

  // ======== space phase: staging, fairing, deployment, orbit ========
  function enterSpace() {
    inSpace = true; smoke.clear(); spaceFg.add(rk.group); for (const f of flames) f.visible = false;
    rk.group.position.set(0, 0, 0); rk.group.quaternion.copy(qAxis); rk.group.updateMatrixWorld(true);
  }
  const tmpQ = new THREE.Quaternion(), tmpV = V3();
  function spacePhase(dt) {
    if (!inSpace) enterSpace();
    rpGround.enabled = false; rpBg.enabled = rpFg.enabled = true;
    renderer.toneMappingExposure = 1.0; bloom.threshold = 1.15; bloom.strength = 0.45;

    // Earth below: from over India at 230 km to over the Mediterranean at 747 km (time is compressed)
    const k = sstep(T.space, T.end, t), alt = lerp(ALT0, ALT1, sstep(T.space, T.deployEnd, t));
    const orbit = Math.max(0, t - T.end) * 0.0016 + look.s * 0.22;
    earth.group.quaternion.copy(qIndia).slerp(qMed, k).premultiply(tmpQ.setFromAxisAngle(V3(1, 0, 0), -orbit));
    earth.group.position.set(0, -(R_E + alt), 0);
    earth.mat.uniforms.axis.value.set(0, 1, 0).applyQuaternion(earth.group.quaternion);
    earth.clouds.rotation.y = simT * 0.0007;

    // staging, all as functions of time
    const ax = V3(0, 1, 0);
    for (const b of rk.boosters) {
      const tau = Math.max(0, t - T.boost), out = V3(Math.cos(b.a), 0, Math.sin(b.a));
      b.g.position.copy(b.base).addScaledVector(out, 2.4 * tau + 1.4 * tau * tau).addScaledVector(ax, -(3.5 * tau + 9 * tau * tau));
      b.g.quaternion.setFromAxisAngle(V3(0, 1, 0).cross(out).normalize(), -(0.4 * tau + 0.35 * tau * tau));
      b.g.visible = tau < 3.5 && t < T.deployEnd + 0.5;
      setPlume(b.plume, t < T.boost - 0.02 ? 1 : 0, 1, 1.5, 2.2);
    }
    const tc = Math.max(0, t - T.core);
    rk.core.position.set(0.15 * tc, -(2.0 * tc + 7 * tc * tc), 0); rk.core.rotation.z = -0.12 * tc * tc; rk.core.visible = tc < 3.5 && t < T.deployEnd + 0.5;
    setPlume(rk.plumes.core, t < T.core - 0.02 ? 1 : 0, 1, 1.5, 2.2);
    setPlume(rk.plumes.upper, sstep(T.core + 0.15, T.core + 0.45, t) * (1 - sstep(T.sep - 0.35, T.sep - 0.1, t)), 1, 1, 1);
    const tf = Math.max(0, t - T.fair);
    for (const f of rk.fair) {
      f.hinge.rotation.z = -f.sx * (1.25 * tf + 1.1 * tf * tf);
      f.hinge.position.copy(f.base).add(V3(f.sx * (2.8 * tf * tf + 0.8 * tf), -(0.8 * tf + 3.4 * tf * tf), 0));
      f.hinge.visible = t < T.deployEnd + 0.5;
    }
    const ts = Math.max(0, t - T.sep);
    rk.upper.position.set(-1.2 * ts * ts, -(1.6 * ts + 5.5 * ts * ts), 0); rk.upper.rotation.x = 0.08 * ts; rk.upper.visible = t < T.deployEnd + 0.5;

    // NISAR: separate, turn to its working attitude, deploy wings, boom, antenna
    if (t >= T.sep && !satFree) {
      satFree = true; spaceFg.attach(sat.group);
      satSep.pos.copy(sat.group.position); satSep.q.copy(sat.group.quaternion);
    }
    if (t < T.sep && satFree) { satFree = false; rk.satMount.attach(sat.group); sat.group.position.set(0, 0, 0); sat.group.quaternion.identity(); }
    const s = sstep(T.deploy, T.deploy + 0.55, t), e = sstep(T.deploy + 0.3, T.deploy + 1.05, t), o = sstep(T.deploy + 0.85, T.deployEnd, t);
    sat.set(s, e, o);
    if (satFree) {
      const rot = sstep(T.sep, T.deploy + 0.9, t), drift = Math.min(ts, 3) * 0.7;
      sat.group.position.copy(satSep.pos).addScaledVector(V3(0, 1, 0).applyQuaternion(qAxis), drift);
      sat.group.quaternion.copy(satSep.q).slerp(satFinalQ, rot);
      const loop = Math.max(0, t - T.end);
      if (loop > 0) sat.group.quaternion.premultiply(tmpQ.setFromAxisAngle(V3(0, 1, 0), loop * 0.045)).premultiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), Math.sin(loop * 0.21) * 0.05));
    }

    // separation puffs
    if (dt > 0) {
      const burst = (tt, at, n) => { if (t >= tt && t - dt < tt) for (let i = 0; i < n; i++) sparks.spawn(at.x, at.y, at.z, (R() - 0.5) * 9, (R() - 0.5) * 9, (R() - 0.5) * 9, 0.25, 0.9, 0.5 + R() * 0.5, 0, R); };
      for (const b of rk.boosters) burst(T.boost, b.g.getWorldPosition(tmpV).clone().add(V3(0, 0, 0)), 14);
      burst(T.core, rk.group.localToWorld(V3(0, 20, 0)), 40);
      burst(T.fair, rk.group.localToWorld(V3(0, 45, 0)), 30);
      burst(T.sep, rk.group.localToWorld(V3(0, 41.5, 0)), 16);
    }
    sparks.mat.uniforms.scale.value = Hh / (2 * Math.tan(deg(camera.fov) / 2));
    sparks.update(dt);

    // camera: chase the stack, move to the fairing, then orbit NISAR and settle
    const cA = rk.group.localToWorld(V3(0, 22, 0)), oA = V3(-40, 9, 36).multiplyScalar(lerp(1, 0.8, sstep(T.space, T.core, t)));
    const cB = rk.group.localToWorld(V3(0, 44, 0)), oB = V3(-19, 6, 27);
    const satC = sat.group.localToWorld(V3(-0.5, 4.0, 0));
    const loopT = Math.max(0, t - T.end);
    look.s += (look.ts - look.s) * Math.min(1, dt * 3); look.x += (look.tx - look.x) * Math.min(1, dt * 2.5); look.y += (look.ty - look.y) * Math.min(1, dt * 2.5);
    const live = sstep(T.end, T.end + 1.5, t);
    const r = lerp(18, 36, sstep(T.sep, T.end, t)) + live * look.s * 16,
      az = lerp(-0.35, 0.62, sstep(T.sep, T.end + 0.6, t)) + loopT * 0.012 + live * (look.s * 1.15 + look.x * 0.09),
      el = lerp(0.16, 0.2, sstep(T.sep, T.end, t)) + Math.sin(loopT * 0.1) * 0.02 + live * (look.s * 0.22 - look.y * 0.05);
    const oC = V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(r);
    const kAB = sstep(T.core + 0.15, T.fair + 0.25, t), kBC = sstep(T.sep - 0.1, T.deploy + 0.6, t);
    const tgt = cA.clone().lerp(cB, kAB).lerp(satC, kBC);
    const off = oA.clone().lerp(oB, kAB).lerp(oC, kBC);
    camera.position.copy(tgt).add(off);
    const aim = tgt.clone().add(V3(0, -lerp(0, 2.5, sstep(T.deploy + 0.5, T.end, t)), 0));
    camera.lookAt(aim);
    camera.fov = lerp(34, 36, kBC); camera.near = 0.3; camera.far = 20000;
    const wide = W / Hh > 1.15;
    camera.filmOffset = wide ? lerp(0, -9.5, sstep(T.deployEnd - 0.4, T.end, t)) : 0;
    camera.fov = fitFov(camera.fov);
    camera.updateProjectionMatrix();
    bgCam.position.copy(camera.position); bgCam.quaternion.copy(camera.quaternion);
    bgCam.fov = camera.fov; bgCam.filmOffset = camera.filmOffset; bgCam.updateProjectionMatrix();
    sunGlow.position.copy(sunS).multiplyScalar(9.0e7).add(camera.position);
    stars.position.copy(camera.position); milky.position.copy(camera.position); milky.material.uniforms.time.value = simT;
    moon.position.copy(moonDir).multiplyScalar(4.0e7).add(camera.position); moon.rotation.y = 2.2;
    moonSun.position.copy(moon.position).addScaledVector(sunS, 1e7); moonSun.target.position.copy(moon.position);
    for (const p of planets) { const dd = 6e7; p.position.copy(p.userData.dir).multiplyScalar(dd).add(camera.position); p.scale.setScalar(dd * 0.006 * p.userData.sz); }
    meteors.update(dt, bgCam, t > T.space + 1.2);
  }

  function update(dt) {
    if (t < T.space) groundPhase(dt);
    else spacePhase(dt);
    const barTarget = W / Hh < 1 ? 0.075 : Math.max(0, (1 - (W / Hh) / 2.39) / 2);
    const fu = film.uniforms; fu.time.value = simT;
    fu.bars.value = mode === "orbit" ? 0 : barTarget * sstep(0.0, 0.7, t) * (1 - sstep(T.ui - 0.2, T.ui + 0.6, t));
    fu.fade.value = mode === "orbit" ? 1 : sstep(0.0, 0.9, t);
    fu.ab.value = (t < T.space ? 0.0006 + 0.0012 * sstep(T.ign, T.ign + 0.3, t) * (1 - sstep(1.8, T.shotB, t)) : 0.00035 * (1 - sstep(T.ui, T.end, t)));
    fu.warm.value = t < T.space ? 1 : 0;
    const pulse = (at, len) => Math.max(0, 1 - Math.abs(t - at) / len);          // short white flash on the cut
    fu.flash.value = Math.min(1, pulse(T.cut, 0.06) * 0.55 + pulse(T.shotB, 0.07) * 0.45 + pulse(T.space, 0.12) * 0.72);
    fu.haze.value = t < T.shotB ? sstep(T.ign, T.ign + 0.4, t) * (t < T.cut ? 1 : 0.55) : 0;
    fu.grain.value = t > T.end + 0.5 ? 0.03 : 0.045;
    level = t < T.shotB ? sstep(T.ign, T.ign + 0.4, t) : t < T.space ? lerp(1, 0.25, sstep(T.shotB, T.space, t)) : 0.04 * (t < T.sep ? 1 : 0);
    let ci = -1; const list = captions[lang] || captions.fr;
    for (let i = 0; i < list.length; i++) if (t >= list[i][0]) ci = i;
    if (t > T.end + 1.2) ci = -2;
    if (ci !== lastCap) { lastCap = ci; onCaption(ci >= 0 ? list[ci][1] : ""); }
    if (!revealed && t >= T.ui) { revealed = true; onReveal(); }
  }

  function reset() {
    t = 0; simT = 0; inSpace = false; ground.add(rk.group); rk.group.position.set(0, 2.6, 0); rk.group.quaternion.identity();
    smoke.clear(); sparks.clear();
    for (const b of rk.boosters) { b.g.position.copy(b.base); b.g.quaternion.identity(); b.g.visible = true; }
    rk.core.position.set(0, 0, 0); rk.core.rotation.set(0, 0, 0); rk.core.visible = true;
    rk.upper.position.set(0, 0, 0); rk.upper.rotation.set(0, 0, 0); rk.upper.visible = true;
    for (const f of rk.fair) { f.hinge.position.copy(f.base); f.hinge.rotation.set(0, 0, 0); f.hinge.visible = true; }
    if (satFree) { satFree = false; rk.satMount.attach(sat.group); }
    sat.group.position.set(0, 0, 0); sat.group.quaternion.identity(); sat.set(0, 0, 0);
  }

  // ----- webcast telemetry: mission elapsed time is accelerated; anchors are real (lift-off, GS1 separation at T+157 s
  // from the ISRO brochure, NISAR separation about 19 minutes after lift-off)
  const MET = [[0, -4], [T.lift, 0], [T.shotB, 32], [T.space, 120], [T.core, 157], [T.sep, 1140], [T.end, 1180]];
  function telemetry(tt) {
    let m = MET[MET.length - 1][1] + (tt - T.end) * 8;
    for (let i = 1; i < MET.length; i++) if (tt <= MET[i][0]) { const [a, x] = MET[i - 1], [b, y] = MET[i]; m = x + (y - x) * (tt - a) / (b - a); break; }
    const phase = tt < T.lift ? 0 : tt < T.space ? 1 : tt < T.core + 0.3 ? 2 : tt < T.sep ? 3 : tt < T.deployEnd ? 4 : 5;
    return { met: m, phase, orbit: tt >= T.deployEnd };
  }

  // ----- loop
  let raf = 0, last = 0, mode = "intro", lowFps = false, acc = 0, slow = 0, scaleDown = 1, dim = 0;
  const ORBIT_PR = tier ? 1 : 0.8;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const raw = last ? (now - last) / 1000 : 1 / 60; last = now;
    let dt = Math.min(raw, 1 / 20);
    if (lowFps) {
      // behind the page: draw nothing while the reading sections cover the space,
      // 30 fps while the camera is moving (scroll, mouse), 12 fps when idle
      if (dim > 0.97) { acc = 0; return; }
      const moving = Math.abs(look.ts - look.s) > 0.002 || Math.abs(look.tx - look.x) > 0.01 || Math.abs(look.ty - look.y) > 0.01;
      acc += raw; if (acc < (moving ? 1 / 30 : 1 / 10)) return; dt = Math.min(acc, 0.25); acc = 0;
      if (moving) { slow = slow * 0.95 + (raw > 0.06 ? 0.05 : 0);
        if (slow > 0.6 && scaleDown > 0.5) { scaleDown -= 0.15; renderer.setPixelRatio(ORBIT_PR * scaleDown); resize(); slow = 0; onSlow(); } }
    }
    t += dt; simT += dt;
    update(dt);
    composer.render();
    if (mode === "intro" && t > T.end + 0.4) { mode = "orbit"; lowFps = true; bloom.enabled = false; scaleDown = 1; renderer.setPixelRatio(ORBIT_PR); renderer.shadowMap.enabled = false; smoke.clear(); resize(); }
  }
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && running) { last = 0; raf = requestAnimationFrame(frame); }
  });
  let running = false;

  // compile every shader now (in parallel where the browser allows) so the first frames do not stall
  try { await renderer.compileAsync(ground, camera); await renderer.compileAsync(spaceFg, camera); await renderer.compileAsync(spaceBg, bgCam); } catch (e) {}

  return {
    T,
    start() { reset(); running = true; t = 0; simT = 0; revealed = false; lastCap = -1; mode = "intro"; lowFps = false; last = 0; bloom.enabled = true; renderer.shadowMap.enabled = tier === 1; renderer.setPixelRatio(DPR); resize(); if (!raf) raf = requestAnimationFrame(frame); },
    skip() { smoke.clear(); sparks.clear(); t = Math.max(t, T.end + 0.01); simT = t; update(0); },
    still() { running = false; cancelAnimationFrame(raf); raf = 0; t = T.end + 2; simT = t; update(0); composer.render(); },
    // test helper: simulate up to time `to` with a fixed step, then draw one frame
    renderAt(to, step = 1 / 30) { reset(); revealed = true;
      while (t + step < to) { t += step; simT += step; update(step); } t = to; simT = to; update(step); composer.render(); },
    setLang(l) { lang = l; lastCap = -1; },
    level: () => level, time: () => t,
    setScroll(v) { look.ts = clamp(v); }, telemetry() { return telemetry(t); }, setDim(v) { dim = v; }, tier, setPointer(x, y) { look.tx = clamp(x, -1, 1); look.ty = clamp(y, -1, 1); },
    // test helper: advance by a fixed step and draw
    step(dt) { t += dt; simT += dt; update(dt); composer.render(); },
    reset,
    debug() { const d = camera.getWorldDirection(V3()); const up = V3(0, 1, 0).applyQuaternion(camera.quaternion); const right = V3(1, 0, 0).applyQuaternion(camera.quaternion);
      const sp = sunS.clone().multiplyScalar(1e8).add(camera.position).project(bgCam); return { d: d.toArray(), up: up.toArray(), right: right.toArray(), sun: sp.toArray() }; },
  };
}
