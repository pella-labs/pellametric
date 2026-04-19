"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="57 34 48 64">
<path fill="#191718" fill-rule="evenodd" d="M58.2 49c0.4-6.4 5.6-12.6 12.6-12.9h18.6c7.4 0.1 12.8 5.7 12.8 13.3v5.1c-0.3 3.4-1.7 6.2-4.5 8.4 2.5 1.5 4.6 3.9 4.8 7.4v7.2c-0.4 5.7-4.6 10.9-11.5 11.3h-19.8v8.2h-13v-48zM61.3 49.5v44.4h6.7v-8.5h22.1c5.1 0 9-3.7 9.3-8.2v-6.4c-0.1-4.2-4.7-5.9-8.9-7.7 3.8-1.2 8.3-3.7 8.7-8.9v-4.7c-0.1-5-4.3-10.3-10.5-10.3h-17.1c-4.6 0-10 3.8-10.3 9.7v0.6zM68.1 48.9c0.1-2 1.4-3.2 3.3-3.2h15.9c2.8 0 5.1 1.6 5.2 4.5v3.8c-0.1 2.9-2.2 4.8-4.9 4.9h-6.9v6.6h6.2c3 0.1 5.7 1.8 5.9 5.2v5.3c-0.2 1.6-1.2 3-3.3 3h-21.4v-30.1zM71.2 76.2h17.8c0.4 0 0.6-0.2 0.7-0.5v-4.6c-0.1-1.5-1.2-2.6-3-2.6h-9.1v-12.7h9.6c1.2 0 2-0.7 2.1-1.8v-3.5c0-1.1-0.9-1.9-2.1-1.9h-15.4c-0.4 0-0.7 0.3-0.6 0.7v26.9z"/>
</svg>`;

export interface BMonogramProps {
  color?: string | number;
  attenuationColor?: string | number;
  rimColor?: string | number;
  keyColor?: string | number;
  backColor?: string | number;
  interactive?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  float?: boolean;
  scale?: number;
  className?: string;
  style?: CSSProperties;
}

export function BMonogram({
  color = "#6e8a6f",
  attenuationColor = "#0f1a10",
  rimColor = "#b07b3e",
  keyColor = "#eaf3e5",
  backColor = "#6e8a6f",
  interactive = true,
  autoRotate = true,
  autoRotateSpeed = 0.0035,
  float = true,
  scale = 1,
  className,
  style,
}: BMonogramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    if (interactive) {
      canvas.style.touchAction = "none";
      canvas.style.cursor = "grab";
    }
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    camera.position.set(0, 0, 24);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    const svgData = new SVGLoader().parse(LOGO_SVG);
    const shapes: THREE.Shape[] = [];
    for (const p of svgData.paths) {
      for (const s of SVGLoader.createShapes(p)) {
        shapes.push(s);
      }
    }
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: 8,
      bevelEnabled: true,
      bevelThickness: 0.85,
      bevelSize: 0.7,
      bevelOffset: 0,
      bevelSegments: 12,
      curveSegments: 36,
    });
    geometry.center();

    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color as THREE.ColorRepresentation),
      metalness: 0.18,
      roughness: 0.2,
      transmission: 0.42,
      thickness: 3.6,
      ior: 1.5,
      attenuationColor: new THREE.Color(attenuationColor as THREE.ColorRepresentation),
      attenuationDistance: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.05,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI;
    const group = new THREE.Group();
    group.add(mesh);
    group.scale.setScalar(0.175 * scale);
    scene.add(group);

    const key = new THREE.DirectionalLight(
      new THREE.Color(keyColor as THREE.ColorRepresentation),
      1.4,
    );
    key.position.set(-6, 8, 7);
    scene.add(key);

    const rim = new THREE.DirectionalLight(
      new THREE.Color(rimColor as THREE.ColorRepresentation),
      2.4,
    );
    rim.position.set(9, -4, -6);
    scene.add(rim);

    const ambient = new THREE.AmbientLight(0xffffff, 0.08);
    scene.add(ambient);

    const back = new THREE.PointLight(
      new THREE.Color(backColor as THREE.ColorRepresentation),
      1.4,
      40,
      1.6,
    );
    back.position.set(0, 3, -12);
    scene.add(back);

    // Passive specular sweep — a directional light that arcs across the B
    // once every 8s with a sin² intensity envelope so the highlight visibly
    // travels left→right, then fades out during the back half of the cycle.
    const sweep = new THREE.DirectionalLight(
      new THREE.Color(keyColor as THREE.ColorRepresentation),
      0,
    );
    scene.add(sweep);

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
      // Normalize yaw to the closest equivalent angle within ±π so the spring
      // takes the short way home instead of unwinding multiple turns.
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

    if (interactive) {
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("pointermove", onMove);
    }

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

      const idle = performance.now() - s.lastInteract > 500;
      if (autoRotate && !s.dragging && (idle || !interactive)) {
        s.targetYaw += autoRotateSpeed;
      }

      if (s.dragging) {
        s.yaw += (s.targetYaw - s.yaw) * 0.25;
        s.pitch += (s.targetPitch - s.pitch) * 0.25;
        s.yawVel = 0;
        s.pitchVel = 0;
      } else {
        // Spring back to resting z-plane with a gentle, drawn-out overshoot.
        const stiffness = 0.022;
        const damping = 0.9;
        s.yawVel = s.yawVel * damping + (s.targetYaw - s.yaw) * stiffness;
        s.pitchVel = s.pitchVel * damping + (s.targetPitch - s.pitch) * stiffness;
        s.yaw += s.yawVel;
        s.pitch += s.pitchVel;
      }

      group.rotation.y = s.yaw + s.parallaxX * 0.18;
      group.rotation.x = s.pitch + s.parallaxY * 0.12;

      if (float) {
        group.position.y = Math.sin(t * 0.55) * 0.28;
        group.position.x = Math.cos(t * 0.4) * 0.12;
      } else {
        group.position.set(0, 0, 0);
      }

      back.intensity = 1.1 + Math.sin(t * 1.3) * 0.35;

      // Specular sweep: 8-second cycle, one visible pass per cycle.
      const sweepPhase = t * 0.125 * Math.PI * 2;
      sweep.position.set(Math.sin(sweepPhase) * 12, 5, 6);
      const sweepEnvelope = Math.max(0, Math.sin(sweepPhase));
      sweep.intensity = sweepEnvelope * sweepEnvelope * 2.2;

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      io.disconnect();
      if (interactive) {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointermove", onMove);
      }
      geometry.dispose();
      material.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [
    color,
    attenuationColor,
    rimColor,
    keyColor,
    backColor,
    interactive,
    autoRotate,
    autoRotateSpeed,
    float,
    scale,
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", overflow: "hidden", ...style }}
    />
  );
}
