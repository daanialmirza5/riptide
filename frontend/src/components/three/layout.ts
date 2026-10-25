import * as THREE from "three";
import type { Topology } from "../../lib/types";

const APP_ORDER = [
  "auth",
  "user-profile",
  "catalog",
  "recommendation",
  "search",
  "cart",
  "inventory",
  "checkout",
  "payment",
  "orders",
  "shipping",
  "notification",
];

/**
 * Layered 3D layout: edge tier on top, application ring in the middle, data
 * tier below. Data nodes sit at the circular mean of their callers' angles so
 * edges stay short and readable.
 */
export function computeLayout(topo: Topology): Record<string, THREE.Vector3> {
  const pos: Record<string, THREE.Vector3> = {};
  const angle: Record<string, number> = {};
  const apps = [
    ...APP_ORDER.filter((id) => topo.services.some((s) => s.id === id)),
    ...topo.services.filter((s) => s.tier === 1 && !APP_ORDER.includes(s.id)).map((s) => s.id),
  ];
  apps.forEach((id, i) => {
    const a = (i / apps.length) * Math.PI * 2;
    angle[id] = a;
    pos[id] = new THREE.Vector3(Math.cos(a) * 9, 0, Math.sin(a) * 9);
  });

  const edge = topo.services.filter((s) => s.tier === 0);
  edge.forEach((s, i) => {
    pos[s.id] = new THREE.Vector3(0, 9 - i * 3.6, 0);
  });

  const data = topo.services.filter((s) => s.tier === 2);
  const want: { id: string; a: number }[] = data.map((s) => {
    const callers = topo.edges.filter((e) => e.target === s.id && angle[e.source] !== undefined);
    let x = 0;
    let y = 0;
    for (const c of callers) {
      x += Math.cos(angle[c.source]) * c.weight;
      y += Math.sin(angle[c.source]) * c.weight;
    }
    return { id: s.id, a: callers.length ? Math.atan2(y, x) : 0 };
  });
  // spread data nodes evenly in the order of their preferred angles
  want.sort((p, q) => p.a - q.a);
  const offset = want.length ? want[0].a : 0;
  want.forEach((w, i) => {
    const a = offset + (i / want.length) * Math.PI * 2;
    angle[w.id] = a;
    pos[w.id] = new THREE.Vector3(Math.cos(a) * 5.4, -6.5, Math.sin(a) * 5.4);
  });
  return pos;
}

export function edgeCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = a.distanceTo(b) * 0.12;
  mid.add(new THREE.Vector3(mid.x * 0.12, lift, mid.z * 0.12));
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}
