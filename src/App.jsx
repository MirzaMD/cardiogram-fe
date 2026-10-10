import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Activity, HeartPulse, LayoutDashboard, ClipboardList, BrainCircuit, Network, Menu, X,
  Bell, Search, ChevronRight, ArrowUpRight, WifiOff, ShieldCheck, LogOut,
  Play, RefreshCw, CircleHelp, Check, AlertTriangle, Waves, LockKeyhole, Eye, EyeOff,
  MoreHorizontal, CircleCheck, LoaderCircle, UserRound
} from 'lucide-react';
import { LABELS, asRecords, validSpo2 } from './api';   // keep your existing label map + helpers
import './three-theme.css';

/* =====================================================================
   1. EDIT THESE
   ===================================================================== */
const DOCTOR_ID = 'doctor';
const DOCTOR_PASSWORD = 'cardio@2026';
const DOCTOR_PROFILE = { name: 'Dr. Maya Chen', email: 'doctor@cardioguard.demo', role: 'doctor' };

const API_KEY = 'paste-1ox23is046mmhb';                                    // <-- paste your edge API key here
const API_BASE_URL = 'https://api.mirzahussain.space'; // edge API (no trailing slash)

const CAPTURE_SECONDS = 20;            // countdown on the Overview page
const MIN_RECORDS_FOR_TRAINING = 50;   // local training needs MORE than this many records
const MIN_EDGE_DEVICES = 2;            // federated learning needs at least this many devices

/* =====================================================================
   1b. EDGE API CLIENT  (every request sends the x-api-key header)
   ===================================================================== */
async function request(method, path, { query, timeoutMs = 30000 } = {}) {
  if (!API_KEY) throw new Error('API_KEY is empty. Set it at the top of App.jsx.');
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}${qs}`, { method, headers: { 'x-api-key': API_KEY }, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const d = body?.detail;
      throw new Error(typeof d === 'string' ? d : d ? JSON.stringify(d) : `Request failed (${res.status}).`);
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The request timed out.');
    if (e instanceof TypeError) throw new Error(`The browser blocked the request to ${API_BASE_URL}. This is usually CORS: the server or proxy must answer the OPTIONS preflight (which carries x-api-key) without requiring the key. Check DevTools > Network.`);
    throw e;
  } finally { clearTimeout(timer); }
}

const api = {
  // GET /  — sanity check: the server must answer with status "online"
  health: async () => {
    const body = await request('GET', '/', { timeoutMs: 8000 });
    if (body?.status !== 'online') throw new Error('Edge API did not report online.');
    return body;
  },
  // POST /predict?duration_seconds=N
  predict: (seconds = 15) => request('POST', '/predict', { query: { duration_seconds: seconds }, timeoutMs: (seconds + 90) * 1000 }),
  // GET /data
  records: () => request('GET', '/data'),
  // PUT /true-label-update/{id}?true_label=N
  label: (id, trueLabel) => request('PUT', `/true-label-update/${id}`, { query: { true_label: trueLabel } }),
  // POST /local-train
  train: () => request('POST', '/local-train', { timeoutMs: 10 * 60 * 1000 }),
  // POST /aggregate-weights?timeout=120&poll=5
  aggregate: (timeout = 120, poll = 5) => request('POST', '/aggregate-weights', { query: { timeout, poll }, timeoutMs: (timeout + 60) * 1000 }),
};

/* =====================================================================
   2. SMALL HELPERS
   ===================================================================== */
const TONE_HEX = { green: 0x43d9a4, amber: 0xf3b65b, red: 0xff6d78, blue: 0x5aa9ff, violet: 0x9b8cff, neutral: 0x43d9c4, teal: 0x43d9c4 };
const toneHex = (t) => TONE_HEX[t] ?? TONE_HEX.neutral;
const labelOf = (k) => LABELS?.[k] || { name: 'Unknown', code: String(k), tone: 'neutral' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const isUnlabelled = (r) => r?.true_label == null || Number(r.true_label) === -1;

const windowsOf = (r) => {
  const e = r?.ecg_info;
  if (!Array.isArray(e) || !e.length) return [];
  const wins = typeof e[0] === 'number' ? [e] : e;
  return wins.map((w) => (Array.isArray(w) ? w.map(Number).filter(Number.isFinite) : [])).filter((w) => w.length);
};
const spoOf = (o) => {
  try { const v = validSpo2(o); return Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []; }
  catch { return []; }
};

// Raw MAX30102 PPG → { ir: [], red: [] }, all windows concatenated in order.
// Stored shape (current):  oxygen_info = [ { ir: [...], red: [...] }, { ir: [...], red: [...] }, ... ]
// Also tolerated:          a single { ir, red } object, or the older [window][sample][IR, RED] pairs.
const ppgOf = (o) => {
  const ir = [], red = [];
  const push = (a, b) => {
    a = Number(a); b = Number(b);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) { ir.push(a); red.push(b); }  // drop empty-sensor zeros
  };
  const wins = Array.isArray(o) ? o : o ? [o] : [];
  for (const w of wins) {
    if (!w) continue;
    if (!Array.isArray(w) && typeof w === 'object') {            // { ir: [...], red: [...] }
      const A = Array.isArray(w.ir) ? w.ir : [], B = Array.isArray(w.red) ? w.red : [];
      const n = Math.min(A.length, B.length);
      for (let i = 0; i < n; i++) push(A[i], B[i]);
    } else if (Array.isArray(w)) {
      if (typeof w[0] === 'number') push(w[0], w[1]);             // flat list of [IR, RED] pairs
      else for (const s of w) if (Array.isArray(s) && s.length >= 2) push(s[0], s[1]);  // window of pairs
    }
  }
  return { ir, red };
};

// DC = mean, AC = std-dev / peak-to-peak. R is the "ratio of ratios" used for SpO₂ estimation.
const ppgMetrics = (ir, red) => {
  const a = ecgStats(ir), b = ecgStats(red);
  if (!a || !b) return null;
  const R = a.sd > 0 && a.mean > 0 && b.mean > 0 ? (b.sd / b.mean) / (a.sd / a.mean) : null;
  return { ir: a, red: b, R, piIr: a.mean > 0 ? (a.p2p / a.mean) * 100 : null, piRed: b.mean > 0 ? (b.p2p / b.mean) * 100 : null };
};

const robustRange = (vals, q = 0.004) => {
  if (!vals.length) return [-1, 1];
  const s = Float32Array.from(vals).sort();
  let lo = s[Math.floor((s.length - 1) * q)];
  let hi = s[Math.ceil((s.length - 1) * (1 - q))];
  if (!(hi - lo > 1e-9)) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
};
const spo2Range = (vals) => [vals.length ? Math.min(85, Math.floor(Math.min(...vals) / 5) * 5) : 85, 100];
const spoTone = (v) => (v >= 95 ? 'green' : v >= 90 ? 'amber' : 'red');

function ecgStats(sig) {
  if (sig.length < 2) return null;
  let mn = Infinity, mx = -Infinity, s = 0;
  for (const v of sig) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
  const m = s / sig.length;
  let q = 0; for (const v of sig) q += (v - m) ** 2;
  const thr = mn + 0.6 * (mx - mn);
  let peaks = 0, last = -99;
  for (let i = 1; i < sig.length - 1; i++) {
    if (sig[i] > thr && sig[i] >= sig[i - 1] && sig[i] > sig[i + 1] && i - last > 20) { peaks++; last = i; }
  }
  return { n: sig.length, min: mn, max: mx, mean: m, sd: Math.sqrt(q / sig.length), p2p: mx - mn, peaks };
}

const gauss = (x, m, s, a) => a * Math.exp(-((x - m) ** 2) / (2 * s * s));
const synthEcg = (u) => {
  const p = ((u % 1) + 1) % 1;
  return gauss(p, 0.18, 0.025, 0.12) + gauss(p, 0.37, 0.008, -0.12) + gauss(p, 0.4, 0.009, 1) + gauss(p, 0.43, 0.01, -0.22) + gauss(p, 0.65, 0.05, 0.25);
};
const lubdub = (t, bpm = 72) => {
  const p = ((t * bpm) / 60) % 1;
  return Math.exp(-((p - 0.06) ** 2) / 0.0012) + 0.55 * Math.exp(-((p - 0.24) ** 2) / 0.0025);
};

/* =====================================================================
   3. THREE.JS TOOLKIT
   ===================================================================== */
function disposeScene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); });
  });
}

/** Mounts a WebGL renderer into a div, runs the loop, resizes, and cleans up. */
function useThree(build, props) {
  const hostRef = useRef(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { host.setAttribute('data-webgl', 'off'); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = 'cg-canvas';
    host.appendChild(canvas);
    const stage = build({ renderer, host, propsRef });
    const clock = new THREE.Clock();
    let raf = 0, alive = true;
    const resize = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      stage.resize?.(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const loop = () => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(clock.getDelta(), 0.1);
      stage.update(dt, clock.elapsedTime);
      renderer.render(stage.scene, stage.camera);
    };
    loop();
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      stage.dispose?.(); disposeScene(stage.scene);
      renderer.dispose(); renderer.forceContextLoss?.(); canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return hostRef;
}

function makeGlow() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeStars(count, radius, size, color = 0x7fdcd0) {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = radius * (0.4 + 0.6 * Math.random()), th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = r * Math.cos(ph); p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: makeGlow(), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
}

/** A heart made of glowing particles. */
function makeHeart(count = 3000, scale = 0.09, size = 0.075) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const c1 = new THREE.Color(0x43d9c4), c2 = new THREE.Color(0x5aa9ff), tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.3);
    const hx = 16 * Math.pow(Math.sin(t), 3);
    const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const depth = Math.sqrt(Math.max(0, 1 - r * r));
    pos[i * 3] = hx * r * scale; pos[i * 3 + 1] = (hy + 2.5) * r * scale; pos[i * 3 + 2] = (Math.random() * 2 - 1) * depth * 7 * scale;
    tmp.lerpColors(c1, c2, clamp((hy + 17) / 29 + (Math.random() - 0.5) * 0.25, 0, 1));
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size, map: makeGlow(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
}

function textSprite(text, color = '#e8f4f8', px = 54) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.font = `700 ${px}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, 64, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(1, 0.5, 1);
  return s;
}

/* ---------- Scene: login backdrop ---------- */
function buildLogin() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  let baseZ = 7.5; camera.position.set(0, 0, baseZ);
  scene.add(makeStars(1500, 20, 0.1));
  const heart = makeHeart(3400, 0.115, 0.09); scene.add(heart);
  const rings = [[3.3, 0x43d9c4, 0.4], [4.2, 0x9b8cff, 0.3], [5.1, 0x5aa9ff, 0.2]].map(([r, c, o], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 200), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o }));
    m.rotation.x = 1.1 + i * 0.35; m.rotation.y = i * 0.5; scene.add(m); return m;
  });
  const N = 260, rp = new Float32Array(N * 3), rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3).setUsage(THREE.DynamicDrawUsage));
  const ribbon = new THREE.Line(rg, new THREE.LineBasicMaterial({ color: 0x43d9c4, transparent: true, opacity: 0.7 }));
  ribbon.frustumCulled = false; scene.add(ribbon);
  const mouse = { x: 0, y: 0 };
  const onMove = (e) => { mouse.x = (e.clientX / window.innerWidth - 0.5) * 2; mouse.y = (e.clientY / window.innerHeight - 0.5) * 2; };
  window.addEventListener('pointermove', onMove);
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; baseZ = w / h < 0.8 ? 12 : w / h < 1.2 ? 9.5 : 7.5; camera.updateProjectionMatrix(); },
    update(dt, t) {
      heart.rotation.y = t * 0.25; heart.scale.setScalar(1 + 0.09 * lubdub(t, 66));
      rings.forEach((r, i) => { r.rotation.z += dt * (0.12 + i * 0.05) * (i % 2 ? -1 : 1); });
      for (let i = 0; i < N; i++) {
        const x = -10 + (20 * i) / (N - 1);
        rp[i * 3] = x; rp[i * 3 + 1] = -3.2 + 1.1 * synthEcg(x * 0.17 - t * 0.5); rp[i * 3 + 2] = -1;
      }
      rg.attributes.position.needsUpdate = true;
      camera.position.x += (mouse.x * 0.9 - camera.position.x) * dt * 2;
      camera.position.y += (-mouse.y * 0.6 - camera.position.y) * dt * 2;
      camera.position.z += (baseZ - camera.position.z) * dt * 3;
      camera.lookAt(0, 0, 0);
    },
    dispose() { window.removeEventListener('pointermove', onMove); }
  };
}

/* ---------- Scene: capture stage (heart + 20-tick countdown ring) ---------- */
function buildCapture({ propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.set(0, 0, 7.4);
  scene.add(makeStars(700, 14, 0.07));
  const heart = makeHeart(3000, 0.085, 0.075); scene.add(heart);
  const N = CAPTURE_SECONDS, R = 2.55;
  const cDim = new THREE.Color(0x1d3445), cTeal = new THREE.Color(0x43d9c4), cWhite = new THREE.Color(0xffffff), tmp = new THREE.Color();
  const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.36, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = Math.PI / 2 - (i / N) * Math.PI * 2;
    d.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); d.rotation.z = a - Math.PI / 2; d.updateMatrix();
    ticks.setMatrixAt(i, d.matrix); ticks.setColorAt(i, cDim);
  }
  scene.add(ticks);
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.05, 1), new THREE.MeshBasicMaterial({ color: 0x43d9c4, wireframe: true, transparent: true, opacity: 0.1 }));
  scene.add(shell);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.008, 8, 220), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.35 }));
  ring.rotation.x = 1.15; scene.add(ring);
  const orbiters = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: i === 1 ? 0x9b8cff : 0x43d9c4 }));
    scene.add(m); return m;
  });
  let sp = 0;
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.position.z = w / h < 0.9 ? 10 : 7.4; camera.updateProjectionMatrix(); },
    update(dt, t) {
      const P = propsRef.current, phase = P.phase || 'idle';
      sp += ((P.progress || 0) - sp) * Math.min(1, dt * 8);
      const bpm = phase === 'idle' ? 56 : phase === 'capturing' ? 72 + 46 * sp : 118;
      heart.scale.setScalar(1 + 0.1 * lubdub(t, bpm));
      heart.rotation.y = Math.sin(t * 0.35) * 0.7; heart.rotation.x = Math.sin(t * 0.27) * 0.12;
      shell.rotation.y += dt * 0.2; shell.rotation.x += dt * 0.1; ring.rotation.z -= dt * 0.15;
      const lit = phase === 'idle' ? 0 : phase === 'capturing' ? Math.floor((P.progress || 0) * N) : N;
      for (let i = 0; i < N; i++) {
        if (i < lit) ticks.setColorAt(i, cTeal);
        else if (i === lit && phase === 'capturing') ticks.setColorAt(i, tmp.lerpColors(cTeal, cWhite, 0.5 + 0.5 * Math.sin(t * 8)));
        else ticks.setColorAt(i, cDim);
      }
      ticks.instanceColor.needsUpdate = true;
      orbiters.forEach((o, i) => {
        const a = t * (0.6 + i * 0.25) + i * 2.1;
        o.position.set(Math.cos(a) * 3.15, Math.sin(a) * 3.15 * Math.cos(1.15), Math.sin(a) * 3.15 * Math.sin(1.15));
      });
    }
  };
}

/* ---------- Scene: signal scope (scrolling ECG / sweeping SpO2) ---------- */
function buildScope({ propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  const glowTex = makeGlow();
  const size = { w: 1, h: 1 };

  const gv = [];
  for (let i = 0; i <= 24; i++) gv.push(i / 24, 0, 0, i / 24, 1, 0);
  for (let j = 0; j <= 6; j++) gv.push(0, j / 6, 0, 1, j / 6, 0);
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gv, 3));
  scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x2f5266, transparent: true, opacity: 0.28 })));

  const thr = [0x43d9a4, 0xf3b65b].map((c) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]);
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: c, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.55 }));
    l.computeLineDistances(); l.visible = false; l.position.z = 0.1; scene.add(l); return l;
  });

  const DN = 70, dp = new Float32Array(DN * 3), dv = new Float32Array(DN);
  for (let i = 0; i < DN; i++) { dp[i * 3] = Math.random(); dp[i * 3 + 1] = Math.random(); dv[i] = 0.4 + Math.random(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  scene.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x7fdcd0, size: 4, sizeAttenuation: false, map: glowTex, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));

  const lineMat = (o) => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, ...o });
  const core = lineMat({ opacity: 1 }), thick = lineMat({ opacity: 0.8 }), glow = lineMat({ opacity: 0.2, blending: THREE.AdditiveBlending });
  const copies = [];
  const addCopy = (mat, px, py, z) => { const l = new THREE.Line(new THREE.BufferGeometry(), mat); l.frustumCulled = false; l.position.z = z; scene.add(l); copies.push({ l, px, py }); };
  addCopy(core, 0, 0, 0.3);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([x, y]) => addCopy(thick, x * 0.8, y * 0.8, 0.25));
  [[3, 0], [-3, 0], [0, 3], [0, -3], [2.2, 2.2], [-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2]].forEach(([x, y]) => addCopy(glow, x, y, 0.2));
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  fill.frustumCulled = false; fill.position.z = 0.05; scene.add(fill);

  let W = 0, lineGeo = null, fillGeo = null, pos, col, fpos, fcol;
  const alloc = (n) => {
    lineGeo?.dispose(); fillGeo?.dispose();
    W = n; pos = new Float32Array(n * 3); col = new Float32Array(n * 4); fpos = new Float32Array(n * 6); fcol = new Float32Array(n * 8);
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3).setUsage(THREE.DynamicDrawUsage));
    fillGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    fillGeo.setIndex(idx);
    copies.forEach((c) => { c.l.geometry = lineGeo; }); fill.geometry = fillGeo;
  };
  alloc(320);

  const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const headCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false }));
  headGlow.position.z = 0.6; headCore.position.z = 0.7; scene.add(headGlow, headCore);
  const bc = document.createElement('canvas'); bc.width = 64; bc.height = 4;
  const bg = bc.getContext('2d'), gr = bg.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.55)'); bg.fillStyle = gr; bg.fillRect(0, 0, 64, 4);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  bar.position.z = 0.15; bar.scale.set(0.12, 1, 1); scene.add(bar);

  const put = (i, x, y, a, r, g, b) => {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = 0;
    const c = i * 4; col[c] = r; col[c + 1] = g; col[c + 2] = b; col[c + 3] = a;
    const f = i * 6; fpos[f] = x; fpos[f + 1] = y; fpos[f + 2] = 0; fpos[f + 3] = x; fpos[f + 4] = 0; fpos[f + 5] = 0;
    const q = i * 8; fcol[q] = r; fcol[q + 1] = g; fcol[q + 2] = b; fcol[q + 3] = a * 0.2; fcol[q + 4] = r; fcol[q + 5] = g; fcol[q + 6] = b; fcol[q + 7] = 0;
  };

  let cursor = 0, sig = '', lo = -1, hi = 1, colorKey = null;
  const tint = new THREE.Color();
  return {
    scene, camera,
    resize(w, h) {
      size.w = w; size.h = h;
      copies.forEach((c) => c.l.position.set(c.px / w, c.py / h, c.l.position.z));
      headCore.scale.set(10 / w, 10 / h, 1);
    },
    update(dt, t) {
      const P = propsRef.current, mode = P.mode || 'ecg', data = P.data || [], n = data.length, ok = n >= 2;
      if (P.color !== colorKey) { colorKey = P.color; tint.set(P.color ?? 0x43d9c4); headGlow.material.color.copy(tint); bar.material.color.copy(tint); }
      copies.forEach((c) => { c.l.visible = ok; });
      fill.visible = headGlow.visible = headCore.visible = bar.visible = ok;
      thr.forEach((l) => { l.visible = ok && mode === 'spo2'; });
      if (!ok) return;
      const want = mode === 'spo2' ? n : 320;
      if (want !== W) alloc(want);
      const key = `${mode}|${n}|${data[0]}|${data[n >> 1]}|${data[n - 1]}|${P.yRange}`;
      if (key !== sig) {
        sig = key;
        if (mode === 'spo2') [lo, hi] = P.yRange || [85, 100]; else [lo, hi] = robustRange(data);
        cursor = 0;
      }
      const span = hi - lo || 1, Y = (v) => 0.08 + 0.84 * clamp((v - lo) / span, -0.06, 1.06);
      const { r, g, b } = tint;
      let hx, hy;
      if (mode === 'ecg') {
        cursor += dt * (P.speed || 110);
        const base = Math.floor(cursor), frac = cursor - base;
        for (let i = 0; i < W; i++) {
          const k = base - (W - 1 - i), v = data[((k % n) + n) % n];
          put(i, (i - frac) / (W - 1), Y(v), 0.04 + 0.96 * Math.pow(i / (W - 1), 1.6), r, g, b);
        }
        hx = (W - 1 - frac) / (W - 1); hy = pos[(W - 1) * 3 + 1];
      } else {
        const h = Math.min(1, (t % 6) / 3.6) * (n - 1);
        for (let i = 0; i < n; i++) put(i, i / (n - 1), Y(data[i]), i <= h ? 1 : 0.12, r, g, b);
        hx = h / (n - 1);
        const i0 = Math.floor(h), i1 = Math.min(n - 1, i0 + 1);
        hy = pos[i0 * 3 + 1] + (pos[i1 * 3 + 1] - pos[i0 * 3 + 1]) * (h - i0);
        thr[0].position.y = 0.08 + 0.84 * ((95 - lo) / span); thr[1].position.y = 0.08 + 0.84 * ((90 - lo) / span);
      }
      lineGeo.attributes.position.needsUpdate = true; lineGeo.attributes.color.needsUpdate = true;
      fillGeo.attributes.position.needsUpdate = true; fillGeo.attributes.color.needsUpdate = true;
      const pulse = 1 + 0.25 * Math.sin(t * 6);
      headGlow.position.set(hx, hy, 0.6); headGlow.scale.set((34 * pulse) / size.w, (34 * pulse) / size.h, 1);
      headCore.position.set(hx, hy, 0.7);
      bar.position.set(hx - 0.06, 0.5, 0.15);
      for (let i = 0; i < DN; i++) {
        dp[i * 3] -= dt * 0.015 * dv[i]; dp[i * 3 + 1] += dt * 0.01 * (dv[i] - 0.6);
        if (dp[i * 3] < 0) dp[i * 3] += 1; if (dp[i * 3 + 1] > 1) dp[i * 3 + 1] -= 1; if (dp[i * 3 + 1] < 0) dp[i * 3 + 1] += 1;
      }
      dg.attributes.position.needsUpdate = true;
    }
  };
}

/* ---------- Scene: predicted-label orb ---------- */
function buildOrb({ propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50); camera.position.set(0, 0, 5.6);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const pl = new THREE.PointLight(0xffffff, 40, 20); pl.position.set(3, 3, 4); scene.add(pl);
  const color = new THREE.Color(0x43d9c4);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 48), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.2 }));
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 1), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35 }));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlow(), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(5.2, 5.2, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
  ring.rotation.x = 1.2;
  const dust = makeStars(260, 2.4, 0.06, 0xffffff);
  scene.add(core, shell, halo, ring, dust);
  let cur = null;
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    update(dt, t) {
      const P = propsRef.current;
      if (P.color !== cur) {
        cur = P.color; color.set(cur);
        core.material.color.copy(color); core.material.emissive.copy(color); shell.material.color.copy(color); halo.material.color.copy(color); ring.material.color.copy(color);
      }
      core.scale.setScalar(1 + 0.08 * lubdub(t, 72)); shell.rotation.y += dt * 0.35; shell.rotation.x += dt * 0.15;
      ring.rotation.z += dt * 0.4; dust.rotation.y += dt * 0.08;
    }
  };
}

/* ---------- Scene: 3D bar chart of predicted classes ---------- */
function buildBars({ renderer, propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100); camera.position.set(5.5, 4, 7.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0); controls.enableZoom = false; controls.enablePan = false; controls.autoRotate = true; controls.autoRotateSpeed = 1.1; controls.enableDamping = true;
  controls.minPolarAngle = 0.6; controls.maxPolarAngle = 1.45;
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 6, 4); scene.add(dl);
  const grid = new THREE.GridHelper(10, 20, 0x2f5266, 0x1a3040); grid.material.transparent = true; grid.material.opacity = 0.6; scene.add(grid);
  const geo = new THREE.BoxGeometry(0.8, 1, 0.8); geo.translate(0, 0.5, 0);
  const edges = new THREE.EdgesGeometry(geo);
  const bars = [], tags = [], vals = [], last = [], cur = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x43d9c4, emissive: 0x43d9c4, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.3, transparent: true, opacity: 0.92 }));
    m.position.x = (i - 2) * 1.4; m.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
    scene.add(m); bars.push(m); cur.push(0.02); last.push(null);
    tags.push(null); vals.push(null);
  }
  let tagKey = '';
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    update(dt) {
      const items = propsRef.current.items || [], max = Math.max(1, ...items.map((x) => x.value));
      const key = items.map((x) => x.code).join();
      if (key !== tagKey) {
        tagKey = key;
        tags.forEach((s) => { if (s) { scene.remove(s); s.material.map.dispose(); s.material.dispose(); } });
        items.forEach((it, i) => { tags[i] = textSprite(it.code, '#8fb3c4'); tags[i].position.set(bars[i].position.x, -0.35, 0.9); scene.add(tags[i]); });
      }
      items.forEach((it, i) => {
        if (!bars[i]) return;
        bars[i].material.color.setHex(it.color); bars[i].material.emissive.setHex(it.color);
        cur[i] += ((it.value / max) * 3 - cur[i]) * Math.min(1, dt * 5);
        bars[i].scale.y = Math.max(0.02, cur[i]);
        if (last[i] !== it.value) {
          last[i] = it.value;
          if (vals[i]) { scene.remove(vals[i]); vals[i].material.map.dispose(); vals[i].material.dispose(); }
          vals[i] = textSprite(String(it.value), '#ffffff', 50); scene.add(vals[i]);
        }
        vals[i].position.set(bars[i].position.x, Math.max(0.02, cur[i]) + 0.4, 0);
      });
      controls.update();
    },
    dispose() { controls.dispose(); }
  };
}

/* ---------- Scene: ECG windows stacked in depth ---------- */
function buildStack({ renderer, propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(4.2, 2.4, 7);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false; controls.enableZoom = false; controls.autoRotate = true; controls.autoRotateSpeed = 0.9; controls.enableDamping = true;
  const group = new THREE.Group(); scene.add(group);
  const floor = new THREE.GridHelper(9, 18, 0x2f5266, 0x17303f); floor.position.y = -1.5; floor.material.transparent = true; floor.material.opacity = 0.55; scene.add(floor);
  let lines = [], sig = '';
  const a = new THREE.Color(0x43d9c4), b = new THREE.Color(0x9b8cff);
  const rebuild = (wins) => {
    lines.forEach((l) => { group.remove(l); l.geometry.dispose(); l.material.dispose(); });
    lines = [];
    const list = wins.filter((w) => w.length > 1).slice(0, 36);
    if (!list.length) return;
    const [lo, hi] = robustRange(list.flat()), gap = Math.min(0.42, 7 / list.length);
    list.forEach((w, j) => {
      const n = w.length, p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { p[i * 3] = (i / (n - 1) - 0.5) * 7; p[i * 3 + 1] = (clamp((w[i] - lo) / (hi - lo), -0.1, 1.1) - 0.35) * 2.4; p[i * 3 + 2] = (j - (list.length - 1) / 2) * gap; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: new THREE.Color().lerpColors(a, b, j / Math.max(1, list.length - 1)), transparent: true, opacity: 0.4 }));
      group.add(l); lines.push(l);
    });
  };
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    update(dt, t) {
      const wins = propsRef.current.windows || [];
      const key = `${wins.length}|${wins[0]?.length}|${wins[0]?.[0]}|${wins[wins.length - 1]?.[5]}`;
      if (key !== sig) { sig = key; rebuild(wins); }
      const h = lines.length ? Math.floor(t * 2.2) % lines.length : -1;
      lines.forEach((l, j) => { l.material.opacity = j === h ? 1 : 0.35; });
      controls.update();
    },
    dispose() { controls.dispose(); }
  };
}

/* ---------- Scene: neural network ---------- */
function buildNeural({ propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(0, 0, 10);
  const group = new THREE.Group(); scene.add(group);
  const layers = [4, 7, 7, 4, 3], nodes = [], conns = [], glow = makeGlow();
  const nodeGeo = new THREE.SphereGeometry(0.14, 16, 16);
  layers.forEach((n, l) => {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: l === layers.length - 1 ? 0x9b8cff : 0x43d9c4 }));
      m.position.set((l - (layers.length - 1) / 2) * 1.9, (k - (n - 1) / 2) * 0.8, (Math.random() - 0.5) * 1.4);
      group.add(m); nodes.push({ m, l });
    }
  });
  const lp = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const A = nodes.filter((n) => n.l === l), B = nodes.filter((n) => n.l === l + 1);
    A.forEach((a) => B.forEach((b) => { lp.push(a.m.position.x, a.m.position.y, a.m.position.z, b.m.position.x, b.m.position.y, b.m.position.z); conns.push({ a: a.m.position, b: b.m.position }); }));
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x43d9c4, transparent: true, opacity: 0.13 })));
  const M = 70, pp = new Float32Array(M * 3), pu = [], pc = [], ps = [];
  for (let i = 0; i < M; i++) { pu.push(Math.random()); pc.push(Math.floor(Math.random() * conns.length)); ps.push(0.5 + Math.random()); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, map: glow, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(pg, pmat); pts.frustumCulled = false; group.add(pts);
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.position.z = w / h < 1 ? 13 : 10; camera.updateProjectionMatrix(); },
    update(dt, t) {
      const act = !!propsRef.current.active, sm = act ? 1.8 : 0.35;
      pmat.opacity += ((act ? 1 : 0.3) - pmat.opacity) * Math.min(1, dt * 4);
      for (let i = 0; i < M; i++) {
        pu[i] += dt * ps[i] * sm;
        if (pu[i] > 1) { pu[i] = 0; pc[i] = Math.floor(Math.random() * conns.length); }
        const c = conns[pc[i]];
        pp[i * 3] = c.a.x + (c.b.x - c.a.x) * pu[i]; pp[i * 3 + 1] = c.a.y + (c.b.y - c.a.y) * pu[i]; pp[i * 3 + 2] = c.a.z + (c.b.z - c.a.z) * pu[i];
      }
      pg.attributes.position.needsUpdate = true;
      nodes.forEach(({ m, l }) => m.scale.setScalar(act ? 1 + 0.5 * Math.max(0, Math.sin(t * 4 - l * 1.2)) : 1));
      group.rotation.y = Math.sin(t * 0.3) * 0.5; group.rotation.x = Math.sin(t * 0.2) * 0.1;
    }
  };
}

/* ---------- Scene: federated globe ---------- */
function buildGlobe({ propsRef }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100); camera.position.set(0, 1.6, 8.8); camera.lookAt(0, 0, 0);
  const group = new THREE.Group(); scene.add(group);
  const glow = makeGlow();
  group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, wireframe: true, transparent: true, opacity: 0.5 })));
  group.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 32), new THREE.MeshBasicMaterial({ color: 0x5aa9ff, transparent: true, opacity: 0.35 })));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x5aa9ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(4.2, 4.2, 1); group.add(halo);
  const D = 5, devs = [];
  const orbit = (r, inc, a) => new THREE.Vector3(r * Math.cos(a), r * Math.sin(a) * Math.sin(inc), r * Math.sin(a) * Math.cos(inc));
  for (let d = 0; d < D; d++) {
    const r = 2.5 + (d % 3) * 0.35, inc = 0.25 + d * 0.5, speed = 0.25 + d * 0.05, phase = (d / D) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0x43d9c4 })); group.add(m);
    const pts = []; for (let i = 0; i <= 90; i++) pts.push(orbit(r, inc, (i / 90) * Math.PI * 2));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x43d9c4, transparent: true, opacity: 0.16 })));
    devs.push({ m, r, inc, speed, phase });
  }
  const cp = new Float32Array(D * 6), cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3).setUsage(THREE.DynamicDrawUsage));
  const links = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x43d9c4, transparent: true, opacity: 0.25 })); links.frustumCulled = false; group.add(links);
  const pp = new Float32Array(D * 3), pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.34, map: glow, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(pg, pmat); pts.frustumCulled = false; group.add(pts);
  return {
    scene, camera,
    resize(w, h) { camera.aspect = w / h; camera.position.z = w / h < 1 ? 12 : 8.8; camera.updateProjectionMatrix(); },
    update(dt, t) {
      const act = !!propsRef.current.active;
      pmat.opacity += ((act ? 1 : 0.2) - pmat.opacity) * Math.min(1, dt * 4);
      devs.forEach((d, i) => {
        const p = orbit(d.r, d.inc, d.phase + t * d.speed); d.m.position.copy(p); d.m.rotation.y += dt; d.m.rotation.x += dt * 0.6;
        cp[i * 6] = p.x; cp[i * 6 + 1] = p.y; cp[i * 6 + 2] = p.z; cp[i * 6 + 3] = 0; cp[i * 6 + 4] = 0; cp[i * 6 + 5] = 0;
        const u = (t * (act ? 0.7 : 0.25) + i * 0.37) % 2, k = u < 1 ? u : 2 - u;
        pp[i * 3] = p.x * (1 - k); pp[i * 3 + 1] = p.y * (1 - k); pp[i * 3 + 2] = p.z * (1 - k);
      });
      cg.attributes.position.needsUpdate = true; pg.attributes.position.needsUpdate = true;
      halo.scale.setScalar(4.2 + 0.4 * Math.sin(t * 2)); group.rotation.y = t * 0.12;
    }
  };
}

/* ---------- React wrappers around the scenes ---------- */
const Scene3D = ({ build, className = '', style, ...props }) => {
  const ref = useThree(build, props);
  return <div ref={ref} className={`cg-three ${className}`} style={style} />;
};
const LoginBackdrop = () => <Scene3D build={buildLogin} />;
const CaptureScene = ({ progress, phase }) => <Scene3D build={buildCapture} progress={progress} phase={phase} />;
const LabelOrb = ({ color }) => <Scene3D build={buildOrb} color={color} />;
const BarChart3D = ({ items }) => <Scene3D build={buildBars} items={items} />;
const WindowStack3D = ({ windows }) => <Scene3D build={buildStack} windows={windows} />;
const NeuralNet3D = ({ active }) => <Scene3D build={buildNeural} active={active} />;
const FederatedGlobe3D = ({ active }) => <Scene3D build={buildGlobe} active={active} />;
function SignalScope({ height = 220, children, ...props }) {
  const ref = useThree(buildScope, props);
  return <div className="cg-scope" style={{ height }}><div ref={ref} className="cg-three" />{children}</div>;
}
function SpoAxis({ range: [lo, hi] }) {
  const ticks = []; for (let v = lo; v <= hi; v += 5) ticks.push(v);
  return <div className="cg-axis">{ticks.map((v) => <span key={v} style={{ bottom: `${8 + (84 * (v - lo)) / (hi - lo)}%` }}>{v}</span>)}</div>;
}

/** Raw MAX30102 IR + RED channels with summary metrics. Used on Overview and on each record page. */
function PpgView({ ppg, height = 190 }) {
  const { ir, red } = ppg;
  const m = useMemo(() => ppgMetrics(ir, red), [ir, red]);
  if (ir.length < 2 || !m) {
    return <div className="sensor-empty"><Waves size={25} /><strong>No raw IR / RED samples</strong><span>The MAX30102 returned no usable readings for this capture.</span></div>;
  }
  const n0 = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString() : '—');
  return <>
    <div className="cg-ppg-channel"><span className="cg-ppg-tag cg-ppg-ir"><i />IR (infrared)</span><Badge tone="violet">mean {n0(m.ir.mean)}</Badge></div>
    <SignalScope mode="ecg" data={ir} color={toneHex('violet')} height={height} />
    <div className="cg-ppg-channel"><span className="cg-ppg-tag cg-ppg-red"><i />RED</span><Badge tone="red">mean {n0(m.red.mean)}</Badge></div>
    <SignalScope mode="ecg" data={red} color={toneHex('red')} height={height} />
    <div className="oxygen-stats cg-ppg-stats">
      <div><span>IR range</span><strong>{n0(m.ir.min)}–{n0(m.ir.max)}</strong></div>
      <div><span>RED range</span><strong>{n0(m.red.min)}–{n0(m.red.max)}</strong></div>
      <div><span>Perfusion (IR)</span><strong>{fmt(m.piIr, 2)}<small>%</small></strong></div>
      <div><span>Perfusion (RED)</span><strong>{fmt(m.piRed, 2)}<small>%</small></strong></div>
      <div><span>R ratio</span><strong>{fmt(m.R, 3)}</strong></div>
      <div><span>Samples</span><strong>{ir.length}</strong></div>
    </div>
    <div className="medical-note"><AlertTriangle size={15} /><span>Raw sensor counts, auto-scaled. Perfusion and R are informational, not a diagnosis.</span></div>
  </>;
}

/* =====================================================================
   4. UI PRIMITIVES (unchanged look)
   ===================================================================== */
function IconLogo({ small = false }) { return <div className={`brand-mark ${small ? 'brand-mark-small' : ''}`}><HeartPulse size={small ? 20 : 24} strokeWidth={2.3} /></div>; }
function Brand({ compact = false }) { return <div className="brand"><IconLogo small={compact} /><div className="brand-copy"><strong>cardio<span>guard</span></strong>{!compact && <small>EDGE HEALTH MONITORING</small>}</div></div>; }
function Badge({ children, tone = 'neutral', dot = false }) { return <span className={`badge badge-${tone}`}>{dot && <i />}{children}</span>; }
function Button({ children, variant = 'primary', size = '', icon: Icon, ...props }) { return <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''}`} {...props}>{Icon && <Icon size={16} />}<span>{children}</span></button>; }
function PageHeader({ eyebrow, title, subtitle, action }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="page-header-action">{action}</div>}</div>; }

/* =====================================================================
   5. LOGIN DIALOG (single, hard-coded credentials at the top of the file)
   ===================================================================== */
function Login({ onLogin }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const submit = (e) => {
    e.preventDefault();
    if (id.trim().toLowerCase() === DOCTOR_ID.toLowerCase() && pw === DOCTOR_PASSWORD) onLogin();
    else { setError('That ID or password is incorrect.'); setShake((s) => s + 1); }
  };
  return (
    <div className="cg-login-stage">
      <div className="cg-fullbleed"><LoginBackdrop /></div>
      <div className="cg-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <Brand />
        <div className="cg-dialog-head">
          <h2 id="login-title">Sign in</h2>
          <p>Enter your clinician ID and password to open the monitoring workspace.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Clinician ID<div className="input-wrap"><UserRound size={17} /><input autoFocus autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="Your ID" required /></div></label>
          <label>Password<div className="input-wrap"><LockKeyhole size={17} /><input type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" required /><button className="reveal-btn" type="button" onClick={() => setShow(!show)} aria-label="Toggle password visibility">{show ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          {error && <div className="form-error cg-shake" key={shake} role="alert"><AlertTriangle size={16} />{error}</div>}
          <button className="btn btn-primary auth-submit" type="submit">Sign in<ChevronRight size={17} /></button>
        </form>
        <div className="auth-security"><ShieldCheck size={15} /> Authorised clinical access only</div>
      </div>
    </div>
  );
}

/* =====================================================================
   6. SHELL
   ===================================================================== */
function Shell({ user, onLogout, children, deviceOnline, healthError = '', records = [] }) {
  const [drawer, setDrawer] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); setProfileOpen(false); }, [location.pathname]);
  useEffect(() => { const close = (e) => { if (!e.target.closest('.profile-menu-wrap')) setProfileOpen(false); }; document.addEventListener('click', close); return () => document.removeEventListener('click', close); }, []);
  const links = [{ to: '/home', label: 'Overview', icon: LayoutDashboard }, { to: '/analysis', label: 'Patient records', icon: ClipboardList }, { to: '/local-train', label: 'Local training', icon: BrainCircuit }, { to: '/aggregate-weights', label: 'Federated learning', icon: Network }];
  const initials = user.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return <div className="app-shell"><aside className={`sidebar ${drawer ? 'sidebar-open' : ''}`}><div className="sidebar-head"><Brand /><button className="icon-btn sidebar-close" onClick={() => setDrawer(false)}><X size={18} /></button></div><div className="workspace-label">WORKSPACE</div><nav className="side-nav">{links.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link ${isActive ? 'nav-active' : ''}`}><l.icon size={18} /><span>{l.label}</span>{l.to === '/analysis' && <span className="nav-count">Live</span>}</NavLink>)}</nav><div className="sidebar-spacer" /><div className="device-mini"><div className="device-mini-top"><span className={`status-dot ${deviceOnline ? 'online' : 'offline'}`} /><span>EDGE DEVICE</span><MoreHorizontal size={17} /></div><strong>{deviceOnline ? 'Device connected' : 'Device offline'}</strong><small>{deviceOnline ? 'Ready to capture signals' : 'Check network connection'}</small><div className="device-mini-bottom"><span><span className={`tiny-dot ${deviceOnline ? 'online' : 'offline'}`} />{deviceOnline ? 'Online' : 'Offline'}</span><span>Raspberry Pi</span></div></div><div className="sidebar-user"><div className="avatar">{initials}</div><div className="sidebar-user-copy"><strong>{user.name}</strong><small>Clinical workspace</small></div><button className="icon-btn logout-btn" onClick={onLogout} title="Sign out"><LogOut size={17} /></button></div></aside>
    {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}<main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-btn menu-toggle" onClick={() => setDrawer(true)}><Menu size={20} /></button><div className="crumb"><span>Workspace</span><ChevronRight size={14} /><strong>{location.pathname.includes('/analysis/') ? 'Record details' : links.find((l) => location.pathname.startsWith(l.to))?.label || 'Overview'}</strong></div></div><div className="topbar-right"><div className={`top-status ${deviceOnline ? '' : 'top-status-offline'}`} title={deviceOnline ? 'Edge API is online' : healthError}><span className={`tiny-dot ${deviceOnline ? 'online' : 'offline'}`} />{deviceOnline ? 'Edge connected' : 'Edge offline'}</div><button className="icon-btn notification-btn" title="Notifications"><Bell size={18} /><i /></button><div className="profile-menu-wrap"><button className={`topbar-avatar profile-trigger ${profileOpen ? 'profile-trigger-open' : ''}`} onClick={() => setProfileOpen((v) => !v)} aria-label="Open profile information" aria-expanded={profileOpen}>{initials}</button>{profileOpen && <div className="profile-popover"><div className="profile-popover-head"><div className="profile-avatar-large">{initials}</div><div><strong>{user.name}</strong><span>Doctor account</span></div><button className="profile-close" onClick={() => setProfileOpen(false)} aria-label="Close profile"><X size={15} /></button></div><div className="profile-role-line"><ShieldCheck size={14} /><span>Clinical workspace</span><Badge tone="blue">DOCTOR</Badge></div><div className="profile-details"><div><span>Email address</span><strong>{user.email || 'Not provided'}</strong></div><div><span>Records available</span><strong>{records.length}</strong></div><div><span>Awaiting review</span><strong>{records.filter(isUnlabelled).length}</strong></div></div><div className="profile-popover-foot"><span><LockKeyhole size={13} /> Signed in</span><button onClick={onLogout}><LogOut size={14} /> Sign out</button></div></div>}</div></div></header><div className="content-area">{children}</div><footer className="app-footer"><span>© 2026 CardioGuard · Edge AI cardiac monitoring</span><span><ShieldCheck size={13} /> Informational display only · Not a diagnosis</span></footer></main></div>;
}

/* =====================================================================
   7. OVERVIEW  (Start button → 20 s countdown → result)
   ===================================================================== */
function Overview({ deviceOnline, healthError = '', cap, onStart, onReset }) {
  const [now, setNow] = useState(Date.now());
  const elapsed = cap.startedAt ? Math.max(0, (now - cap.startedAt) / 1000) : 0;
  const timerDone = elapsed >= CAPTURE_SECONDS;
  let phase = 'idle';
  if (cap.error) phase = 'error';
  else if (cap.startedAt) phase = !timerDone ? 'capturing' : cap.result ? 'result' : 'processing';

  useEffect(() => {
    if (!cap.startedAt || (timerDone && (cap.result || cap.error))) return undefined;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [cap.startedAt, timerDone, cap.result, cap.error]);

  const rec = cap.result;
  const windows = useMemo(() => windowsOf(rec), [rec]);
  const ecg = useMemo(() => windows.flat(), [windows]);
  const spo = useMemo(() => spoOf(rec?.oxygen_info), [rec]);
  const ppg = useMemo(() => ppgOf(rec?.oxygen_info), [rec]);

  if (phase === 'result' && rec) {
    const pred = labelOf(rec.prediction), avg = mean(spo), range = spo2Range(spo);
    return <div className="cg-result-grid">
      <div className="cg-result-left">
        <section className="panel">
          <div className="panel-head"><div><div className="panel-kicker"><span className="live-pulse" /> LIVE SIGNAL</div><h3>ECG waveform</h3><p>{ecg.length} samples · {windows.length} windows · looping playback</p></div><Badge tone="green" dot>Captured</Badge></div>
          <SignalScope mode="ecg" data={ecg} color={0x43d9c4} height={280} />
        </section>
        <section className="panel">
          <div className="panel-head"><div><div className="panel-kicker">OXYGEN SATURATION</div><h3>Blood oxygen</h3><p>Valid SpO₂ samples · sweeping playback</p></div>{avg !== null && <Badge tone={spoTone(avg)}>{fmt(avg, 1)}% mean</Badge>}</div>
          {spo.length > 1
            ? <><SignalScope mode="spo2" data={spo} yRange={range} color={toneHex(spoTone(avg))} height={220}><SpoAxis range={range} /></SignalScope>
              <div className="oxygen-stats"><div><span>Minimum</span><strong>{fmt(Math.min(...spo), 1)}<small>%</small></strong></div><div><span>Maximum</span><strong>{fmt(Math.max(...spo), 1)}<small>%</small></strong></div><div><span>Valid samples</span><strong>{spo.length}</strong></div></div></>
            : <div className="sensor-empty"><Waves size={25} /><strong>Pulse-ox sensor not detected</strong><span>No valid samples between 50% and 100% were found.</span></div>}
        </section>
        <section className="panel">
          <div className="panel-head"><div><div className="panel-kicker">RAW PHOTOPLETHYSMOGRAM</div><h3>IR &amp; RED signals</h3><p>MAX30102 channels · scrolling playback</p></div>{ppg.ir.length > 1 && <Badge tone="violet">{ppg.ir.length} samples</Badge>}</div>
          <PpgView ppg={ppg} height={170} />
        </section>
      </div>
      <aside className="cg-result-right">
        <section className="panel cg-label-card">
          <div className="panel-head"><div><div className="panel-kicker">PREDICTED LABEL</div><h3>Model output</h3></div><Badge tone={pred.tone} dot>{pred.code}</Badge></div>
          <div className="cg-orb"><LabelOrb color={toneHex(pred.tone)} /><div className="cg-orb-code">{pred.code}</div></div>
          <div className="cg-label-name">{pred.name}</div>
          <div className="cg-label-meta"><div><span>Record</span><strong>#{rec.id ?? '—'}</strong></div><div><span>Device</span><strong>{rec.device_id ?? '—'}</strong></div><div><span>ECG windows</span><strong>{windows.length}</strong></div></div>
          <p className="micro-disclaimer">The model predicts the first ECG window only. Informational, not a diagnosis.</p>
          <div className="cg-label-actions">
            {rec.id != null && <NavLink className="btn btn-primary" to={`/analysis/${rec.id}`}><span>Open analysis</span><ArrowUpRight size={15} /></NavLink>}
            <Button variant="secondary" icon={RefreshCw} onClick={onReset}>New capture</Button>
          </div>
        </section>
      </aside>
    </div>;
  }

  const remaining = Math.max(0, Math.ceil(CAPTURE_SECONDS - elapsed));
  return <section className="cg-stage">
    <CaptureScene progress={clamp(elapsed / CAPTURE_SECONDS, 0, 1)} phase={phase === 'error' ? 'idle' : phase} />
    <div className="cg-stage-overlay">
      {phase === 'idle' && <>
        <button className="btn btn-primary cg-start-btn" onClick={onStart} disabled={!deviceOnline}><Play size={22} /><span>Start</span></button>
        {!deviceOnline && <small className="cg-hint"><WifiOff size={13} /> Edge offline: {healthError || 'no response from the server.'}</small>}
      </>}
      {phase === 'capturing' && <div className="cg-timer" aria-live="polite"><strong>{remaining}</strong><span>seconds remaining</span></div>}
      {phase === 'processing' && <div className="cg-timer cg-timer-proc"><LoaderCircle className="spin" size={34} /><span>Analysing signal…</span></div>}
      {phase === 'error' && <div className="error-card cg-stage-error"><AlertTriangle size={20} /><div><strong>Capture failed</strong><p>{cap.error}</p><small>Check electrode and cable connections, then try again.</small><Button variant="secondary" size="small" onClick={onReset} icon={RefreshCw}>Try again</Button></div></div>}
    </div>
  </section>;
}

/* =====================================================================
   8. PATIENT RECORDS
   ===================================================================== */
function Analysis({ records, loading, error, onRefresh }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  // Invoke GET /data every time the page is opened
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onRefresh(); }, []);

  const rows = useMemo(() => records.map((r) => ({ r, spo: mean(spoOf(r.oxygen_info)), ppgN: ppgOf(r.oxygen_info).ir.length })), [records]);
  const filtered = rows.filter(({ r }) => {
    const l = labelOf(r.prediction), q = search.toLowerCase();
    const matches = `${r.id} ${r.device_id} ${l.name} ${l.code}`.toLowerCase().includes(q);
    const state = filter === 'all' || (filter === 'unlabelled' ? isUnlabelled(r) : !isUnlabelled(r));
    return matches && state;
  });
  const bars = useMemo(() => [0, 1, 2, 3, 4].map((k) => ({ code: labelOf(k).code, value: records.filter((r) => Number(r.prediction) === k).length, color: toneHex(labelOf(k).tone) })), [records]);
  const unl = records.filter(isUnlabelled).length;

  return <><PageHeader eyebrow="RECORD LIBRARY" title="Patient records" subtitle="Explore saved ECG captures, AI predictions, and clinician labels." action={<Button variant="secondary" icon={RefreshCw} onClick={onRefresh}>Refresh records</Button>} />
    <div className="cg-records-top">
      <section className="panel cg-bars-panel"><div className="panel-head"><div><div className="panel-kicker">DISTRIBUTION</div><h3>Predictions by class</h3><p>Drag to rotate</p></div></div><div className="cg-bars"><BarChart3D items={bars} /></div>
        <div className="cg-legend">{bars.map((b, i) => <span key={i}><i style={{ background: `#${b.color.toString(16).padStart(6, '0')}` }} />{b.code} · {b.value}</span>)}</div></section>
      <div className="cg-summary-col">
        <div className="record-summary"><span>Total records</span><strong>{records.length}</strong><small>Stored on edge device</small></div>
        <div className="record-summary"><span>Unlabelled</span><strong>{unl}</strong><small>true_label = -1</small></div>
        <div className="record-summary"><span>Labelled</span><strong>{records.length - unl}</strong><small>Reviewed records</small></div>
      </div>
    </div>
    <section className="panel table-panel"><div className="table-toolbar"><div><h3>All captures</h3><p>Records are sorted by record ID, newest first.</p></div><div className="table-filters"><div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search record ID…" /></div><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All records</option><option value="unlabelled">Unlabelled</option><option value="labelled">Labelled</option></select></div></div>
      {error && <div className="inline-error"><AlertTriangle size={16} />{error}</div>}
      {loading && !records.length ? <div className="loading-state"><LoaderCircle className="spin" size={24} /> Loading records…</div>
        : filtered.length ? <div className="table-scroll"><table><thead><tr><th>RECORD</th><th>AI PREDICTION</th><th>TRUE LABEL</th><th>ECG WINDOWS</th><th>MEAN SpO₂</th><th>IR / RED</th><th>DEVICE</th><th></th></tr></thead><tbody>{filtered.map(({ r, spo, ppgN }) => { const l = labelOf(r.prediction); return <tr key={r.id}><td><NavLink className="table-record" to={`/analysis/${r.id}`}><span className="table-record-icon"><Activity size={16} /></span><span><strong>Record #{r.id}</strong><small>Saved capture</small></span></NavLink></td><td><Badge tone={l.tone}>{l.code} · {l.name}</Badge></td><td>{isUnlabelled(r) ? <Badge tone="amber">Unlabelled</Badge> : <Badge tone="green">{labelOf(r.true_label).code}</Badge>}</td><td>{windowsOf(r).length} windows</td><td>{spo === null ? '—' : `${spo.toFixed(1)}%`}</td><td>{ppgN ? `${ppgN} samples` : '—'}</td><td>Device {r.device_id ?? '—'}</td><td><NavLink to={`/analysis/${r.id}`} className="table-open">Open <ChevronRight size={14} /></NavLink></td></tr>; })}</tbody></table></div>
          : <div className="empty-state"><div className="empty-icon"><ClipboardList size={25} /></div><h3>{records.length ? 'No matching records' : 'No records to show'}</h3><p>{records.length ? 'Try a different search or filter.' : 'When a capture is saved on the edge device, it will appear here.'}</p><Button variant="secondary" onClick={onRefresh} icon={RefreshCw}>Try again</Button></div>}
      <div className="table-foot"><span>Showing {filtered.length} of {records.length} records</span><span>Edge device data</span></div></section></>;
}

/* =====================================================================
   9. RECORD DETAIL  (analysis + true-label dropdown → PUT /true-label-update/{id})
   ===================================================================== */
function RecordDetail({ records, loading, fallback, onRecordsChange }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const record = records.find((r) => String(r.id) === String(id)) || (fallback && String(fallback.id) === String(id) ? fallback : null);
  const windows = useMemo(() => windowsOf(record), [record]);
  const ecg = useMemo(() => windows.flat(), [windows]);
  const spo = useMemo(() => spoOf(record?.oxygen_info), [record]);
  const ppg = useMemo(() => ppgOf(record?.oxygen_info), [record]);
  const stats = useMemo(() => ecgStats(ecg), [ecg]);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setLabel(record && !isUnlabelled(record) ? String(record.true_label) : ''); }, [record?.true_label, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMessage(''); setError(''); }, [id]);

  if (!record) {
    return <><PageHeader eyebrow="RECORD DETAILS" title={loading ? 'Loading record…' : 'Record not found'} subtitle="This record is not in the currently loaded edge-device data." />
      <div className="panel empty-state"><div className="empty-icon">{loading ? <LoaderCircle className="spin" size={24} /> : <Search size={24} />}</div><h3>{loading ? `Loading record #${id}` : `Could not find record #${id}`}</h3><p>Refresh the records list or return to the library.</p><Button onClick={() => navigate('/analysis')}>Back to records</Button></div></>;
  }

  const pred = labelOf(record.prediction), unl = isUnlabelled(record), avg = mean(spo), range = spo2Range(spo);
  const agrees = !unl && Number(record.true_label) === Number(record.prediction);
  const onPick = async (e) => {
    const v = e.target.value; if (v === '') return;
    const prev = label; setLabel(v); setSaving(true); setError(''); setMessage('');
    try {
      await api.label(record.id, Number(v));
      onRecordsChange(record.id, Number(v));
      setMessage(`True label for record #${record.id} updated to ${labelOf(Number(v)).code}.`);
    } catch (err) { setLabel(prev); setError(err?.message || 'Could not update the label. Try again.'); }
    finally { setSaving(false); }
  };

  return <><div className="back-link-wrap"><button className="back-link" onClick={() => navigate('/analysis')}>← Back to records</button></div>
    <PageHeader eyebrow={`RECORD #${record.id}`} title="Capture analysis" subtitle="Inspect the ECG signal, oxygen samples, and model output." action={<Badge tone={unl ? 'amber' : 'green'} dot>{unl ? 'Awaiting clinician review' : 'Clinician labelled'}</Badge>} />
    <div className="detail-metrics"><div><span>AI prediction</span><strong>{pred.code} · {pred.name}</strong></div><div><span>Device ID</span><strong>{record.device_id ?? '—'}</strong></div><div><span>ECG windows</span><strong>{windows.length}</strong></div><div><span>Mean SpO₂</span><strong>{avg === null ? 'Sensor not detected' : `${avg.toFixed(1)}%`}</strong></div><div><span>PPG samples</span><strong>{ppg.ir.length || 'None'}</strong></div></div>
    <div className="cg-detail-grid">
      <div className="cg-detail-col">
        <section className="panel"><div className="panel-head"><div><div className="panel-kicker"><span className="live-pulse" /> SIGNAL PLAYBACK</div><h3>ECG waveform</h3><p>All windows · concatenated</p></div><Badge tone="neutral">{ecg.length} samples</Badge></div><SignalScope mode="ecg" data={ecg} color={0x43d9c4} height={240} /></section>
        <section className="panel"><div className="panel-head"><div><div className="panel-kicker">WINDOW STACK</div><h3>ECG windows in 3D</h3><p>Each window sits at its own depth · drag to orbit</p></div></div><div className="cg-stack"><WindowStack3D windows={windows} /></div></section>
      </div>
      <div className="cg-detail-col">
        <section className="panel"><div className="panel-head"><div><div className="panel-kicker">PULSE OXIMETRY</div><h3>Oxygen readings</h3><p>Valid SpO₂ samples</p></div></div>
          {spo.length > 1 ? <><SignalScope mode="spo2" data={spo} yRange={range} color={toneHex(spoTone(avg))} height={200}><SpoAxis range={range} /></SignalScope>
            <div className="oxygen-stats"><div><span>Minimum</span><strong>{fmt(Math.min(...spo), 1)}<small>%</small></strong></div><div><span>Maximum</span><strong>{fmt(Math.max(...spo), 1)}<small>%</small></strong></div><div><span>Samples</span><strong>{spo.length}</strong></div></div></>
            : <div className="sensor-empty"><Waves size={25} /><strong>Pulse-ox sensor not detected</strong><span>No valid samples between 50% and 100% were found.</span></div>}
          <div className="medical-note"><AlertTriangle size={15} /><span>Display bands are informational only and are not a diagnosis.</span></div></section>
        <section className="panel"><div className="panel-head"><div><div className="panel-kicker">RAW PPG</div><h3>IR &amp; RED channels</h3><p>Unprocessed MAX30102 samples for this record</p></div>{ppg.ir.length > 1 && <Badge tone="violet">{ppg.ir.length} samples</Badge>}</div>
          <PpgView ppg={ppg} height={170} /></section>
        <section className="panel"><div className="panel-head"><div><div className="panel-kicker">SIGNAL STATISTICS</div><h3>ECG analysis</h3><p>Computed from the stored samples</p></div></div>
          {stats ? <div className="cg-stat-list"><div><span>Samples</span><strong>{stats.n}</strong></div><div><span>Peak-to-peak</span><strong>{fmt(stats.p2p, 3)}</strong></div><div><span>Minimum</span><strong>{fmt(stats.min, 3)}</strong></div><div><span>Maximum</span><strong>{fmt(stats.max, 3)}</strong></div><div><span>Mean</span><strong>{fmt(stats.mean, 3)}</strong></div><div><span>Std. deviation</span><strong>{fmt(stats.sd, 3)}</strong></div><div><span>Peak candidates</span><strong>{stats.peaks}</strong></div></div> : <p className="subtle-note">No ECG samples stored for this record.</p>}
          <div className="heart-rate-placeholder"><HeartPulse size={19} /><div><strong>Heart rate</strong><span>Unavailable until the sampling rate and R-peak detection are configured.</span></div></div></section>
      </div>
    </div>
    <section className="panel label-panel"><div className="label-panel-copy"><div className="panel-kicker">CLINICIAN REVIEW</div><h3>AI prediction vs. true label</h3><p>The model predicts the first ECG window only. Choosing a label saves it to the edge device immediately.</p>
      <div className="label-comparison"><div><span>Model prediction</span><strong>{pred.code} — {pred.name}</strong></div><div><span>Saved true label</span><strong>{unl ? 'Not labelled' : `${labelOf(record.true_label).code} — ${labelOf(record.true_label).name}`}</strong></div>{!unl && <div><span>Agreement</span><strong><Badge tone={agrees ? 'green' : 'amber'}>{agrees ? 'Model agrees' : 'Model differs'}</Badge></strong></div>}</div></div>
      <div className="label-form"><label htmlFor="true-label">True label</label>
        <select id="true-label" value={label} onChange={onPick} disabled={saving}><option value="" disabled>Select a label…</option>{[0, 1, 2, 3, 4].map((k) => <option key={k} value={k}>{labelOf(k).code} — {labelOf(k).name}</option>)}</select>
        {saving && <div className="subtle-note"><LoaderCircle className="spin" size={14} /> Saving…</div>}
        {error && <div className="form-error"><AlertTriangle size={14} />{error}</div>}
        {message && <div className="form-success"><CircleCheck size={14} />{message}</div>}</div></section></>;
}

/* =====================================================================
   10. LOCAL TRAINING / FEDERATED LEARNING
   ===================================================================== */
function Training({ deviceOnline, recordCount }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const enough = recordCount > MIN_RECORDS_FOR_TRAINING;
  const run = async () => { setLoading(true); setError(''); setResult(null); try { setResult(await api.train()); } catch (e) { setError(e.message || 'Local training failed.'); } finally { setLoading(false); } };
  return <><PageHeader eyebrow="ON-DEVICE LEARNING" title="Local model training" subtitle="Train the model on labelled windows stored by this edge device." />
    <div className="feature-hero training-hero"><div className="feature-hero-copy"><Badge tone="violet" dot>EDGE COMPUTING</Badge><h2>Learning, close to the signal.</h2><p>Run local training on the edge device, reducing the need to move raw physiological data off-device.</p>
      <div className={`cg-notice ${enough ? 'cg-notice-ok' : 'cg-notice-warn'}`}>{enough ? <CircleCheck size={18} /> : <AlertTriangle size={18} />}<div><strong>Local retraining needs more than {MIN_RECORDS_FOR_TRAINING} records.</strong><span>{recordCount} stored on this device{enough ? ' — ready to train.' : ` — ${MIN_RECORDS_FOR_TRAINING + 1 - recordCount} more needed.`}</span><div className="cg-meter"><i style={{ width: `${clamp((recordCount / (MIN_RECORDS_FOR_TRAINING + 1)) * 100, 0, 100)}%` }} /></div></div></div>
      <Button onClick={run} disabled={loading || !deviceOnline} icon={loading ? LoaderCircle : Play}>{loading ? 'Training in progress…' : 'Start local training'}</Button>{!deviceOnline && <small className="button-hint">Connect the edge device to begin.</small>}</div>
      <div className="cg-three-visual"><NeuralNet3D active={loading} /><div className="neural-caption">{loading ? 'OPTIMISING MODEL' : 'LOCAL MODEL'}</div></div></div>
    {loading && <div className="progress-panel"><div className="progress-heading"><LoaderCircle className="spin" size={17} /><strong>Training on the edge device</strong><span>This can take seconds to minutes.</span></div><div className="progress-track"><i /></div><p>Keep this page open while the device runs its training process.</p></div>}
    {error && <div className="error-card"><AlertTriangle size={20} /><div><strong>Training could not complete</strong><p>{error}</p><small>Tip: label more records first. The device may require enough labelled windows.</small><Button variant="secondary" size="small" onClick={run} icon={RefreshCw}>Try again</Button></div></div>}
    {result && <div className="result-section"><div className="section-heading"><div><div className="eyebrow">TRAINING COMPLETE</div><h2>Training results</h2></div><Badge tone="green" dot>Success</Badge></div><div className="training-results"><div className="result-stat"><span>Training windows</span><strong>{result.num_windows ?? '—'}</strong><small>Used in this run</small></div><div className="result-stat"><span>Loss</span><strong>{result.loss ?? '—'}</strong><small>Lower is generally better</small></div><div className="result-stat"><span>Accuracy</span><strong>{result.accuracy == null ? '—' : `${(Number(result.accuracy) * 100).toFixed(1)}%`}</strong><small>Device-reported metric</small></div></div><div className="success-banner"><CircleCheck size={18} />{result.message || 'Local training completed.'}</div></div>}
    <div className="info-card"><div className="info-icon"><CircleHelp size={19} /></div><div><strong>Before you train</strong><p>Review records and add true labels first, then run training again.</p><NavLink to="/analysis" className="text-link">Review patient records <ArrowUpRight size={14} /></NavLink></div></div></>;
}

function Aggregate({ deviceOnline }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const run = async () => { setLoading(true); setError(''); setResult(null); try { setResult(await api.aggregate()); } catch (e) { setError(e.message || 'Could not aggregate weights.'); } finally { setLoading(false); } };
  return <><PageHeader eyebrow="FEDERATED LEARNING" title="Aggregate model weights" subtitle="Coordinate global model updates across participating edge devices." />
    <div className="feature-hero aggregate-hero"><div className="feature-hero-copy"><Badge tone="blue" dot>COLLABORATIVE LEARNING</Badge><h2>Share learning.<br />Not raw signals.</h2><p>Send local model updates to the server and apply the next global model when enough participating devices are ready.</p>
      <div className="cg-notice cg-notice-warn"><AlertTriangle size={18} /><div><strong>Aggregation needs {MIN_EDGE_DEVICES} or more edge devices.</strong><span>With fewer, the server keeps waiting for other devices and the request times out.</span></div></div>
      <Button onClick={run} disabled={loading || !deviceOnline} icon={loading ? LoaderCircle : Network}>{loading ? 'Syncing weights…' : 'Send weights to server'}</Button>{!deviceOnline && <small className="button-hint">Connect the edge device to continue.</small>}</div>
      <div className="cg-three-visual"><FederatedGlobe3D active={loading} /></div></div>
    {loading && <div className="progress-panel"><div className="progress-heading"><LoaderCircle className="spin" size={17} /><strong>Syncing with global model</strong><span>Waiting for other edge devices may take up to 120 seconds.</span></div><div className="progress-track"><i /></div><p>Please keep the page open while the server coordinates model updates.</p></div>}
    {error && <div className="error-card"><AlertTriangle size={20} /><div><strong>Aggregation did not complete</strong><p>{error}</p><small>If the global model is not ready yet, other devices may still need to submit their weights.</small><Button variant="secondary" size="small" onClick={run} icon={RefreshCw}>Try again</Button></div></div>}
    {result && <div className="success-result"><div className="success-result-icon"><Check size={22} /></div><div><Badge tone="green">UPDATE APPLIED</Badge><h3>{result.message || 'Global weights applied.'}</h3><p>Federated aggregation has returned a successful response from the edge device.</p><div className="round-stat"><span>Global round</span><strong>{result.round ?? '—'}</strong></div></div></div>}
    <div className="federated-steps"><div className="section-heading"><div><div className="eyebrow">HOW IT WORKS</div><h2>From local to global</h2></div></div><div className="steps-grid"><div><span className="step-num">01</span><BrainCircuit size={22} /><strong>Train locally</strong><p>Each device learns from its own labelled signal windows.</p></div><div><span className="step-num">02</span><Network size={22} /><strong>Aggregate updates</strong><p>The server combines submitted model weights.</p></div><div><span className="step-num">03</span><Activity size={22} /><strong>Apply global model</strong><p>Participating devices can use the updated model in future inference.</p></div></div></div></>;
}

/* =====================================================================
   11. APP
   ===================================================================== */
const getSavedUser = () => (sessionStorage.getItem('cg_auth') === '1' ? DOCTOR_PROFILE : null);
const EMPTY_CAP = { startedAt: null, result: null, error: null };

export default function App() {
  const [user, setUser] = useState(getSavedUser);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [healthError, setHealthError] = useState('');
  const [cap, setCap] = useState(EMPTY_CAP);
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');
  const navigate = useNavigate();

  const login = () => { sessionStorage.setItem('cg_auth', '1'); setUser(DOCTOR_PROFILE); navigate('/home'); };
  const logout = () => { sessionStorage.removeItem('cg_auth'); setUser(null); setCap(EMPTY_CAP); navigate('/'); };

  const checkHealth = useCallback(async () => { try { await api.health(); setDeviceOnline(true); setHealthError(''); } catch (e) { setDeviceOnline(false); setHealthError(e?.message || 'Unknown error'); console.warn('[health check]', e); } }, []);
  const refreshRecords = useCallback(async () => {
    if (!user) return;
    setRecordsLoading(true); setRecordsError('');
    try { setRecords(asRecords(await api.records()).sort((a, b) => Number(b.id) - Number(a.id))); }
    catch (e) { setRecordsError(e.message || 'Could not load records.'); setRecords([]); }
    finally { setRecordsLoading(false); }
  }, [user]);

  useEffect(() => { checkHealth(); const t = setInterval(checkHealth, 10000); const h = () => checkHealth(); window.addEventListener('cg-health-check', h); return () => { clearInterval(t); window.removeEventListener('cg-health-check', h); }; }, [checkHealth]);
  useEffect(() => { if (user) refreshRecords(); }, [user, refreshRecords]);

  // POST /predict runs in the background while the 20 s countdown plays
  const startCapture = useCallback(() => {
    const started = Date.now();
    setCap({ startedAt: started, result: null, error: null });
    api.predict(CAPTURE_SECONDS)
      .then((res) => { setCap((c) => (c.startedAt === started ? { ...c, result: res } : c)); refreshRecords(); })
      .catch((e) => setCap((c) => (c.startedAt === started ? { ...c, error: e?.message || 'Capture failed.' } : c)));
  }, [refreshRecords]);
  const resetCapture = () => setCap(EMPTY_CAP);
  const updateLabel = (id, label) => setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, true_label: label } : r)));

  if (!user) return <Login onLogin={login} />;
  return <Shell user={user} onLogout={logout} deviceOnline={deviceOnline} healthError={healthError} records={records}><Routes>
    <Route path="/" element={<Navigate to="/home" replace />} />
    <Route path="/home" element={<Overview deviceOnline={deviceOnline} healthError={healthError} cap={cap} onStart={startCapture} onReset={resetCapture} />} />
    <Route path="/analysis" element={<Analysis records={records} loading={recordsLoading} error={recordsError} onRefresh={refreshRecords} />} />
    <Route path="/analysis/:id" element={<RecordDetail records={records} loading={recordsLoading} fallback={cap.result} onRecordsChange={updateLabel} />} />
    <Route path="/local-train" element={<Training deviceOnline={deviceOnline} recordCount={records.length} />} />
    <Route path="/aggregate-weights" element={<Aggregate deviceOnline={deviceOnline} />} />
    <Route path="*" element={<Navigate to="/home" replace />} />
  </Routes></Shell>;
}