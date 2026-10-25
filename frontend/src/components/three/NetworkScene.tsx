import { Html, Line, OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { riskColor, secs, STATUS_COLOR } from "../../lib/format";
import { useStore } from "../../lib/store";
import type { ServiceSpec, Topology } from "../../lib/types";
import { computeLayout, edgeCurve } from "./layout";

const PARTICLES_PER_EDGE = 4;

export default function NetworkScene() {
  const topology = useStore((s) => s.topology);
  return (
    <Canvas camera={{ position: [0, 7, 33], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
      <color attach="background" args={["#03060c"]} />
      <fog attach="fog" args={["#03060c", 30, 62]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 16, 8]} intensity={140} color="#7dd3fc" />
      <pointLight position={[0, -14, -6]} intensity={80} color="#a78bfa" />
      <Stars radius={90} depth={40} count={2600} factor={3.2} saturation={0} fade speed={0.6} />
      <Suspense fallback={null}>{topology && <Graph topology={topology} />}</Suspense>
      <Scaffold />
      <CameraRig topology={topology} />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.22} luminanceSmoothing={0.3} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}

function Scaffold() {
  const rings = useMemo(
    () =>
      [
        { r: 9, y: 0 },
        { r: 5.4, y: -6.5 },
      ].map(({ r, y }) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 128; i++) {
          const a = (i / 128) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        return pts;
      }),
    [],
  );
  return (
    <group>
      {rings.map((pts, i) => (
        <Line key={i} points={pts} color="#1e3a5f" lineWidth={1} transparent opacity={0.55} dashed dashSize={0.4} gapSize={0.3} />
      ))}
      <polarGridHelper args={[22, 16, 10, 96, "#0f2440", "#0b1a30"]} position={[0, -10, 0]} />
    </group>
  );
}

function CameraRig({ topology }: { topology: Topology | null }) {
  const selected = useStore((s) => s.selected);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const layout = useMemo(() => (topology ? computeLayout(topology) : null), [topology]);
  // resting target sits below the graph's centre so it clears the bottom panels
  const goal = useRef(new THREE.Vector3(0, -3, 0));
  useEffect(() => {
    goal.current.copy(selected && layout?.[selected] ? layout[selected] : new THREE.Vector3(0, -3, 0));
    if (controls) controls.autoRotate = !selected;
  }, [selected, layout, controls]);
  useFrame(() => {
    if (!controls) return;
    controls.target.lerp(goal.current, 0.06);
    controls.update();
  });
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={42}
      autoRotate
      autoRotateSpeed={0.35}
      maxPolarAngle={Math.PI * 0.82}
    />
  );
}

function Graph({ topology }: { topology: Topology }) {
  const layout = useMemo(() => computeLayout(topology), [topology]);
  const curves = useMemo(
    () => topology.edges.map((e) => ({ edge: e, curve: edgeCurve(layout[e.source], layout[e.target]) })),
    [topology, layout],
  );
  return (
    <group>
      {curves.map(({ edge, curve }) => (
        <EdgeLine key={`${edge.source}>${edge.target}`} source={edge.source} target={edge.target} weight={edge.weight} curve={curve} />
      ))}
      <TrafficParticles curves={curves} />
      <PropagationPulses curves={curves} />
      {topology.services.map((s) => (
        <ServiceNode key={s.id} spec={s} position={layout[s.id]} />
      ))}
    </group>
  );
}

function EdgeLine({ source, target, weight, curve }: { source: string; target: string; weight: number; curve: THREE.QuadraticBezierCurve3 }) {
  const callee = useStore((s) => s.services[target]);
  const caller = useStore((s) => s.services[source]);
  const selected = useStore((s) => s.selected);
  const mode = useStore((s) => s.viewMode);
  const whatifEdge = useStore((s) => {
    const hit = s.whatif?.impacted.filter((x) => x.failedAt !== null).map((x) => x.service) ?? [];
    return hit.includes(source) && hit.includes(target);
  });
  const points = useMemo(() => curve.getPoints(32), [curve]);
  const hot = callee && (callee.status === "critical" || callee.status === "down");
  const predicted = caller?.via === target || whatifEdge;
  const color = whatifEdge
    ? "#e879f9"
    : hot
    ? STATUS_COLOR[callee.status]
    : predicted
      ? "#a78bfa"
      : mode === "risk" && callee
        ? riskColor(callee.risk)
        : callee && callee.status === "degraded"
          ? "#fbbf24"
          : "#2b6cb0";
  const focus = selected === null || selected === source || selected === target;
  const opacity = focus ? (hot || predicted ? 0.95 : 0.22 + weight * 0.3) : 0.06;
  return <Line points={points} color={color} lineWidth={hot || predicted ? 2.2 : 1 + weight} transparent opacity={opacity} />;
}

type CurveEntry = { edge: { source: string; target: string; weight: number }; curve: THREE.QuadraticBezierCurve3 };

/** Requests flowing caller → callee. Speed tracks load; red share tracks error rate. */
function TrafficParticles({ curves }: { curves: CurveEntry[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = curves.length * PARTICLES_PER_EDGE;
  const phases = useMemo(() => Array.from({ length: count }, () => Math.random()), [count]);
  const errs = useMemo(() => Array.from({ length: count }, () => Math.random()), [count]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const { services, selected } = useStore.getState();
    curves.forEach(({ edge, curve }, ei) => {
      const caller = services[edge.source];
      const callee = services[edge.target];
      const speed = 0.12 + Math.min(caller ? caller.rps / 2500 : 0.2, 0.6) * 0.5;
      const dead = !callee || callee.status === "down";
      const dim = selected !== null && selected !== edge.source && selected !== edge.target;
      for (let k = 0; k < PARTICLES_PER_EDGE; k++) {
        const i = ei * PARTICLES_PER_EDGE + k;
        phases[i] = (phases[i] + delta * speed) % 1;
        curve.getPoint(phases[i], tmp);
        dummy.position.copy(tmp);
        const s = dim ? 0.0 : dead ? 0.05 : 0.075;
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const failing = callee ? errs[i] < callee.errorRate / 100 + (dead ? 1 : 0) : false;
        color.set(failing ? "#ff4d6d" : "#67e8f9");
        mesh.setColorAt(i, color);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

/** Failure travelling callee → caller (red) and predicted cascade paths (violet). */
function PropagationPulses({ curves }: { curves: CurveEntry[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = curves.length * 2;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => (i % 2) * 0.5), [count]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const { services } = useStore.getState();
    const t = clock.getElapsedTime();
    curves.forEach(({ edge, curve }, ei) => {
      const caller = services[edge.source];
      const callee = services[edge.target];
      const failing = callee && (callee.status === "critical" || callee.status === "down") && edge.weight >= 0.35;
      const predicted = caller?.via === edge.target;
      for (let k = 0; k < 2; k++) {
        const i = ei * 2 + k;
        const active = failing || predicted;
        const p = 1 - ((t * (failing ? 0.55 : 0.35) + offsets[i]) % 1); // reverse direction
        curve.getPoint(p, tmp);
        dummy.position.copy(tmp);
        dummy.scale.setScalar(active ? 0.17 + 0.05 * Math.sin(t * 8 + i) : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.set(failing ? "#ff2e55" : "#b794ff");
        mesh.setColorAt(i, color);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function NodeGeometry({ kind, r }: { kind: ServiceSpec["kind"]; r: number }) {
  switch (kind) {
    case "edge":
      return <octahedronGeometry args={[r * 1.15, 0]} />;
    case "data":
      return <cylinderGeometry args={[r * 0.85, r * 0.85, r * 1.3, 32]} />;
    case "external":
      return <dodecahedronGeometry args={[r, 0]} />;
    default:
      return <icosahedronGeometry args={[r, 2]} />;
  }
}

function ServiceNode({ spec, position }: { spec: ServiceSpec; position: THREE.Vector3 }) {
  const state = useStore((s) => s.services[spec.id]);
  const selected = useStore((s) => s.selected === spec.id);
  const anySelected = useStore((s) => s.selected !== null);
  const mode = useStore((s) => s.viewMode);
  const select = useStore((s) => s.select);
  const whatifHit = useStore((s) => s.whatif?.impacted.find((x) => x.service === spec.id && x.failedAt !== null) ?? null);
  const [hover, setHover] = useState(false);
  const whatRing = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const shock = useRef<THREE.Mesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const target = useMemo(() => new THREE.Color(), []);

  const r = 0.42 + spec.importance * 0.32;
  const status = state?.status ?? "healthy";
  const risk = state?.risk ?? 0;
  const base = mode === "risk" ? riskColor(risk) : STATUS_COLOR[status];
  const riskArc = Math.max(0.001, Math.min(risk, 1)) * Math.PI * 2;
  const riskKey = Math.round(risk * 50);

  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
  }, [hover]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const alarm = status === "critical" || status === "down";
    if (core.current) {
      const mat = core.current.material as THREE.MeshStandardMaterial;
      target.set(base);
      mat.color.lerp(target, 0.08);
      mat.emissive.lerp(target, 0.08);
      mat.emissiveIntensity = status === "down" ? 0.4 + 0.6 * Math.abs(Math.sin(t * 6)) : alarm ? 1.4 + 0.5 * Math.sin(t * 5) : 0.85;
      const pulse = alarm ? 1 + 0.06 * Math.sin(t * 7) : 1;
      core.current.scale.setScalar((selected ? 1.25 : hover ? 1.12 : 1) * pulse);
      core.current.rotation.y += delta * (state?.restarting ? 3 : 0.25);
    }
    if (halo.current) {
      const mat = halo.current.material as THREE.MeshBasicMaterial;
      mat.color.lerp(target, 0.08);
      mat.opacity = 0.04 + Math.max(risk, state?.anomaly ?? 0) * 0.2 + (selected ? 0.08 : 0);
    }
    if (shock.current) {
      const cycle = (t * 0.8) % 1;
      shock.current.visible = alarm;
      shock.current.scale.setScalar(1 + cycle * 2.4);
      (shock.current.material as THREE.MeshBasicMaterial).opacity = (1 - cycle) * 0.55;
    }
    if (spinner.current) spinner.current.rotation.z += delta * 0.8;
    if (whatRing.current) {
      whatRing.current.rotation.y += delta * 1.6;
      whatRing.current.rotation.x = Math.PI / 2 + Math.sin(t * 1.3) * 0.35;
    }
  });

  const dim = anySelected && !selected;

  return (
    <group position={position}>
      <mesh
        ref={core}
        onClick={(e) => {
          e.stopPropagation();
          select(selected ? null : spec.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <NodeGeometry kind={spec.kind} r={r} />
        <meshStandardMaterial
          color={base}
          emissive={base}
          emissiveIntensity={0.85}
          roughness={0.25}
          metalness={0.35}
          transparent
          opacity={dim ? 0.35 : 1}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={halo}>
        <sphereGeometry args={[r * 1.55, 24, 24]} />
        <meshBasicMaterial color={base} transparent opacity={0.1} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={shock} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[r * 1.1, r * 1.25, 48]} />
        <meshBasicMaterial color={STATUS_COLOR.down} transparent opacity={0.5} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {risk > 0.05 && (
        <group ref={spinner} rotation-x={-Math.PI / 2}>
          <mesh key={riskKey}>
            <ringGeometry args={[r * 1.45, r * 1.6, 64, 1, 0, riskArc]} />
            <meshBasicMaterial color={riskColor(risk)} transparent opacity={0.95} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      )}
      {whatifHit && (
        <mesh ref={whatRing}>
          <torusGeometry args={[r * 2.05, 0.045, 8, 72]} />
          <meshBasicMaterial color="#e879f9" toneMapped={false} />
        </mesh>
      )}
      {state?.breaker && (
        <mesh rotation-x={Math.PI / 2}>
          <torusGeometry args={[r * 1.85, 0.03, 8, 64]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} />
        </mesh>
      )}
      <Html center position={[0, r + 0.95, 0]} distanceFactor={19} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <div className={`select-none whitespace-nowrap text-center transition-opacity ${dim ? "opacity-30" : "opacity-100"}`}>
          <div className="rounded-md bg-abyss-950/70 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-100 ring-1 ring-white/10 backdrop-blur">
            {spec.name}
          </div>
          {state && state.eta !== null && state.risk >= 0.5 && state.status !== "down" && (
            <div className="mt-1 rounded bg-violet-500/25 px-1.5 py-px font-mono text-[10px] text-violet-200 ring-1 ring-violet-400/40">
              fails in {secs(state.eta)}
            </div>
          )}
          {whatifHit && (
            <div className="mt-1 rounded bg-fuchsia-500/25 px-1.5 py-px font-mono text-[10px] text-fuchsia-100 ring-1 ring-fuchsia-400/50">
              what-if: fails +{whatifHit.failedAt}s
            </div>
          )}
          {state?.status === "down" && (
            <div className="mt-1 rounded bg-rose-500/30 px-1.5 py-px font-mono text-[10px] font-semibold text-rose-100 ring-1 ring-rose-400/50">
              {state.restarting ? "RESTARTING" : "DOWN"}
            </div>
          )}
          {hover && state && (
            <div className="mt-1 rounded-md bg-abyss-900/90 px-2 py-1 text-left font-mono text-[10px] leading-4 text-slate-300 ring-1 ring-white/10">
              <div>health {(state.health * 100).toFixed(0)}% · risk {(state.risk * 100).toFixed(0)}%</div>
              <div>p99 {Math.round(state.latency)}ms · err {state.errorRate.toFixed(1)}%</div>
              <div>cpu {state.cpu.toFixed(0)}% · mem {state.memory.toFixed(0)}%</div>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
