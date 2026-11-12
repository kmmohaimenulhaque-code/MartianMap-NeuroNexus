/* Finale: a slowly turning Mars globe textured with the project's MOLA-derived global map, with pointer parallax
   and a cyan rim. three.js is loaded only when the finale approaches, so it never delays the first paint.
   Falls back to the static poster without WebGL, under reduced motion or with Save-Data on. */

import { finePointer, reducedMotion, saveData } from "./env.js";

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function initFinale() {
  const section = document.querySelector("[data-finale]");
  const host = section?.querySelector("[data-globe]");
  if (!section || !host || reducedMotion() || saveData() || !webglOk() || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      start(section, host).catch(() => {
        /* keep the poster */
      });
    },
    { rootMargin: "600px 0px" },
  );
  io.observe(section);
}

async function start(section, host) {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  const tex = await new THREE.TextureLoader().loadAsync("/mars-mola-global.jpg");
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 96, 64),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  globe.rotation.z = THREE.MathUtils.degToRad(25.2);
  scene.add(globe);

  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.56, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { color: { value: new THREE.Color(0x01ffff) } },
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 color; varying vec3 vN; void main(){ float a = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(color, clamp(a,0.0,1.0)*0.55); }",
    }),
  );
  scene.add(rim);

  // Orbital rings with a marker riding each one (mission theme). Decorative: no orbit is implied.
  const rings = new THREE.Group();
  [[1.95, 0.42, 0.1], [2.3, 0.18, -0.5], [2.7, 0.62, 0.9]].forEach(([r, tilt, roll], i) => {
    const pts = new THREE.EllipseCurve(0, 0, r, r).getPoints(180).map((q) => new THREE.Vector3(q.x, 0, q.y));
    const ring = new THREE.Group();
    ring.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x01ffff, transparent: true, opacity: 0.55 - i * 0.12 })));
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffd27a : 0x01ffff }));
    marker.position.set(r, 0, 0);
    ring.add(marker);
    ring.rotation.set(tilt, 0, roll);
    rings.add(ring);
  });
  scene.add(rings);

  scene.add(new THREE.AmbientLight(0xffffff, 0.18));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.6);
  sun.position.set(-4, 2, 3);
  scene.add(sun);

  section.classList.add("is-3d");

  const size = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w < 700 ? 8.2 : 6.2;
    camera.updateProjectionMatrix();
  };
  size();
  new ResizeObserver(size).observe(host);

  const target = { x: 0, y: 0 };
  if (finePointer()) {
    section.addEventListener("pointermove", (e) => {
      const r = section.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 0.5;
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 0.3;
    });
  }

  // Drag (or swipe) the globe to spin it; it coasts and slows. A tap sends a pulse through the rings.
  let drag = null;
  let spin = 0;
  let pulse = 0;
  section.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button")) return;
    drag = { x: e.clientX };
    spin = 0;
    pulse = 1;
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return;
    spin = (e.clientX - drag.x) * 0.004;
    drag.x = e.clientX;
    globe.rotation.y += spin;
  });
  addEventListener("pointerup", () => (drag = null));
  addEventListener("pointercancel", () => (drag = null));

  let visible = true;
  let slow = 0;
  let last = performance.now();
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) requestAnimationFrame(frame);
  }).observe(section);

  function frame(now) {
    if (!visible || document.hidden) return;
    const dt = Math.min(64, now - last);
    last = now;
    // Adaptive quality: if frames stay slow, drop the pixel ratio once.
    slow = dt > 22 ? slow + 1 : Math.max(0, slow - 1);
    if (slow > 90 && renderer.getPixelRatio() > 1) {
      renderer.setPixelRatio(1);
      size();
      slow = 0;
    }
    globe.rotation.y += dt * 0.00006;
    if (!drag) {
      globe.rotation.y += spin;
      spin *= 0.95;
    }
    pulse *= 0.93;
    rings.children.forEach((ring, i) => {
      ring.rotation.y += dt * (0.00018 + i * 0.00006) * (i % 2 ? -1 : 1) * (1 + pulse * 12);
      ring.scale.setScalar(1 + pulse * 0.08 * (i + 1));
    });
    scene.rotation.y += (target.x - scene.rotation.y) * 0.04;
    scene.rotation.x += (target.y - scene.rotation.x) * 0.04;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && visible) requestAnimationFrame(frame);
  });
  requestAnimationFrame(frame);
}
