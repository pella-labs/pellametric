"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="57 34 48 64">
<path fill="#191718" fill-rule="evenodd" d="M58.2 49c0.4-6.4 5.6-12.6 12.6-12.9h18.6c7.4 0.1 12.8 5.7 12.8 13.3v5.1c-0.3 3.4-1.7 6.2-4.5 8.4 2.5 1.5 4.6 3.9 4.8 7.4v7.2c-0.4 5.7-4.6 10.9-11.5 11.3h-19.8v8.2h-13v-48zM61.3 49.5v44.4h6.7v-8.5h22.1c5.1 0 9-3.7 9.3-8.2v-6.4c-0.1-4.2-4.7-5.9-8.9-7.7 3.8-1.2 8.3-3.7 8.7-8.9v-4.7c-0.1-5-4.3-10.3-10.5-10.3h-17.1c-4.6 0-10 3.8-10.3 9.7v0.6zM68.1 48.9c0.1-2 1.4-3.2 3.3-3.2h15.9c2.8 0 5.1 1.6 5.2 4.5v3.8c-0.1 2.9-2.2 4.8-4.9 4.9h-6.9v6.6h6.2c3 0.1 5.7 1.8 5.9 5.2v5.3c-0.2 1.6-1.2 3-3.3 3h-21.4v-30.1zM71.2 76.2h17.8c0.4 0 0.6-0.2 0.7-0.5v-4.6c-0.1-1.5-1.2-2.6-3-2.6h-9.1v-12.7h9.6c1.2 0 2-0.7 2.1-1.8v-3.5c0-1.1-0.9-1.9-2.1-1.9h-15.4c-0.4 0-0.7 0.3-0.6 0.7v26.9z"/>
</svg>`;

const IDES = [
  "CLAUDE CODE",
  "CURSOR",
  "CODEX",
  "CONTINUE",
  "COPILOT",
  "OPENCODE",
  "GOOSE",
  "CLINE",
];

const DATA_TOKENS = [
  "+$0.42",
  "12 PR",
  "2.1k tok",
  "ACCEPT",
  "GREEN",
  "+18 ed",
  "$3.20/h",
  "MERGE",
];

type RingSpec = {
  text: string;
  fontPx: number;
  color: string;
  letterSpacing: number;
  planeSize: number;
  tiltX: number;
  tiltZ: number;
  opacity: number;
  speed: number;
};

function makeCircularTextTexture({
  text,
  fontPx,
  color,
  letterSpacing,
}: {
  text: string;
  fontPx: number;
  color: string;
  letterSpacing: number;
}) {
  const size = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.44;

  ctx.font = `700 ${fontPx}px 'Space Mono', ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + letterSpacing);

  let angle = 0;
  // Repeat text around the ring until we've covered 2π.
  for (let guard = 0; guard < 4000 && angle < Math.PI * 2; guard++) {
    for (let i = 0; i < chars.length && angle < Math.PI * 2; i++) {
      const step = widths[i] / radius;
      const a = angle + step / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(chars[i], 0, 0);
      ctx.restore();
      angle += step;
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeLabelTexture(
  text: string,
  {
    fontPx,
    color,
    bg,
    pad,
  }: { fontPx: number; color: string; bg?: string; pad: number },
) {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return new THREE.CanvasTexture(document.createElement("canvas"));
  measure.font = `700 ${fontPx}px 'Space Mono', ui-monospace, monospace`;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  if (bg) {
    ctx.fillStyle = bg;
    const r = Math.min(h / 2, 14);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = `700 ${fontPx}px 'Space Mono', ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, w, h };
}

export function BrandMonolithMax() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.set(0, 0.6, 23);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    // ── B monogram ───────────────────────────────────────────
    const svgData = new SVGLoader().parse(LOGO_SVG);
    const shapes: THREE.Shape[] = [];
    for (const p of svgData.paths) {
      for (const s of SVGLoader.createShapes(p)) shapes.push(s);
    }
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: 7.5,
      bevelEnabled: true,
      bevelThickness: 0.72,
      bevelSize: 0.58,
      bevelOffset: 0,
      bevelSegments: 12,
      curveSegments: 36,
    });
    geometry.center();

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#6e8a6f"),
      metalness: 0.18,
      roughness: 0.18,
      transmission: 0.42,
      thickness: 3.6,
      ior: 1.5,
      attenuationColor: new THREE.Color("#0f1a10"),
      attenuationDistance: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.1,
    });

    const bMesh = new THREE.Mesh(geometry, material);
    bMesh.rotation.x = Math.PI;
    const bGroup = new THREE.Group();
    bGroup.add(bMesh);
    bGroup.scale.setScalar(0.215);
    scene.add(bGroup);

    // ── Orbital text rings ────────────────────────────────────
    const ringSpecs: RingSpec[] = [
      {
        text: "AI SPEND · GIT OUTCOMES · ACCEPTED EDITS · MERGED PRS · VELOCITY · ",
        fontPx: 70,
        color: "rgba(110,138,111,0.95)",
        letterSpacing: 18,
        planeSize: 18,
        tiltX: -Math.PI / 2.15,
        tiltZ: 0.08,
        opacity: 0.95,
        speed: 0.06,
      },
      {
        text: "CLAUDE CODE · CURSOR · CODEX · CONTINUE · OPENCODE · COPILOT · GOOSE · ",
        fontPx: 50,
        color: "rgba(176,123,62,0.85)",
        letterSpacing: 12,
        planeSize: 23,
        tiltX: -Math.PI / 3.0,
        tiltZ: -0.12,
        opacity: 0.7,
        speed: -0.04,
      },
      {
        text: "$ · PR · TOKENS · COMMITS · ACCEPT · REVERT · GREEN · MERGE · ",
        fontPx: 42,
        color: "rgba(234,243,229,0.4)",
        letterSpacing: 10,
        planeSize: 14,
        tiltX: -Math.PI / 2.7,
        tiltZ: 0.2,
        opacity: 0.55,
        speed: 0.1,
      },
    ];

    const rings: { mesh: THREE.Mesh; speed: number }[] = [];
    for (const spec of ringSpecs) {
      const tex = makeCircularTextTexture({
        text: spec.text,
        fontPx: spec.fontPx,
        color: spec.color,
        letterSpacing: spec.letterSpacing,
      });
      const ringMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ringGeom = new THREE.PlaneGeometry(spec.planeSize, spec.planeSize);
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.rotation.x = spec.tiltX;
      ringMesh.rotation.z = spec.tiltZ;
      scene.add(ringMesh);
      rings.push({ mesh: ringMesh, speed: spec.speed });
    }

    // ── IDE constellation nodes + connection lines ───────────
    const constellation = new THREE.Group();
    const ringRadius = 9.5;
    const orbitTilt = 0.28;
    type Node = {
      sprite: THREE.Sprite;
      line: THREE.Line;
      lineMat: THREE.LineBasicMaterial;
      basePos: THREE.Vector3;
      phase: number;
    };
    const nodes: Node[] = [];

    IDES.forEach((name, i) => {
      const a = (i / IDES.length) * Math.PI * 2;
      const x = Math.cos(a) * ringRadius;
      const z = Math.sin(a) * ringRadius;
      const y = Math.sin(a) * ringRadius * orbitTilt;

      const { tex, w, h } = makeLabelTexture(name, {
        fontPx: 38,
        color: "rgba(234,243,229,0.92)",
        bg: "rgba(16,22,16,0.72)",
        pad: 18,
      });
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const aspect = w / h;
      const spriteH = 0.9;
      sprite.scale.set(spriteH * aspect, spriteH, 1);
      sprite.position.set(x, y, z);
      constellation.add(sprite);

      const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color("#6e8a6f"),
        transparent: true,
        opacity: 0.15,
      });
      const line = new THREE.Line(lineGeom, lineMat);
      constellation.add(line);

      nodes.push({
        sprite,
        line,
        lineMat,
        basePos: new THREE.Vector3(x, y, z),
        phase: (i / IDES.length) * Math.PI * 2,
      });
    });
    scene.add(constellation);

    // ── Data token orbit ─────────────────────────────────────
    const tokenGroup = new THREE.Group();
    tokenGroup.rotation.x = -0.35;
    type Token = { sprite: THREE.Sprite; radius: number; phase: number; speed: number };
    const tokens: Token[] = [];
    const tokenRadii = [5.2, 6.1, 5.6, 6.6, 5.9, 6.3, 5.4, 6.0];
    DATA_TOKENS.forEach((t, i) => {
      const { tex, w, h } = makeLabelTexture(t, {
        fontPx: 30,
        color: "rgba(176,123,62,0.95)",
        bg: "rgba(16,22,16,0.78)",
        pad: 12,
      });
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      const aspect = w / h;
      const sH = 0.55;
      sprite.scale.set(sH * aspect, sH, 1);
      tokenGroup.add(sprite);
      tokens.push({
        sprite,
        radius: tokenRadii[i] ?? 5.8,
        phase: (i / DATA_TOKENS.length) * Math.PI * 2,
        speed: 0.18 + (i % 3) * 0.04,
      });
    });
    scene.add(tokenGroup);

    // ── Backdrop glow ────────────────────────────────────────
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 1024;
    const gctx = glowCanvas.getContext("2d");
    if (gctx) {
      const grad = gctx.createRadialGradient(512, 512, 0, 512, 512, 512);
      grad.addColorStop(0, "rgba(110,138,111,0.55)");
      grad.addColorStop(0.35, "rgba(110,138,111,0.18)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 1024, 1024);
    }
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), glowMat);
    glowMesh.position.z = -4;
    scene.add(glowMesh);

    // ── Lights ───────────────────────────────────────────────
    const key = new THREE.DirectionalLight(new THREE.Color("#eaf3e5"), 1.5);
    key.position.set(-6, 8, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color("#b07b3e"), 2.6);
    rim.position.set(9, -4, -6);
    scene.add(rim);
    const ambient = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambient);
    const back = new THREE.PointLight(new THREE.Color("#6e8a6f"), 1.4, 45, 1.6);
    back.position.set(0, 3, -12);
    scene.add(back);

    // ── Interaction state ────────────────────────────────────
    const s = {
      dragging: false,
      lastX: 0,
      lastY: 0,
      targetYaw: 0,
      targetPitch: 0,
      yaw: 0,
      pitch: 0,
      yawVel: 0,
      pitchVel: 0,
      parallaxX: 0,
      parallaxY: 0,
      lastInteract: performance.now(),
    };

    const onDown = (e: PointerEvent) => {
      s.dragging = true;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.lastInteract = performance.now();
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      if (!s.dragging) return;
      s.dragging = false;
      const twoPi = Math.PI * 2;
      s.yaw = ((((s.yaw + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
      s.targetYaw = 0;
      s.targetPitch = 0;
      canvas.style.cursor = "grab";
      try {
        canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      s.parallaxX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      s.parallaxY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      if (s.dragging) {
        const dx = e.clientX - s.lastX;
        const dy = e.clientY - s.lastY;
        s.targetYaw += dx * 0.008;
        s.targetPitch += dy * 0.008;
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        s.lastInteract = performance.now();
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointermove", onMove);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let isVisible = true;
    let isOnScreen = true;
    const onVis = () => {
      isVisible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVis);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) isOnScreen = e.isIntersecting;
      },
      { threshold: 0 },
    );
    io.observe(container);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!isVisible || !isOnScreen) return;
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();

      const idle = performance.now() - s.lastInteract > 500;
      if (!prefersReducedMotion && !s.dragging && idle) {
        s.targetYaw += 0.003;
      }

      if (s.dragging) {
        s.yaw += (s.targetYaw - s.yaw) * 0.25;
        s.pitch += (s.targetPitch - s.pitch) * 0.25;
        s.yawVel = 0;
        s.pitchVel = 0;
      } else {
        const stiffness = 0.022;
        const damping = 0.9;
        s.yawVel = s.yawVel * damping + (s.targetYaw - s.yaw) * stiffness;
        s.pitchVel =
          s.pitchVel * damping + (s.targetPitch - s.pitch) * stiffness;
        s.yaw += s.yawVel;
        s.pitch += s.pitchVel;
      }

      bGroup.rotation.y = s.yaw + s.parallaxX * 0.18;
      bGroup.rotation.x = s.pitch + s.parallaxY * 0.12;

      if (!prefersReducedMotion) {
        bGroup.position.y = Math.sin(t * 0.55) * 0.22;
        bGroup.position.x = Math.cos(t * 0.4) * 0.08;

        for (const r of rings) {
          r.mesh.rotation.z += r.speed * dt;
        }

        constellation.rotation.y = t * 0.07 + s.parallaxX * 0.3;
        constellation.rotation.x = s.parallaxY * 0.15;
        for (const n of nodes) {
          const pulse = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t * 1.4 + n.phase));
          n.lineMat.opacity = pulse;
          const nodePulse = 0.82 + 0.18 * Math.sin(t * 1.6 + n.phase);
          n.sprite.material.opacity = nodePulse;
          n.sprite.material.needsUpdate = false;
        }

        tokenGroup.rotation.y = -t * 0.12;
        for (const tk of tokens) {
          const angle = tk.phase + t * tk.speed;
          tk.sprite.position.set(
            Math.cos(angle) * tk.radius,
            Math.sin(angle * 2) * 0.4,
            Math.sin(angle) * tk.radius,
          );
          // Fade tokens crossing behind the B (far side).
          const frontFactor = 0.5 + 0.5 * Math.sin(angle);
          tk.sprite.material.opacity = 0.35 + 0.6 * frontFactor;
        }

        back.intensity = 1.1 + Math.sin(t * 1.3) * 0.35;
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointermove", onMove);
      geometry.dispose();
      material.dispose();
      for (const r of rings) {
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material & { map?: THREE.Texture }).map?.dispose();
        (r.mesh.material as THREE.Material).dispose();
      }
      for (const n of nodes) {
        n.sprite.material.map?.dispose();
        n.sprite.material.dispose();
        n.line.geometry.dispose();
        n.lineMat.dispose();
      }
      for (const tk of tokens) {
        tk.sprite.material.map?.dispose();
        tk.sprite.material.dispose();
      }
      glowMesh.geometry.dispose();
      glowMat.dispose();
      glowTex.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return (
    <section
      className="mk-monolith mk-monolith-max"
      aria-label="Bematist brand mark — mission control"
    >
      <div className="mk-monolith-max-backdrop" aria-hidden="true" />
      <div className="mk-monolith-max-stage">
        <div ref={containerRef} className="mk-monolith-max-canvas" />
      </div>
      <div className="mk-monolith-copy">
        <span className="mk-mono mk-xs">02 / Mission control</span>
        <p className="mk-monolith-max-lede">
          One instrument. Every agent, every dollar, every merge — orbiting a
          single truth.
        </p>
      </div>
    </section>
  );
}
