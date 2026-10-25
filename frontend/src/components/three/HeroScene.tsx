import { Float, Line, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export default function HeroScene() {
  return (
    <Canvas camera={{ position: [0, 2.2, 13], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#03060c"]} />
      <fog attach="fog" args={["#03060c", 12, 34]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 6, 6]} intensity={90} color="#7dd3fc" />
      <Stars radius={70} depth={30} count={1800} factor={3} fade speed={0.5} />
      <ResponsiveGlobe />
      <TideField />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={1.2} luminanceThreshold={0.15} />
      </EffectComposer>
    </Canvas>
  );
}

/** Sits beside the headline on wide screens, behind it (dimmer) on narrow ones. */
function ResponsiveGlobe() {
  const width = useThree((s) => s.viewport.width);
  const wide = width > 14;
  return (
    <group position={[wide ? width * 0.24 : 0, wide ? 0 : 1.5, wide ? 0 : -4]} scale={wide ? 1 : 0.85}>
      <Float speed={1.2} rotationIntensity={0.25} floatIntensity={0.6}>
        <NetworkGlobe />
      </Float>
    </group>
  );
}

/** Points on a sphere joined to nearest neighbours; a red cascade wave sweeps across it. */
function NetworkGlobe() {
  const group = useRef<THREE.Group>(null);
  const nodes = useRef<THREE.InstancedMesh>(null);
  const { points, links } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const n = 64;
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const th = i * Math.PI * (3 - Math.sqrt(5));
      pts.push(new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad).multiplyScalar(3.2));
    }
    const ls: [THREE.Vector3, THREE.Vector3][] = [];
    pts.forEach((p, i) => {
      pts
        .map((q, j) => ({ j, d: p.distanceTo(q) }))
        .filter((x) => x.j > i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ j }) => ls.push([p, pts[j]]));
    });
    return { points: pts, links: ls };
  }, []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const origin = useMemo(() => points[7].clone().normalize(), [points]);

  useFrame(({ clock }, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.12;
    const mesh = nodes.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    const front = (t * 0.45) % 2.4; // angular distance the cascade has travelled
    points.forEach((p, i) => {
      const ang = origin.angleTo(p.clone().normalize());
      const hit = Math.max(0, 1 - Math.abs(ang - front) * 3);
      dummy.position.copy(p);
      dummy.scale.setScalar(0.06 + hit * 0.09);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set("#67e8f9").lerp(new THREE.Color("#ff3d6e"), hit);
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group} position={[0, 1.2, 0]}>
      <mesh>
        <icosahedronGeometry args={[3.05, 3]} />
        <meshBasicMaterial color="#0ea5e9" wireframe transparent opacity={0.06} />
      </mesh>
      {links.map(([a, b], i) => (
        <Line key={i} points={[a, b]} color="#38bdf8" lineWidth={0.8} transparent opacity={0.28} />
      ))}
      <instancedMesh ref={nodes} args={[undefined, undefined, points.length]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** A rolling particle ocean beneath the globe. */
function TideField() {
  const ref = useRef<THREE.Points>(null);
  const cols = 120;
  const rows = 60;
  const positions = useMemo(() => {
    const arr = new Float32Array(cols * rows * 3);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const k = (i * rows + j) * 3;
        arr[k] = (i - cols / 2) * 0.32;
        arr[k + 1] = -3.2;
        arr[k + 2] = (j - rows / 2) * 0.32 - 4;
      }
    return arr;
  }, []);
  useFrame(({ clock }) => {
    const pts = ref.current;
    if (!pts) return;
    const t = clock.getElapsedTime();
    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const k = i * rows + j;
        const x = pos.getX(k);
        const z = pos.getZ(k);
        pos.setY(k, -3.4 + Math.sin(x * 0.35 + t * 0.9) * 0.35 + Math.cos(z * 0.45 + t * 0.6) * 0.3);
      }
    pos.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#38bdf8" size={0.045} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}
