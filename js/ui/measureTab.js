// 측정 tab: live on-device listening (audio.js) -> measure.js summary -> localStorage `calm.measurements` (summary numbers only).
import { createListener } from "../audio.js";
import { createMeasurement } from "../measure.js";
import { h } from "./dom.js";
import { GROUP_KO, dayKo, hourLabel } from "./helpers.js";

const SAMPLES = [
  ["restaurant", "붐비는 식당"], ["quiet-then-siren", "조용하다 사이렌"], ["siren", "사이렌"], ["traffic", "도로 소음"], ["crowd", "사람들 웅성임"],
  ["speech", "말소리"], ["music", "음악"], ["birds", "새소리"], ["baby-cry", "아기 울음"], ["chainsaw", "전기톱"], ["street-sweeper", "청소차"],
];
const NEW = "__new";
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** ctx: {root, places(), dongs, day, hour, saved(), addSaved(entry), removeSaved(i), announce(msg)} -> {preselect(id)} */
export function createMeasureTab(ctx) {
  const root = ctx.root;
  let listener = null, meas = null, running = false, kind = "mic", lux = null, sensor = null;
  let firstTs = 0, lastSudden = 0, suddenAt = null, final = null;

  const place = h("select", { id: "m-place", onchange: syncNew });
  const nameIn = h("input", { type: "text", id: "m-name", maxlength: "20", placeholder: "예: 우리 동네 카페" });
  const dongSel = h("select", { id: "m-dong" });
  const newBox = h("div", { hidden: true }, h("div", { class: "field" }, h("label", { for: "m-name" }, "장소 이름"), nameIn),
    h("div", { class: "field" }, h("label", { for: "m-dong" }, "가까운 동 (그 동의 혼잡 추정을 써요)"), dongSel), h("p", { class: "caption" }, "지도 핀 없이 목록에만 나와요."));
  const daySel = h("select", { id: "m-day", "aria-label": "요일 구분" }, h("option", { value: "weekday" }, "평일"), h("option", { value: "weekend" }, "주말"));
  const hourSel = h("select", { id: "m-hour", "aria-label": "측정 시간대" }, Array.from({ length: 24 }, (_, i) => h("option", { value: String(i) }, hourLabel(i))));
  const sampleSel = h("select", { id: "m-sample", "aria-label": "샘플 소리 고르기" }, SAMPLES.map(([f, n]) => h("option", { value: f }, n)));
  const err = h("div", { class: "err", role: "alert", hidden: true });
  const status = h("p", { class: "caption", role: "status" });
  const micBtn = h("button", { type: "button", class: "btn xl", id: "m-start", onclick: () => (running ? stop() : begin("mic")) }, "마이크로 측정 시작");
  const micCap = h("p", { class: "caption" }, "마이크 권한이 필요해요.");
  const smpBtn = h("button", { type: "button", class: "btn sec2", id: "m-sample-go", onclick: () => (running ? stop() : begin("sample")) }, "샘플 소리로 보기");

  // live card
  const gEl = h("div", { class: "big-group" }, "-"), enEl = h("div", { class: "en", lang: "en" }, " ");
  const meterBar = h("i"), meter = h("div", { class: "meter", role: "meter", "aria-label": "상대 소리 크기", "aria-valuemin": "-100", "aria-valuemax": "0" }, meterBar);
  const dbEl = h("span"), timeEl = h("span"), suddenEl = h("div", { class: "chip plain", hidden: true }), annEl = h("div", { class: "chip plain", hidden: true }, "안내방송 추정");
  const live = h("div", { class: "card", id: "m-live", hidden: true }, h("p", { class: "lbl" }, "지금 들리는 소리"), gEl, enEl,
    h("div", { class: "row" }, h("span", { class: "caption" }, "소리 크기 (상대값, 보정 안 됨)"), dbEl), meter,
    h("div", { class: "chips" }, suddenEl, annEl), h("dl", { class: "kv" }, h("dt", null, "경과"), h("dd", null, timeEl), h("dt", null, "밝기"), h("dd", null, "미측정")));
  const result = h("div", { class: "card", id: "m-result", hidden: true });

  const savedBox = h("ul", { class: "saved", id: "m-saved" });
  root.append(
    h("h2", { class: "screen-title" }, "측정"),
    h("p", { class: "sub" }, "이 폰이 소리를 듣고 요약 숫자만 남겨요."),
    h("div", { class: "card" },
      h("div", { class: "field" }, h("label", { for: "m-place" }, "장소"), place), newBox,
      h("div", { class: "grid2" }, h("div", { class: "field" }, h("label", { for: "m-day" }, "요일"), daySel), h("div", { class: "field" }, h("label", { for: "m-hour" }, "시간대"), hourSel)),
      micBtn, micCap,
      h("div", { class: "field", style: "margin-top:12px" }, h("label", { for: "m-sample" }, "마이크 없이 체험"), sampleSel), smpBtn, err, status),
    h("div", { class: "privacy" }, "원음은 저장·전송되지 않아요. 분석은 이 폰 안에서만 해요."),
    live, result,
    h("h2", { class: "sec" }, "내 측정"), savedBox, h("p", { class: "caption" }, "샘플 소리 측정은 시연용이에요. 실제 장소를 잰 값이 아니에요."));

  function fillPlaces() {
    const cur = place.value;
    place.replaceChildren(...ctx.places().map((p) => h("option", { value: p.id }, p.name)), h("option", { value: NEW }, "+ 내 장소 추가"));
    place.value = [...place.options].some((o) => o.value === cur) ? cur : place.options[0].value;
    dongSel.replaceChildren(...ctx.dongs.map((d) => h("option", { value: d.code }, d.name)));
    syncNew();
  }
  function syncNew() { newBox.hidden = place.value !== NEW; }
  function syncTime() { daySel.value = ctx.day; hourSel.value = String(ctx.hour); }

  function setError(msg) { err.hidden = !msg; err.textContent = msg ?? ""; }
  function setRunning(on) {
    running = on;
    micBtn.textContent = on && kind === "mic" ? "측정 끝내기" : "마이크로 측정 시작";
    smpBtn.textContent = on && kind === "sample" ? "측정 끝내기" : "샘플 소리로 보기";
    (kind === "mic" ? smpBtn : micBtn).disabled = on;
    micCap.textContent = on && kind === "sample" ? "샘플 소리 측정을 끝내면 쓸 수 있어요." : "마이크 권한이 필요해요.";
    for (const el of [place, nameIn, dongSel, daySel, hourSel, sampleSel]) el.disabled = on;
  }

  function onFrame(f) {
    status.textContent = "듣는 중이에요";
    if (!firstTs) firstTs = f.ts;
    meas.push(f);
    const s = meas.summary();
    gEl.textContent = GROUP_KO[f.group];
    enEl.textContent = `${f.topClass} (${Math.round(f.topScore * 100)}%)`;
    dbEl.textContent = `${f.db.toFixed(0)} dBFS`;
    meter.setAttribute("aria-valuenow", f.db.toFixed(0));
    meterBar.style.width = `${Math.max(0, Math.min(100, f.db + 100))}%`;
    timeEl.textContent = mmss((f.ts - firstTs) / 1000);
    if (s.suddenCount > lastSudden) {
      lastSudden = s.suddenCount;
      suddenAt = new Date(f.ts).toLocaleTimeString("ko-KR");
      suddenEl.hidden = false;
      suddenEl.textContent = `갑작스러운 소리 ${suddenAt}`;
    }
    annEl.hidden = s.announcementCount < 1;
  }

  async function begin(k) {
    kind = k; final = null; firstTs = 0; lastSudden = 0; suddenAt = null; lux = null;
    meas = createMeasurement();
    setError(null); result.hidden = true; live.hidden = false; live.scrollIntoView({ block: "center" });
    suddenEl.hidden = true; annEl.hidden = true; gEl.textContent = "-"; enEl.textContent = " "; dbEl.textContent = ""; meterBar.style.width = "0";
    setRunning(true);
    status.textContent = "분석 모델을 준비하는 중이에요";
    try {
      if ("AmbientLightSensor" in window) { sensor = new window.AmbientLightSensor(); sensor.addEventListener("reading", () => (lux = sensor.illuminance)); sensor.start(); }
    } catch { sensor = null; } // no sensor or permission: brightness stays 미측정
    listener = createListener({
      onFrame,
      onError: (m) => { setError(m); abort(); },
      onProgress: (p) => { if (p < 1) status.textContent = `분석 모델 불러오는 중 ${Math.round(p * 100)}%`; },
    });
    if (k === "mic") await listener.start();
    else await listener.usingSample(`samples/${sampleSel.value}.wav`);
  }

  function abort() { listener?.stop(); try { sensor?.stop(); } catch {} sensor = null; setRunning(false); status.textContent = ""; live.hidden = !meas?.summary().nFrames; }

  function stop() {
    listener?.stop(); try { sensor?.stop(); } catch {} sensor = null;
    setRunning(false); status.textContent = "";
    final = meas.summary();
    if (!final.nFrames) { setError("소리를 아직 받지 못했어요. 다시 시도해 주세요."); live.hidden = true; return; }
    showResult(final);
  }

  function showResult(s) {
    const present = Object.entries(s.present).filter(([, on]) => on).map(([g]) => GROUP_KO[g]);
    const enough = s.nFrames >= 4;
    result.hidden = false;
    result.replaceChildren(...[h("p", { class: "lbl" }, "측정 요약"),
      h("dl", { class: "kv" },
        h("dt", null, "소리 크기 중앙값 (상대값)"), h("dd", null, `${s.dbMedian.toFixed(0)} dBFS`),
        h("dt", null, "배경 소리 (하위 10%)"), h("dd", null, `${s.dbP10.toFixed(0)} dBFS`),
        h("dt", null, "갑작스러운 소리"), h("dd", null, `${s.suddenCount}번`),
        h("dt", null, "안내방송 추정"), h("dd", null, `${s.announcementCount}번`),
        h("dt", null, "들린 소리"), h("dd", null, present.join(", ") || "뚜렷한 종류 없음"),
        h("dt", null, "밝기"), h("dd", null, lux == null ? "미측정" : `${Math.round(lux)} lux`),
        h("dt", null, "길이"), h("dd", null, mmss(s.durationSec))),
      h("p", { class: "caption" }, "dBFS는 이 폰 기준 상대값이라 다른 폰·장소와 직접 비교할 수 없어요. 저장되는 건 요약 숫자뿐이에요."),
      !enough && h("p", { class: "caption" }, "2초 이상 들려야 저장할 수 있어요."), // replaceChildren stringifies false, so filter
      h("button", { type: "button", class: "btn", id: "m-save", disabled: !enough, onclick: save }, "이 장소에 저장")].filter(Boolean));
  }

  function save() {
    const entry = { daytype: daySel.value, hour: Number(hourSel.value), source: "local", lux, summary: final, sample: kind === "sample" };
    if (place.value === NEW) {
      const name = nameIn.value.trim();
      if (!name) { setError("장소 이름을 적어 주세요."); nameIn.focus(); return; }
      entry.custom = { name, dongCode: dongSel.value };
    } else entry.placeId = place.value;
    setError(null);
    ctx.addSaved(entry);
    result.replaceChildren(h("p", { class: "lbl", role: "status" }, "저장했어요. 지도와 목록에 반영됐어요."));
    fillPlaces();
    live.hidden = true;
  }

  function renderSaved() {
    const names = new Map(ctx.places().map((p) => [p.id, p.name]));
    const items = ctx.saved();
    savedBox.replaceChildren(...(items.length ? items.map((m, i) => {
      const name = m.custom?.name ?? names.get(m.placeId) ?? "(없는 장소)";
      return h("li", null, h("span", null, h("strong", null, name), h("span", { class: "en" }, ` · ${dayKo(m.daytype)} ${hourLabel(m.hour)} · ${m.sample ? "샘플 소리" : "마이크"} · 중앙값 ${m.summary.dbMedian.toFixed(0)} dBFS (상대값)`)),
        h("button", { type: "button", class: "btn sec2", "aria-label": `${name} 측정 삭제`, onclick: () => ctx.removeSaved(i) }, "삭제"));
    }) : [h("li", null, h("span", { class: "en" }, "아직 저장한 측정이 없어요."))]));
  }

  fillPlaces(); syncTime(); renderSaved();
  return {
    refresh() { if (!running) { fillPlaces(); } renderSaved(); },
    syncTime: () => !running && syncTime(),
    preselect(id) { if ([...place.options].some((o) => o.value === id)) { place.value = id; syncNew(); } },
    leave() { if (running) stop(); }, // do not keep the mic open on another tab
  };
}
