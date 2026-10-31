// Live 3D preview of the arena floor (three.js) used on the hub card.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const TILES = [
  { letter: 'A', color: 0xff5f76, x: -0.98, z: -0.82 },
  { letter: 'B', color: 0x4d8dff, x: 0.98, z: -0.82 },
  { letter: 'C', color: 0x35cf82, x: -0.98, z: 0.82 },
  { letter: 'D', color: 0xf3c33f, x: 0.98, z: 0.82 },
];

function letterTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 190px Outfit, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,255,255,.75)';
  ctx.shadowBlur = 26;
  ctx.fillText(letter, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export default function ArenaPreview3D({ className = '' }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x050c18, 7, 16);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 3.1, 5.3);
    camera.lookAt(0, 0.1, 0.2);

    scene.add(new THREE.AmbientLight(0x93c5ff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2.5, 6, 3);
    scene.add(key);
    const rimLeft = new THREE.PointLight(0x2f80ff, 45, 14);
    rimLeft.position.set(-3, 2.4, -1);
    scene.add(rimLeft);
    const rimRight = new THREE.PointLight(0x3fe0ff, 35, 14);
    rimRight.position.set(3, 2, 1.5);
    scene.add(rimRight);

    // arena floor + neon grid
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 8),
      new THREE.MeshStandardMaterial({ color: 0x081a2f, roughness: 0.92, metalness: 0.1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    scene.add(floor);

    const grid = new THREE.GridHelper(9, 18, 0x2a6f9e, 0x123249);
    grid.position.y = 0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);

    // answer tiles
    const disposables = [];
    for (const tile of TILES) {
      const geo = new THREE.BoxGeometry(1.82, 0.16, 1.52);
      const mat = new THREE.MeshStandardMaterial({
        color: tile.color,
        emissive: tile.color,
        emissiveIntensity: 0.45,
        roughness: 0.38,
        metalness: 0.22,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(tile.x, 0.05, tile.z);
      scene.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 })
      );
      edges.position.copy(mesh.position);
      scene.add(edges);

      const tex = letterTexture(tile.letter);
      const letter = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.72),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      letter.rotation.x = -Math.PI / 2;
      letter.position.set(tile.x, 0.145, tile.z);
      scene.add(letter);

      disposables.push(
        geo,
        mat,
        edges.geometry,
        edges.material,
        tex,
        letter.geometry,
        letter.material
      );
    }

    // glowing rim behind the arena
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.66, 64),
      new THREE.MeshBasicMaterial({
        color: 0x3fe0ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.01;
    scene.add(halo);
    disposables.push(halo.geometry, halo.material);

    let frame = 0;
    let raf = 0;
    const clock = new THREE.Clock();

    const resize = () => {
      const w = host.clientWidth || 320;
      const h = host.clientHeight || 200;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const animate = () => {
      const t = clock.getElapsedTime();
      camera.position.x = Math.sin(t * 0.22) * 0.45;
      camera.position.y = 3.05 + Math.sin(t * 0.4) * 0.05;
      camera.lookAt(0, 0.1, 0.2);
      rimRight.intensity = 30 + Math.sin(t * 1.6) * 12;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
      frame += 1;
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      disposables.forEach((d) => d.dispose?.());
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      void frame;
    };
  }, []);

  return <div ref={hostRef} className={`arena3d ${className}`} aria-hidden="true" />;
}
