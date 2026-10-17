// Calm Map (무던한 지도): wires places.json -> index.js slots -> map, list, sheet; measure tab; profile tab.
// Stored in localStorage: calm.profile, calm.measurements (summary numbers only), calm.texts (edited sentences). Never audio.
import { slot } from "./index.js";
import { h, s, store } from "./ui/dom.js";
import { GLYPH, STIMULI, bandText, cleanSaved, dayOf, dongLabels, dongsOf, frame, hourLabel, nudge, project, reasonLine, sortRows, sourceTag, summarize, withSaved, KIND_KO } from "./ui/helpers.js";
import { RIVER } from "./ui/river.js";
import { createSheet } from "./ui/sheet.js";
import { createMeasureTab } from "./ui/measureTab.js";

const $ = (id) => document.getElementById(id);
const SIZE = 326; // reference map width in px (390 px phone): collision and label placement are computed here, positions are stored as %
const now = new Date();
const state = {
  base: [], day: dayOf(now), hour: now.getHours(), selected: null, showUnknown: true,
  profile: { sensitive: [], ...store.get("calm.profile", {}) },
  saved: cleanSaved(store.get("calm.measurements", [])),
  texts: store.get("calm.texts", {}),
};
if (!Array.isArray(state.profile.sensitive)) state.profile.sensitive = [];
if (typeof state.texts !== "object" || !state.texts) state.texts = {};

let all = [], slots = new Map(), pos = {}, measureTab, sheet;
const pins = new Map();

function recompute() {
  all = withSaved(state.base, state.saved);
  slots = new Map(all.map((p) => [p.id, slot(p, state.day, state.hour, all, state.profile)]));
}
const announce = (msg) => ($("live").textContent = msg);

// ---- map + list ----
function buildMap() {
  const map = $("map");
  const at = frame(state.base, SIZE, 40);
  const river = RIVER.map(([la, ln]) => at(la, ln)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  map.append(s("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, "aria-hidden": "true", preserveAspectRatio: "none" },
    s("polyline", { class: "river", points: river, fill: "none", "stroke-linejoin": "round", "stroke-linecap": "round" })));
  const label = (text, x, y, cls = "dong") => {
    const el = h("span", { class: cls, "aria-hidden": "true" }, text);
    el.style.left = `${(x / SIZE) * 100}%`; el.style.top = `${(y / SIZE) * 100}%`;
    map.append(el);
  };
  const rv = RIVER.map(([la, ln]) => at(la, ln)).find((q) => q.x > 24 && q.x < SIZE - 24 && q.y > 24 && q.y < SIZE - 20);
  if (rv) label("한강", rv.x, rv.y - 6, "dong river-name");
  for (const d of dongLabels(state.base, pos, SIZE)) label(d.name, d.x, d.y);
  for (const p of state.base) {
    if (!pos[p.id]) continue;
    const pin = h("button", { type: "button", class: "pin", "data-id": p.id, onclick: () => openPlace(p.id) }, h("span", { class: "dot", "aria-hidden": "true" }));
    pin.style.left = `${(pos[p.id].x / SIZE) * 100}%`;
    pin.style.top = `${(pos[p.id].y / SIZE) * 100}%`;
    pins.set(p.id, pin);
    map.append(pin);
  }
}

function renderMap() {
  for (const [id, pin] of pins) {
    const sl = slots.get(id), p = all.find((q) => q.id === id);
    pin.className = `pin b-${sl.band}${state.selected === id ? " sel" : ""}`;
    pin.dataset.band = sl.band;
    pin.hidden = sl.band === "unknown" && !state.showUnknown;
    pin.querySelector(".dot").textContent = sl.band === "unknown" ? "" : GLYPH[sl.band]; // the hatch is the unknown mark
    pin.setAttribute("aria-label", `${p.name}, ${bandText(sl)}`);
  }
}

const shown = () => all.map((p) => ({ p, sl: slots.get(p.id) })).filter(({ sl }) => state.showUnknown || sl.band !== "unknown");

function renderList() {
  const rows = sortRows(shown());
  $("list").replaceChildren(...rows.map(({ p, sl }) => h("li", null,
    h("button", { type: "button", class: `item b-${sl.band}`, "data-id": p.id, "data-band": sl.band, onclick: () => openPlace(p.id) },
      h("span", { class: `chip b-${sl.band}` }, h("span", { "aria-hidden": "true" }, GLYPH[sl.band]), bandText(sl)),
      h("span", null, h("span", { class: "name" }, p.name), h("span", { class: "meta" }, `${KIND_KO[p.kind]}${p.custom ? " · 내가 측정" : ""} · ${reasonLine(sl)}${sl.status === "ok" ? ` (${sourceTag(p, sl)})` : " (추정)"}`)),
      h("span", { class: "chev", "aria-hidden": "true" }, "›")))));
}

function renderSummary() {
  const rows = all.map((p) => ({ p, sl: slots.get(p.id) }));
  const { count, rows: top, fallback } = summarize(rows);
  const unknown = rows.filter((r) => r.sl.band === "unknown").length;
  $("summary").replaceChildren(...[
    h("h2", { class: "sum-title" }, fallback ? "지금 무던함 후보가 없어요" : `${hourLabel(state.hour)}, 무던함 후보 ${count}곳`),
    fallback && h("p", { class: "caption" }, top.length ? "소리를 잰 곳 중 부담이 낮은 순서예요." : "소리를 잰 곳이 아직 없어요."),
    h("ul", { class: "list" }, top.map(({ p, sl }) => h("li", null,
      h("button", { type: "button", class: `srow b-${sl.band}`, "data-id": p.id, onclick: () => openPlace(p.id) },
        h("span", { class: `chip b-${sl.band}` }, h("span", { "aria-hidden": "true" }, GLYPH[sl.band]), bandText(sl)),
        h("span", null, h("span", { class: "name" }, p.name), h("span", { class: "meta" }, `${reasonLine(sl)}${p.demo ? "" : ` (${sourceTag(p, sl)})`}`)), // demo names already carry 시연용 가상 측정
        h("span", { class: "chev", "aria-hidden": "true" }, "›")))))].filter(Boolean));
  const tgl = $("tgl-unknown");
  tgl.textContent = `${state.showUnknown ? "✓ " : ""}정보 부족 ${unknown}곳 포함`;
  tgl.setAttribute("aria-pressed", String(state.showUnknown));
}

function renderTop() {
  $("hour").value = state.hour;
  $("hour").setAttribute("aria-valuetext", hourLabel(state.hour));
  $("hour-out").textContent = hourLabel(state.hour);
  for (const d of ["weekday", "weekend"]) $(`day-${d}`).setAttribute("aria-pressed", String(state.day === d));
}

function renderAll() { recompute(); renderTop(); renderSummary(); renderMap(); renderList(); measureTab?.refresh(); measureTab?.syncTime(); }

// ---- sheet ----
function openPlace(id) {
  state.selected = id;
  renderMap();
  sheet.open(all.find((p) => p.id === id), {
    day: state.day, hour: state.hour, profile: state.profile, all, texts: state.texts,
    saveText(key, value) { value == null ? delete state.texts[key] : (state.texts[key] = value); store.set("calm.texts", state.texts); },
    goMeasure(pid) { selectTab("measure"); measureTab.preselect(pid); },
  });
}

// ---- tabs ----
const TABS = ["map", "measure", "profile"];
function selectTab(name, focus = true) {
  if (name !== "measure") measureTab?.leave();
  TABS.forEach((t) => {
    $(`panel-${t}`).hidden = t !== name;
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`tab-${t}`).tabIndex = t === name ? 0 : -1;
  });
  $("day-weekday").parentElement.hidden = name !== "map"; // day is chosen on the map tab; 측정 has its own select
  $("hist-btn").hidden = name !== "measure";
  document.body.dataset.tab = name; // 측정 is a one-screen layout (css)
  window.scrollTo(0, 0);
  if (focus) $(`tab-${name}`).focus();
}
function bindTabs() {
  TABS.forEach((t, i) => {
    $(`tab-${t}`).addEventListener("click", () => selectTab(t, false));
    $(`tab-${t}`).addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(TABS[(i + d + 3) % 3]); }
    });
  });
}

// ---- profile tab ----
function buildProfile() {
  const root = $("panel-profile");
  const sw = STIMULI.map(([key, label]) => {
    const on = () => state.profile.sensitive.includes(key);
    const btn = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on()), "data-key": key, "aria-label": `${label} 매우 민감`,
      onclick: () => {
        const set = new Set(state.profile.sensitive);
        set.has(key) ? set.delete(key) : set.add(key);
        state.profile.sensitive = [...set];
        store.set("calm.profile", state.profile);
        btn.setAttribute("aria-checked", String(on()));
        renderAll();
        announce(`${label} 민감 설정 ${on() ? "켬" : "끔"}`);
      } }, h("span", null, label), h("span", { class: "track", "aria-hidden": "true" }));
    return btn;
  });
  root.append(
    h("h2", { class: "screen-title" }, "내 아이"),
    h("p", { class: "sub" }, "아이가 매우 민감한 항목을 켜 두면, 그 소리가 관측된 곳은 '주의'로 표시돼요."),
    ...sw,
    h("button", { type: "button", class: "btn sec2", id: "profile-reset", onclick: () => {
      state.profile.sensitive = []; store.set("calm.profile", state.profile);
      sw.forEach((b) => b.setAttribute("aria-checked", "false")); renderAll(); announce("설정을 모두 껐어요");
    } }, "모두 끄기"),
    h("p", { class: "caption" }, "이 설정은 이 폰에만 저장돼요."),
    h("div", { class: "foot" },
      h("h3", null, "자료 출처"),
      h("ul", null,
        h("li", null, "혼잡: 서울 열린데이터광장 OA-14991 행정동 단위 서울 생활인구(내국인), 2026년 6~7월, 공공누리 1유형. 동 전체 인구라서 가게 안 사람 수가 아니에요."),
        h("li", null, "소리 분류: YAMNet (Apache-2.0), 이 폰 안에서 실행해요."),
        h("li", null, "지도의 한강 선: © OpenStreetMap contributors (ODbL).")),
      h("h3", null, "한계"),
      h("ul", null,
        h("li", null, "소리 크기(dBFS)는 폰마다 달라 보정되지 않은 상대값이에요."),
        h("li", null, "혼잡은 추정이에요. 소리를 직접 측정하지 않은 곳은 '정보 부족'이에요."),
        h("li", null, "밝기·깜빡임은 센서가 없으면 '미측정'이에요."),
        h("li", null, "소리 분류는 틀릴 수 있어요. 샘플 몇 개로 확인한 시연 단계예요."),
        h("li", null, "지수는 환경 정보예요. 아이의 반응을 진단하거나 보장하지 않아요.")),
      h("h3", null, "시연용 가상 측정"),
      h("p", null, "'예시 … (시연용 가상 측정)' 장소는 실제 매장이 아니에요. 보여 주기 위해 만든 값이에요."),
      h("p", null, "원음은 저장·전송되지 않아요. 분석은 이 폰 안에서만 해요.")));
}

// ---- boot ----
async function main() {
  const res = await fetch("data/places.json");
  const data = await res.json();
  state.base = data.places;
  pos = nudge(project(state.base, SIZE, 40, 0), { size: SIZE });
  buildMap();
  buildProfile();
  bindTabs();
  sheet = createSheet($("sheet"), () => { state.selected = null; renderMap(); });
  measureTab = createMeasureTab({
    root: $("panel-measure"), announce, historyBtn: $("hist-btn"), dongs: dongsOf(state.base), get day() { return state.day; }, get hour() { return state.hour; },
    places: () => all, saved: () => state.saved,
    addSaved(entry) { state.saved.push(entry); store.set("calm.measurements", state.saved); renderAll(); announce("측정을 저장했어요"); },
    removeSaved(i) { state.saved.splice(i, 1); store.set("calm.measurements", state.saved); renderAll(); },
  });
  $("tgl-unknown").addEventListener("click", () => { state.showUnknown = !state.showUnknown; renderAll(); });
  $("hour").addEventListener("input", (e) => { state.hour = Number(e.target.value); renderAll(); });
  for (const d of ["weekday", "weekend"]) $(`day-${d}`).addEventListener("click", () => { state.day = d; renderAll(); });
  renderAll();
  document.body.dataset.ready = "1";
}
main().catch((e) => {
  console.error(e);
  document.querySelector("main").prepend(h("p", { class: "err", role: "alert" }, "장소 정보를 불러오지 못했어요. 새로고침해 주세요."));
});
