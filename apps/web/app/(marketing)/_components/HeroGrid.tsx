"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * HeroGrid. Full-width rotating wireframe lattice.
 *
 * Performance notes:
 * - Single BufferGeometry of ~5k line segments (cheap on GPU; no instanced draws needed).
 * - Pixel ratio capped at min(devicePixelRatio, 2). Above that gives no visual win on 4k screens.
 * - RAF paused when tab is hidden (Page Visibility API) and when the canvas is off-screen
 *   (IntersectionObserver). Prevents the hero from burning GPU cycles below the fold.
 * - `prefers-reduced-motion`: renders a single frame then freezes.
 * - Resize handled via ResizeObserver on the host container (not window) so sidebar / zoom
 *   changes re-fit correctly.
 */
export function HeroGrid() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 1000);
    camera.position.set(18, 6, 30);
    camera.lookAt(0, 0, 0);

    // ─── Wireframe lattice ─────────────────────────────────────────
    const size = 15;
    const step = 3;
    const positions: number[] = [];
    for (let x = -size; x <= size; x += step) {
      for (let y = -size; y <= size; y += step) {
        for (let z = -size; z <= size; z += step) {
          if (x < size) positions.push(x, y, z, x + step, y, z);
          if (y < size) positions.push(x, y, z, x, y + step, z);
          if (z < size) positions.push(x, y, z, x, y, z + step);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0x6e8a6f,
      transparent: true,
      opacity: 0.18,
    });
    const lattice = new THREE.LineSegments(geometry, material);
    scene.add(lattice);

    // Subtle center glow point for depth
    const coreGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x6e8a6f,
      transparent: true,
      opacity: 0.6,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // ─── Sizing ────────────────────────────────────────────────────
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

    // ─── Visibility gating ─────────────────────────────────────────
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

    // ─── Animation loop ────────────────────────────────────────────
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!isVisible || !isOnScreen || prefersReducedMotion) {
        // Skip work but keep RAF alive so we resume cleanly.
        if (prefersReducedMotion) {
          renderer.render(scene, camera);
          cancelAnimationFrame(raf);
          return;
        }
        return;
      }
      lattice.rotation.x += 0.0009;
      lattice.rotation.y += 0.0016;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      ro.disconnect();
      io.disconnect();
      geometry.dispose();
      material.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []);

  return <div ref={containerRef} className="mk-hero-canvas" aria-hidden />;
}
