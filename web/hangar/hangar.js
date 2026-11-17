// NABD hangar: NISAR and its launcher, the GSLV-F16, in 3D.
// Renders only on demand (drag, zoom, model change) and slowly turns while visible on screen.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export function mountHangar({ root, lib, initial = "nisar" }) {
  const canvas = root.querySelector("canvas");
  const status = root.querySelector(".hg-status");
  const tabs = [...root.querySelectorAll("[data-model]")];
  const facts = [...root.querySelectorAll("[data-facts]")];
  const sfBtn = root.querySelector("#hg-sketchfab");
  const sfBox = root.querySelector(".hg-embed");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelector(".hg-poster").hidden = true; root.querySelector(".hg-go").hidden = true; canvas.hidden = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xfff3e2, 2.6); key.position.set(4, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb4ff, 1.4); rim.position.set(-5, 3, -6); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x9fb6ff, 0x1b1530, 0.35));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 2000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.9;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  const R = lib.rng(20250730);
  const built = {};
  const makers = {
    nisar: async () => { const s = lib.buildNisar(R); s.set(1, 1, 1); s.group.rotation.set(0.15, -0.6, 0); return s.group; },
    gslv: async () => { const r = lib.buildRocket(R); r.group.traverse(o => { if (o.material && o.material.blending === THREE.AdditiveBlending) o.visible = false; }); return r.group; },
  };
  function say(t) { status.textContent = t; status.hidden = !t; }

  let current = null, cur = "";
  async function show(id) {
    if (id === cur) return; cur = id;
    tabs.forEach(b => b.setAttribute("aria-selected", String(b.dataset.model === id)));
    facts.forEach(f => { f.hidden = f.dataset.facts !== id; });
    sfBtn.hidden = id !== "nisar"; sfBox.hidden = true; canvas.hidden = false;
    if (current) scene.remove(current);
    say(root.dataset.loading || "…");
    try {
      if (!built[id]) built[id] = await makers[id]();
    } catch (e) { say(root.dataset.failed || "Échec du chargement du modèle."); return; }
    if (cur !== id) return;
    current = built[id]; scene.add(current); say("");
    frameObject(current);
    controls.autoRotate = !reduce; kick();
  }
  function frameObject(o) {
    o.updateMatrixWorld(true);
    const box = new THREE.Box3();                                   // only what is drawn (hidden exhaust plumes are left out)
    o.traverseVisible(m => { if (m.isMesh || m.isInstancedMesh) box.expandByObject(m, false); });
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), th = tv * camera.aspect;
    const halfW = Math.max(size.x, size.z) / 2, d = Math.max(size.y / 2 / tv, halfW / th) * 1.12 + halfW;
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(0.55, 0.22, 1).normalize().multiplyScalar(d));
    camera.near = d / 100; camera.far = d * 10; camera.updateProjectionMatrix();
    controls.minDistance = d * 0.25; controls.maxDistance = d * 2.5; controls.update();
  }

  // ---- on-demand loop: runs while the viewer is on screen, otherwise sleeps
  let visible = false, raf = 0, idle = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  let lastT = 0;
  function tick(now) {
    raf = 0;
    if (controls.autoRotate && now - lastT < 32) { if (visible && !document.hidden) raf = requestAnimationFrame(tick); return; }   // turntable at 30 fps
    lastT = now;
    const moved = controls.update();
    renderer.render(scene, camera);
    idle = moved || controls.autoRotate ? 0 : idle + 1;
    if (visible && !document.hidden && idle < 30) raf = requestAnimationFrame(tick);
  }
  function kick() { idle = 0; if (!raf && visible) raf = requestAnimationFrame(tick); }
  controls.addEventListener("change", kick);
  new ResizeObserver(() => { resize(); kick(); }).observe(canvas);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }, { rootMargin: "80px" }).observe(canvas);
  document.addEventListener("visibilitychange", kick);

  tabs.forEach(b => b.addEventListener("click", () => show(b.dataset.model)));
  root.querySelector('[role="tablist"]').addEventListener("keydown", e => {        // arrow keys move between tabs
    const i = tabs.findIndex(b => b.getAttribute("aria-selected") === "true");
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : -9;
    if (j === -9) return; e.preventDefault(); const b = tabs[(j + tabs.length) % tabs.length]; b.focus(); b.click();
  });
  sfBtn.addEventListener("click", () => {                 // detailed model, hosted by Sketchfab, loaded only on request
    if (!sfBox.querySelector("iframe")) {
      const f = document.createElement("iframe");
      f.title = "NISAR Satellite ISRO - NASA Joint Mission (Sketchfab, MechLab3D)";
      f.src = "https://sketchfab.com/models/0103309668d243dbbfab3c8fc6b9683c/embed?autostart=1&ui_theme=dark&dnt=1";
      f.allow = "autoplay; fullscreen; xr-spatial-tracking"; f.setAttribute("allowfullscreen", ""); f.loading = "lazy";
      sfBox.prepend(f);
    }
    sfBox.hidden = false; canvas.hidden = true; say("");
  });
  resize(); show(initial);
}
