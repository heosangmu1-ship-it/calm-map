// Live waveform: AnalyserNode (or a pushed dBFS level) -> scrolling mirrored bars on a canvas. Spec: docs/DESIGN-MEASURE-1SCREEN.md section 3.
// Nothing is stored or sent; the canvas only shows the level of the audio already open in audio.js.
import { toDb } from '../audio.js';

export const COL_MS = 50; // one column per tick, 20 fps
export const BAR = 3;
export const GAP = 1;
export const ATTACK_MS = 80;
export const RELEASE_MS = 300;
export const MAX_STEP = 25; // % of full height per tick
const FADE_MIN = 0.35;
const LEVEL_BAR_H = 20; // reduced motion
const ZAP = typeof Path2D === 'undefined' ? null : new Path2D('M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z'); // Lucide zap

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** dBFS -> 0..100, same map as index.js soundVolumeLoad: -60 = 0, -20 = 100. */
export const levelPct = (db) => clamp(((db + 60) / 40) * 100, 0, 100);

/** One-pole low-pass (attack when rising, release when falling) over dt ms, then at most MAX_STEP change. */
export function smooth(prev, target, dt = COL_MS) {
  const tau = target > prev ? ATTACK_MS : RELEASE_MS;
  const next = prev + (target - prev) * (1 - Math.exp(-dt / tau));
  return prev + clamp(next - prev, -MAX_STEP, MAX_STEP);
}

/** Append v, keep exactly n columns (older ones drop off the left, missing ones pad with 0). */
export function pushCol(cols, v, n) {
  cols.push(v);
  if (cols.length > n) cols.splice(0, cols.length - n);
  while (cols.length < n) cols.unshift(0);
  return cols;
}

/** RMS dBFS of the analyser's current time-domain block. */
function analyserDb(an, buf) {
  an.getFloatTimeDomainData(buf);
  let ms = 0;
  for (let i = 0; i < buf.length; i++) ms += buf[i] * buf[i];
  return toDb(ms / buf.length);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{reducedMotion?:boolean, height?:number}} opts  height omitted: the canvas fills its CSS box (flex band).
 * attach(analyser) mic path; feed(db) sample path (no analyser); frame(db) reduced-motion path (0.5 s onFrame); detach() back to idle.
 */
export function createWave(canvas, { reducedMotion = false, height = 0 } = {}) {
  const g = canvas.getContext('2d');
  const fixedH = reducedMotion ? LEVEL_BAR_H : height;
  let H = fixedH;
  let analyser = null, buf = null, lastDb = -100, cols = [], level = 0, raf = 0, last = 0, idle = true, draws = 0, marks = [], pendingMark = false;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.width = '100%';
  if (fixedH) canvas.style.height = `${fixedH}px`;
  const css = (n) => getComputedStyle(canvas).getPropertyValue(n).trim();

  function size() {
    H = fixedH || canvas.clientHeight;
    const w = canvas.clientWidth, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return w;
  }

  function draw() {
    const w = size();
    if (!w || !H) return;
    draws++;
    g.clearRect(0, 0, w, H);
    const base = css('--wave-base') || css('--line'), bar = css('--wave') || css('--accent');
    if (reducedMotion) {
      g.fillStyle = base;
      g.fillRect(0, 0, w, H);
      g.fillStyle = bar;
      g.fillRect(0, 0, (w * level) / 100, H);
      return;
    }
    g.fillStyle = base;
    g.fillRect(0, Math.floor(H / 2), w, 1);
    if (idle) return;
    g.fillStyle = bar;
    cols.forEach((v, i) => {
      const half = 2 + (v / 100) * (H / 2 - 2);
      g.globalAlpha = FADE_MIN + ((1 - FADE_MIN) * i) / Math.max(1, cols.length - 1);
      g.beginPath();
      if (g.roundRect) g.roundRect(i * (BAR + GAP), H / 2 - half, BAR, half * 2, 2);
      else g.rect(i * (BAR + GAP), H / 2 - half, BAR, half * 2);
      g.fill();
    });
    g.globalAlpha = 1;
    g.strokeStyle = css('--ink') || '#000'; // sudden-sound marker: zap glyph above the bar, no colour change
    g.lineWidth = 2; g.lineJoin = g.lineCap = 'round';
    marks.forEach((m, i) => {
      if (!m || !ZAP) return;
      const half = 2 + (cols[i] / 100) * (H / 2 - 2);
      g.save();
      g.translate(Math.min(i * (BAR + GAP) - 6, w - 16), Math.max(0, H / 2 - half - 18));
      g.scale(16 / 24, 16 / 24);
      g.stroke(ZAP);
      g.restore();
    });
  }

  function tick(t) {
    raf = requestAnimationFrame(tick);
    if (document.hidden) { last = 0; return; }
    if (last && t - last < COL_MS - 8) return; // half a 60 Hz frame of slack so every 3rd frame fires
    last = t;
    const db = analyser ? analyserDb(analyser, buf) : lastDb;
    level = smooth(level, levelPct(db));
    const w = canvas.clientWidth;
    const n = Math.max(1, Math.floor((w + GAP) / (BAR + GAP)));
    pushCol(cols, level, n);
    pushCol(marks, pendingMark ? 1 : 0, n);
    pendingMark = false;
    draw();
  }

  function run() {
    if (reducedMotion || raf) return;
    idle = false; level = 0; cols = []; marks = []; pendingMark = false; last = 0;
    raf = requestAnimationFrame(tick);
  }

  return {
    attach(an) { analyser = an; buf = new Float32Array(an.fftSize); run(); },
    feed(db) { lastDb = db; if (!analyser) run(); },
    frame(db) { if (!reducedMotion) return; idle = false; level = levelPct(db); draw(); },
    detach() {
      analyser = null; lastDb = -100;
      if (raf) cancelAnimationFrame(raf);
      raf = 0; idle = true; level = 0; cols = []; marks = []; pendingMark = false;
      draw();
    },
    mark() { pendingMark = true; },
    redraw: draw,
    values: () => cols.slice(), // for tests
    get draws() { return draws; },
  };
}
