// Pure UI helpers (no DOM): labels, map projection, merging saved measurements, hour ranges.
export const GLYPH = { calm: "○", moderate: "△", high: "■", unknown: "◌" };
export const GROUP_KO = { alarm: "경보음", loudhuman: "큰 사람 소리", mechanical: "기계음", sustained: "지속 소음", speech: "말소리", calm: "조용함", other: "기타" };
export const STIMULI = [
  ["alarm", "경보음"], ["loudhuman", "큰 사람 소리"], ["mechanical", "기계음"],
  ["crowd", "사람 많은 곳"], ["announcement", "안내방송"], ["bright", "밝은 빛"],
];
export const STIMULUS_KO = Object.fromEntries(STIMULI);
export const KIND_KO = { outdoor: "야외", "public-indoor": "공공 실내", commercial: "상업 시설" };

export const hourLabel = (h) => (h === 0 ? "자정" : h === 12 ? "정오" : `${h < 12 ? "오전" : "오후"} ${h % 12}시`);
export const dayOf = (d) => (d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "weekday");
export const dayKo = (d) => (d === "weekend" ? "주말" : "평일");

/** Chip text of a slot: 무던함 / 후보 / 다소 부담 / 부담 높음 / 정보 부족. */
export const bandText = (sl) => (sl.band === "unknown" ? "정보 부족" : sl.band === "moderate" ? "다소 부담" : sl.recommend);
/** Provenance tag next to a number: demo seeds are never called plain 측정. */
export const sourceTag = (place, sl) => (sl.measured ? (place.demo ? "시연용 가상 측정" : "측정") : "추정");

const REASON = {
  soundType: "소리 종류가 주된 부담", soundVolume: "소리 크기가 주된 부담", crowd: "사람 많음이 주된 부담",
  brightness: "밝기가 주된 부담", caution: "주의: 민감하다고 설정한 소리가 있어요", insufficient: "혼잡 정보만 있어요",
};
export const reasonLine = (sl) => (sl.band === "calm" ? "큰 부담 요소가 없어요" : REASON[sl.reasonMain]);

/** Ascending index, unknown last, then by name. */
export const sortRows = (rows) =>
  [...rows].sort((a, b) => (a.sl.index ?? Infinity) - (b.sl.index ?? Infinity) || a.p.name.localeCompare(b.p.name, "ko"));

/** Contiguous runs of hours: [3,4,5,9] -> [[3,5],[9,9]]. */
export function ranges(hours) {
  const out = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else out.push([h, h]);
  }
  return out;
}
export const rangeText = (r) => r.map(([a, b]) => (a === b ? hourLabel(a) : `${hourLabel(a)}~${hourLabel(b)}`)).join(", ");

/** lat/lng -> x,y in a size x size box: equirectangular (x scaled by cos 37.55 deg), uniform fit of the places' bbox. */
export function frame(places, size = 360, margin = 52) {
  const pts = places.filter((p) => p.lat != null);
  const k = Math.cos((37.55 * Math.PI) / 180);
  const xs = pts.map((p) => p.lng * k), ys = pts.map((p) => -p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = (size - 2 * margin) / (Math.max(x1 - x0, y1 - y0) || 1);
  const ox = (size - (x1 - x0) * scale) / 2, oy = (size - (y1 - y0) * scale) / 2;
  return (lat, lng) => ({ x: ox + (lng * k - x0) * scale, y: oy + (-lat - y0) * scale });
}

/**
 * Schematic map positions in a size x size box (see frame), then a few push-apart passes so pins closer than
 * minDist stay tappable (minDist 0 = none; the app uses nudge() instead). Returns {id: {x, y}}.
 */
export function project(places, size = 360, margin = 52, minDist = 34) {
  const at = frame(places, size, margin);
  const q = places.filter((p) => p.lat != null).map((p) => ({ id: p.id, ...at(p.lat, p.lng) }));
  const lim = (v) => Math.min(size - 28, Math.max(28, v));
  for (let pass = 0; pass < 60 && minDist > 0; pass++) {
    for (let i = 0; i < q.length; i++)
      for (let j = i + 1; j < q.length; j++) {
        let dx = q[j].x - q[i].x, dy = q[j].y - q[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; } // identical points: separate along x
        const push = (minDist - d) / 2 + 0.1;
        q[i].x = lim(q[i].x - (dx / d) * push); q[i].y = lim(q[i].y - (dy / d) * push);
        q[j].x = lim(q[j].x + (dx / d) * push); q[j].y = lim(q[j].y + (dy / d) * push);
      }
  }
  return Object.fromEntries(q.map((p) => [p.id, { x: p.x, y: p.y }]));
}

/**
 * Collision pass: each pin may move in `step` px offsets, at most `cap` px from its true position and inside the box, to the
 * nearest spot at least minDist from every other pin; if none exists, to the spot with the largest clearance (cap hit).
 * A few sweeps let neighbours settle. Input {id: {x, y}} is not changed; returns a new map.
 */
export function nudge(pos, { size = 326, minDist = 40, step = 8, cap = 24, edge = 24 } = {}) {
  const offs = [];
  for (let dx = -cap; dx <= cap; dx += step) for (let dy = -cap; dy <= cap; dy += step) if (Math.hypot(dx, dy) <= cap) offs.push([dx, dy, Math.hypot(dx, dy)]);
  offs.sort((a, b) => a[2] - b[2]);
  const inBox = (v) => v >= edge && v <= size - edge;
  const out = Object.fromEntries(Object.entries(pos).map(([id, p]) => [id, { ...p }]));
  for (let sweep = 0; sweep < 6; sweep++) {
    for (const [id, p] of Object.entries(pos)) {
      const others = Object.entries(out).filter(([k]) => k !== id).map(([, o]) => o);
      const clear = (x, y) => Math.min(Infinity, ...others.map((o) => Math.hypot(o.x - x, o.y - y)));
      let best = null;
      for (const [dx, dy] of offs) {
        const x = p.x + dx, y = p.y + dy;
        if ((dx || dy) && !(inBox(x) && inBox(y))) continue;
        const c = clear(x, y);
        if (c >= minDist) { best = { x, y, c }; break; }
        if (!best || c > best.c) best = { x, y, c };
      }
      out[id] = { x: best.x, y: best.y };
    }
  }
  return out;
}

/**
 * Dong label spots: one per dong, at the mean of its pins, moved to the nearest free spot (clear of pins and earlier labels,
 * inside the box). Least overlap wins when nothing is free. Returns [{name, x, y, box, area}] (x, y = label centre).
 */
export function dongLabels(places, pos, size = 326) {
  const by = new Map();
  for (const p of places) if (pos[p.id]) (by.get(p.dong) ?? by.set(p.dong, []).get(p.dong)).push(pos[p.id]);
  const boxes = Object.values(pos).map((o) => [o.x - 16, o.y - 16, o.x + 16, o.y + 16]);
  const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const out = [];
  for (const [name, ps] of by) {
    const cx = ps.reduce((a, o) => a + o.x, 0) / ps.length, cy = ps.reduce((a, o) => a + o.y, 0) / ps.length;
    const w = [...name].length * 11 + 6, hh = 16;
    let best = null;
    search: for (const r of [0, 22, 30, 38, 46]) {
      for (let k = 0; k < (r ? 16 : 1); k++) {
        const ang = (k / 16) * 2 * Math.PI;
        const x = Math.min(size - w / 2 - 2, Math.max(w / 2 + 2, cx + Math.cos(ang) * r * 1.4)), y = Math.min(size - 10, Math.max(10, cy + Math.sin(ang) * r));
        const box = [x - w / 2, y - hh / 2, x + w / 2, y + hh / 2];
        const area = [...boxes, ...out.map((o) => o.box)].reduce((a, q) => a + overlap(box, q), 0);
        if (!best || area < best.area) best = { name, x, y, box, area };
        if (!area) break search;
      }
    }
    out.push(best);
  }
  return out;
}

/** Calm-first summary of a set of {p, sl} rows: calm candidates, or (none) the lowest-index measured places. */
export function summarize(rows) {
  const sorted = sortRows(rows);
  const calm = sorted.filter((r) => r.sl.band === "calm");
  if (calm.length) return { count: calm.length, rows: calm.slice(0, 3), fallback: false };
  return { count: 0, rows: sorted.filter((r) => r.sl.band !== "unknown").slice(0, 3), fallback: true };
}

export const customId = (c) => `custom:${c.dongCode}:${c.name}`;
/** Unique dongs of the base places: [{code, name}]. */
export const dongsOf = (base) => [...new Map(base.map((p) => [p.dong_code, { code: p.dong_code, name: p.dong }])).values()];

/**
 * Places with saved measurements merged in (before slot()). Saved entries with `custom` make list-only places
 * (no lat/lng, so no map pin) that reuse the crowd shape of their dong.
 */
export function withSaved(base, saved) {
  const all = base.map((p) => ({ ...p, measurements: [...p.measurements, ...saved.filter((m) => m.placeId === p.id)] }));
  const customs = new Map();
  for (const m of saved) {
    if (!m.custom) continue;
    const id = customId(m.custom);
    if (!customs.has(id)) {
      const host = base.find((p) => p.dong_code === m.custom.dongCode);
      customs.set(id, { id, name: m.custom.name, kind: "commercial", type: "custom", demo: false, custom: true, lat: null, lng: null,
        dong: host?.dong ?? "", dong_code: m.custom.dongCode, crowd: host?.crowd ?? { weekday: [], weekend: [] }, measurements: [] });
    }
    customs.get(id).measurements.push(m);
  }
  return [...all, ...customs.values()];
}

/** Keep only well-formed saved measurements (storage may hold anything). */
export const cleanSaved = (x) =>
  (Array.isArray(x) ? x : []).filter((m) => m && m.summary && typeof m.summary.dbMedian === "number" && (m.placeId || m.custom?.name) &&
    (m.daytype === "weekday" || m.daytype === "weekend") && Number.isInteger(m.hour) && m.hour >= 0 && m.hour <= 23);
