// Sensory index for Calm Map (무던한 지도). Pure ES module: no DOM, no network, no globals.
// All text comes from fixed templates (no generative AI). Rules follow docs/CONTRACT.md v2.
//
// Sub-loads, each 0..100 or null (null = unknown, never treated as 0):
//   crowd        100 * dong population at (daytype, hour) / max over all places, hours, daytypes (public data, 추정)
//   soundVolume  dbMedian mapped linearly -60 dBFS -> 0 ... -20 dBFS -> 100 (relative, uncalibrated, not SPL)
//   soundType    max priority of the sound groups present: alarm 100, loudhuman 80, mechanical 60,
//                sustained 30, speech 20; 80 at least when a sudden or announcement-like event was seen
//   brightness   min(100, lux / 10); null when the phone had no light sensor ("미측정")
// Composite index = MAX of the non-null sub-loads (no averaging: a quiet room does not cancel an alarm).
// A stimulus the guardian marked "very sensitive" that was actually observed forces index >= 70.
// Bands: < 40 calm, < 70 moderate, else high; no sound measurement => "insufficient", grey, index null.
// Hours without a measurement: with one measurement it applies to all hours of that daytype (upper-bound use);
// with two or more, volume and type are interpolated against the crowd shape of the dong, unless the louder
// measurement was taken at a not-more-crowded hour (opposite direction): then unmeasured hours stay insufficient.

const GROUP_LOAD = { alarm: 100, loudhuman: 80, mechanical: 60, sustained: 30, speech: 20 };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (x) => typeof x === "number" && Number.isFinite(x);

/** Crowd load 0..100 of a place at (daytype, hour), relative to the busiest place-hour; null if no data. */
export function crowdLoad(place, daytype, hour, allPlaces) {
  const v = place?.crowd?.[daytype]?.[hour];
  if (!num(v)) return null;
  let max = 0;
  for (const p of allPlaces ?? [place]) {
    for (const d of ["weekday", "weekend"]) for (const x of p.crowd?.[d] ?? []) if (num(x) && x > max) max = x;
  }
  return max > 0 ? clamp((100 * v) / max, 0, 100) : null;
}

/** Sound volume load 0..100 from summary.dbMedian (-60 dBFS = 0, -20 dBFS = 100); null if unknown. */
export function soundVolumeLoad(summary) {
  if (!num(summary?.dbMedian)) return null;
  return clamp(((summary.dbMedian + 60) / 40) * 100, 0, 100);
}

/** Sound type load 0..100: max priority of present groups, 80 at least on a sudden/announcement event; null if unknown. */
export function soundTypeLoad(summary) {
  if (!summary?.present) return null;
  let load = 0;
  for (const [g, on] of Object.entries(summary.present)) if (on) load = Math.max(load, GROUP_LOAD[g] ?? 0);
  if (summary.suddenCount >= 1 || summary.announcementCount >= 1) load = Math.max(load, 80);
  return load;
}

/** Brightness load 0..100 from lux (1000 lux = 100); null stays null ("미측정"). */
export function brightnessLoad(lux) {
  return num(lux) ? Math.min(100, Math.max(0, lux / 10)) : null;
}

const bandOf = (i) => (i < 40 ? "calm" : i < 70 ? "moderate" : "high");
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => (a === null || b === null ? null : lerp(a, b, t));

/** Sub-loads of one measurement (volume, type, brightness). */
function loadsOf(m) {
  return { vol: soundVolumeLoad(m.summary), type: soundTypeLoad(m.summary), bri: brightnessLoad(m.lux) };
}

/** Picks the sound/brightness loads for an hour: {vol, type, bri, measured, used:[measurements]} or null (insufficient). */
function soundAt(place, daytype, hour, allPlaces) {
  const ms = (place.measurements ?? []).filter((m) => m.daytype === daytype && loadsOf(m).vol !== null);
  if (!ms.length) return null;
  const near = ms.filter((m) => Math.abs(m.hour - hour) <= 1).sort((a, b) => Math.abs(a.hour - hour) - Math.abs(b.hour - hour));
  if (near.length) return { ...loadsOf(near[0]), measured: true, used: [near[0]] };
  if (ms.length === 1) return { ...loadsOf(ms[0]), measured: false, used: ms };
  const byVol = [...ms].sort((a, b) => loadsOf(a).vol - loadsOf(b).vol);
  const A = byVol[0], B = byVol[byVol.length - 1];
  const cA = crowdLoad(place, daytype, A.hour, allPlaces), cB = crowdLoad(place, daytype, B.hour, allPlaces);
  const c = crowdLoad(place, daytype, hour, allPlaces);
  if (cA === null || cB === null || c === null || cB <= cA) return null; // opposite direction: do not guess
  const t = clamp((c - cA) / (cB - cA), 0, 1);
  const a = loadsOf(A), b = loadsOf(B);
  return { vol: lerp(a.vol, b.vol, t), type: mix(a.type, b.type, t), bri: t < 0.5 ? a.bri : b.bri, measured: false, used: ms };
}

/**
 * One (place, daytype, hour) cell.
 * profile: {sensitive: ["alarm"|"loudhuman"|"mechanical"|"crowd"|"announcement"|"bright", ...]}
 * Returns {status, daytype, hour, crowd, soundVolume, soundType, brightness, index, band, measured, caution, reasonMain, recommend}.
 * reasonMain is the sub-load that sets the index: soundType | soundVolume | crowd | brightness | caution | insufficient.
 */
export function slot(place, daytype, hour, allPlaces, profile = {}) {
  const sensitive = profile.sensitive ?? [];
  const crowd = crowdLoad(place, daytype, hour, allPlaces);
  const s = soundAt(place, daytype, hour, allPlaces);
  const caution = [];
  const flag = (key, observed) => sensitive.includes(key) && observed && caution.push(key);
  flag("crowd", crowd !== null && crowd >= 70);
  if (!s) {
    return { status: "insufficient", daytype, hour, crowd, soundVolume: null, soundType: null, brightness: null,
      index: null, band: "unknown", measured: false, caution, reasonMain: "insufficient", recommend: null };
  }
  for (const m of s.used) {
    const p = m.summary?.present ?? {};
    for (const g of ["alarm", "loudhuman", "mechanical"]) if (!caution.includes(g)) flag(g, p[g]);
    if (!caution.includes("announcement")) flag("announcement", m.summary?.announcementCount >= 1);
  }
  flag("bright", s.bri !== null && s.bri >= 70);
  const loads = [["soundType", s.type], ["soundVolume", s.vol], ["crowd", crowd], ["brightness", s.bri]].filter(([, v]) => v !== null);
  let [reasonMain, index] = loads.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  if (caution.length && index < 70) { index = 70; reasonMain = "caution"; }
  const band = bandOf(index);
  const recommend = band === "high" ? "부담 높음" : band === "calm" ? (s.measured ? "무던함" : "후보") : null;
  return { status: "ok", daytype, hour, crowd, soundVolume: s.vol, soundType: s.type, brightness: s.bri, index, band,
    measured: s.measured, caution, reasonMain, recommend };
}

// ---- sentences (fixed templates) ----
const hourWord = (h) => (h === 0 ? "자정" : h === 12 ? "정오" : `${h < 12 ? "오전" : "오후"} ${h % 12}시`);
const hasFinal = (ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 && c % 28 !== 0; };
const topic = (name) => name + (hasFinal(name[name.length - 1]) ? "은" : "는");
const shortName = (name) => name.replace(/\s*\(.*$/, "");
const level = (x) => (x < 40 ? "적은 편" : x < 70 ? "보통 수준" : "많은 편");
const CAUTION_WORD = { alarm: "경보음", loudhuman: "큰 사람 소리", mechanical: "기계 소리", crowd: "붐비는 사람", announcement: "갑작스러운 안내방송", bright: "밝은 빛" };
const REASON = {
  soundType: "소리의 종류가 부담이 될 수 있어요",
  soundVolume: "소리가 큰 편이에요",
  crowd: "사람이 많은 편이에요",
  brightness: "빛이 밝은 편이에요",
  caution: "예민하다고 표시한 자극이 있었어요",
};
const BAND_LEAD = { calm: "비교적 무던할 수 있어요", moderate: "다소 부담이 있을 수 있어요", high: "부담이 클 수 있어요" };

/** Rule-filled Korean sentence for a slot; ends with the tag "(추정)", or "(측정)" when the slot is measured. */
export function sentence(place, sl) {
  const who = `${hourWord(sl.hour)} ${topic(shortName(place.name))}`;
  const tag = sl.measured ? "(측정)" : "(추정)";
  if (sl.status === "insufficient") {
    const crowdPart = sl.crowd === null ? "사람 수 정보도 없어요" : `사람은 ${level(sl.crowd)}으로 보여요`;
    return `${who} ${crowdPart}. 소리는 아직 측정 전이라 알 수 없어요. ${tag}`;
  }
  const reason = sl.reasonMain === "caution" ? "" : ` ${REASON[sl.reasonMain]}.`;
  const cau = sl.caution.length ? ` ${sl.caution.map((k) => CAUTION_WORD[k]).join(", ")}에 예민하다고 표시했는데 만날 수 있어요.` : "";
  return `${who} ${BAND_LEAD[sl.band]}.${reason}${cau} ${tag}`;
}

const COPING = {
  alarm: "경보음이 날 수 있어요. 귀마개나 헤드폰을 챙겨요.",
  loudhuman: "큰 소리가 갑자기 날 수 있어요. 미리 알려주고 출구 가까운 자리를 골라요.",
  mechanical: "기계 소리가 날 수 있어요. 소리 나는 곳에서 먼 자리를 골라요.",
  crowd: "사람이 많을 수 있어요. 덜 붐비는 시간으로 옮겨 볼 수 있어요.",
  announcement: "안내방송이 갑자기 나올 수 있어요. 방송이 나온다고 미리 말해 줘요.",
  bright: "빛이 밝을 수 있어요. 모자나 선글라스를 챙겨요.",
};

/** One fixed-template story card (add-on): {title, steps:[3 sentences], expected, coping}. */
export function storyCard(place, sl) {
  const name = shortName(place.name);
  const tag = sl.measured ? "(측정)" : "(추정)";
  const mid = sl.status === "insufficient" ? "소리는 아직 측정 전이라, 들어가서 잠깐 서서 들어 봐요." : `${REASON[sl.reasonMain]}. 그래도 천천히 둘러볼 수 있어요.`;
  return {
    title: `${hourWord(sl.hour)} ${name} 가는 날`,
    steps: [`${name}에 도착하면 입구에서 잠깐 서서 소리와 사람을 살펴봐요.`, mid, "힘들면 조용한 곳으로 나가서 쉬어요."],
    expected: sl.status === "insufficient" ? `소리 정보가 부족해요 ${tag}.` : `${BAND_LEAD[sl.band]} ${tag}.`,
    coping: sl.caution.length ? sl.caution.map((k) => COPING[k]).join(" ") : "힘들면 언제든 나와도 괜찮다고 미리 말해 줘요.",
  };
}
