// Pure measurement accumulator over audio.js frames. No DOM. db is uncalibrated dBFS (relative).
const GROUPS = ['alarm', 'loudhuman', 'mechanical', 'sustained', 'speech', 'calm', 'other'];
const BG_WINDOW = 60; // s of history for the background P10
const MIN_HISTORY = 10; // s of history before suddenness can fire
const RISE_DB = 10;
const CHIME_SPEECH_S = 3;

/** Percentile (0..1) of a numeric array, linear interpolation. */
export function percentile(values, p) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const x = (v.length - 1) * p;
  const lo = Math.floor(x);
  return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (x - lo);
}

/** @returns {{push(frame:{ts:number,db:number,group:string,chime?:boolean}):void, summary():object}} */
export function createMeasurement() {
  const frames = []; // {t (s), db, group}
  let suddenCount = 0;
  let announcementCount = 0;
  let prevSudden = false;
  let lastChimeT = -Infinity;
  let counted = false; // announcement already counted for the current speech-after-chime run

  return {
    push(f) {
      const t = f.ts / 1000;
      const bg = frames.filter((x) => x.t >= t - BG_WINDOW).map((x) => x.db);
      const history = frames.length ? t - frames[0].t : 0;
      const sudden =
        history >= MIN_HISTORY && bg.length > 0 && f.db >= percentile(bg, 0.1) + RISE_DB;
      const newSudden = sudden && !prevSudden;
      if (newSudden) suddenCount++;
      prevSudden = sudden;
      if (f.chime) {
        lastChimeT = t;
        counted = false;
      }
      const afterChime = f.group === 'speech' && t - lastChimeT <= CHIME_SPEECH_S && t > lastChimeT;
      if ((newSudden && f.group === 'speech') || (afterChime && !counted)) {
        announcementCount++;
        if (afterChime) counted = true;
      }
      frames.push({ t, db: f.db, group: f.group });
    },
    summary() {
      const n = frames.length;
      const dbs = frames.map((x) => x.db);
      const groupSeconds = Object.fromEntries(GROUPS.map((g) => [g, 0]));
      // each frame stands for the gap to the next frame (last frame: median gap)
      const gaps = frames.slice(1).map((x, i) => x.t - frames[i].t);
      const dt = percentile(gaps, 0.5) ?? 0;
      frames.forEach((x, i) => {
        groupSeconds[x.group] += i < n - 1 ? gaps[i] : dt;
      });
      const present = {};
      for (const g of GROUPS.slice(0, 5)) present[g] = groupSeconds[g] >= 2;
      return {
        durationSec: n ? frames[n - 1].t - frames[0].t + dt : 0,
        nFrames: n,
        dbMedian: percentile(dbs, 0.5),
        dbP10: percentile(dbs, 0.1),
        dbP95: percentile(dbs, 0.95),
        suddenCount,
        announcementCount,
        groupSeconds,
        present,
        calibrated: false,
      };
    },
  };
}
