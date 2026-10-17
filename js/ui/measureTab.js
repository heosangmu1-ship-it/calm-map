// 측정 tab, one screen (docs/DESIGN-MEASURE-1SCREEN.md): live on-device listening (audio.js) -> measure.js summary -> localStorage `calm.measurements` (summary numbers only).
import { createListener } from "../audio.js";
import { createMeasurement } from "../measure.js";
import { h, ic } from "./dom.js";
import { GROUP_KO, dayKo, hourLabel } from "./helpers.js";
import { createWave } from "./wave.js";

const SAMPLES = [
  ["restaurant", "붐비는 식당"], ["quiet-then-siren", "조용하다 사이렌"], ["siren", "사이렌"], ["traffic", "도로 소음"], ["crowd", "사람들 웅성임"],
  ["speech", "말소리"], ["music", "음악"], ["birds", "새소리"], ["baby-cry", "아기 울음"], ["chainsaw", "전기톱"], ["street-sweeper", "청소차"],
];
// live frames carry sound classes; the band hue uses the load tokens. Groups without a hue (speech, other) keep the idle accent wave; grey unknown means "no information"
const HUE = { calm: "calm", alarm: "high", loudhuman: "high", mechanical: "moderate", sustained: "moderate" };
const GROUP_ICON = { alarm: "bell-ring", loudhuman: "megaphone", mechanical: "cog", sustained: "audio-lines", speech: "message-circle", calm: "leaf", other: "ear" };
const NEW = "__new";
const IDLE_HINT = "시작을 누르면 파형이 보여요";
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Bottom sheet on a native <dialog> (focus trap, Esc, inert background); body children are built once and kept. */
function makeSheet(title, ...kids) {
  const body = h("div", null, ...kids);
  const dlg = h("dialog", { class: "msheet", "aria-label": title },
    h("div", { class: "sheet-in" }, h("div", { class: "sheet-head" }, h("h2", null, title), h("button", { type: "button", class: "x", "aria-label": "닫기", onclick: () => dlg.close() }, ic("x"))), body));
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
  document.body.append(dlg);
  return { dlg, body, open: () => !dlg.open && dlg.showModal(), close: () => dlg.open && dlg.close() };
}

/** ctx: {root, historyBtn, places(), dongs, day, hour, saved(), addSaved(entry), removeSaved(i), announce(msg)} -> {preselect(id), refresh(), syncTime(), leave()} */
export function createMeasureTab(ctx) {
  const root = ctx.root;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let listener = null, meas = null, running = false, kind = "mic", lux = null, sensor = null, sampleFile = SAMPLES[0][0];
  let clock = null, t0 = 0, lastSudden = 0, suddenAt = null, final = null, savedOnce = false, hasFrame = false, lastMeter = 0, lastAnn = 0, lastGroup = "", status = "", pickedNew = false;

  // context row
  const place = h("select", { id: "m-place", "aria-label": "장소", onchange: () => { pickedNew = place.value === NEW; if (pickedNew) placeSheet.open(); else { syncNew(); fillPlaces(); } } });
  const timeTxt = h("span"), timeBtn = h("button", { type: "button", class: "ctl", id: "m-time", "aria-label": "요일과 시간대 바꾸기", onclick: () => timeSheet.open() }, ic("clock"), timeTxt);
  const daySel = h("select", { id: "m-day", onchange: syncTimeTxt }, h("option", { value: "weekday" }, "평일"), h("option", { value: "weekend" }, "주말"));
  const hourSel = h("select", { id: "m-hour", onchange: syncTimeTxt }, Array.from({ length: 24 }, (_, i) => h("option", { value: String(i) }, hourLabel(i))));
  const timeSheet = makeSheet("요일과 시간대",
    h("div", { class: "field" }, h("label", { for: "m-day" }, "요일"), daySel), h("div", { class: "field" }, h("label", { for: "m-hour" }, "시간대"), hourSel));

  // custom place
  const nameIn = h("input", { type: "text", id: "m-name", maxlength: "20", placeholder: "예: 우리 동네 카페" });
  const dongSel = h("select", { id: "m-dong" });
  const placeErr = h("div", { class: "err", role: "alert", hidden: true });
  const placeSheet = makeSheet("내 장소 추가",
    h("div", { class: "field" }, h("label", { for: "m-name" }, "장소 이름"), nameIn),
    h("div", { class: "field" }, h("label", { for: "m-dong" }, "가까운 동 (그 동의 혼잡 추정을 써요)"), dongSel), placeErr,
    h("p", { class: "caption" }, "지도 핀 없이 목록에만 나와요."),
    h("button", { type: "button", class: "btn xl", id: "m-place-ok", onclick: () => placeSheet.close() }, "확인"));
  placeSheet.dlg.addEventListener("close", () => {
    fillPlaces();
    if (final && !savedOnce && (place.value !== NEW || nameIn.value.trim())) showResult(final);
  });

  // live band
  const canvas = h("canvas", { id: "m-wave" });
  const wave = createWave(canvas, { reducedMotion: reduced });
  const hint = h("div", { class: "hint", role: "status" });
  const errEl = h("div", { class: "hint err", role: "alert", hidden: true });
  const retryBtn = h("button", { type: "button", class: "btn sec2", id: "m-retry", hidden: true, onclick: () => retryModel() }, "다시 시도");
  const wavebox = h("div", { class: "wavebox" }, canvas, hint, errEl, retryBtn);
  const gIc = ic("ear"), gIcBox = h("span", { class: "gi" }, gIc);
  const gEl = h("div", { class: "big-group" }, "소리 대기"), enEl = h("div", { class: "en", lang: "en" }, " ");
  const dbEl = h("div", { class: "db" }), meter = h("span", { class: "sr", role: "meter", "aria-label": "상대 소리 크기", "aria-valuemin": "-100", "aria-valuemax": "0" });
  const strip = h("div", { class: "strip" }, gIcBox, h("div", { class: "gname" }, gEl, enEl), h("div", { class: "dbw" }, dbEl, h("div", { class: "en" }, "소리 크기")), meter);
  const timeEl = h("span", null, "00:00"), suddenTxt = h("span"), sunTxt = h("span", null, "미측정");
  const chipTimer = h("span", { class: "chip plain", "aria-label": "경과 시간" }, ic("timer"), timeEl);
  const chipSudden = h("span", { class: "chip plain", hidden: true, "aria-label": "갑작스러운 소리" }, ic("zap"), suddenTxt);
  const chipAnn = h("span", { class: "chip plain", hidden: true, "aria-label": "안내방송 추정" }, ic("speaker"), "안내방송");
  const chipSun = h("span", { class: "chip plain", "aria-label": "밝기" }, ic("sun"), sunTxt);
  const chipDemo = h("span", { class: "chip plain", hidden: true }, "시연용");
  const chips = h("div", { class: "mchips" }, chipTimer, chipSudden, chipAnn, chipSun, chipDemo);
  const live = h("div", { class: "band", id: "m-live" }, wavebox, strip, chips);

  // privacy + actions
  const infoSheet = makeSheet("안내",
    h("p", null, "이 폰이 소리를 듣고 요약 숫자만 남겨요. 측정하려면 마이크 권한이 필요해요."),
    h("p", null, "원음은 저장·전송되지 않아요. 분석은 이 폰 안에서만 해요."),
    h("p", null, "dBFS는 이 폰 기준 상대값이에요. 보정되지 않아 다른 폰·장소와 직접 비교할 수 없어요."),
    h("p", null, "샘플은 시연용 가상 측정이에요. 실제 장소를 잰 값이 아니에요."),
    h("p", null, "저장되는 건 요약 숫자뿐이에요."));
  const privacy = h("div", { class: "privrow" }, ic("lock"), h("span", null, "원음은 저장·전송 안 돼요"),
    h("button", { type: "button", class: "ib sm", id: "m-info", "aria-label": "안내 자세히 보기", onclick: () => infoSheet.open() }, ic("info")));
  const micBtn = h("button", { type: "button", class: "btn xl", id: "m-start", onclick: () => (running ? stop() : begin("mic")) });
  const smpBtn = h("button", { type: "button", class: "btn sec2 smp", id: "m-sample-go", onclick: () => samplesSheet.open() });
  const samplesSheet = makeSheet("샘플 소리", h("p", { class: "caption" }, "샘플은 시연용 가상 측정이에요."),
    h("div", { class: "opts" }, SAMPLES.map(([f, n]) => h("button", { type: "button", class: "opt", "data-sample": f, onclick: () => { sampleFile = f; samplesSheet.close(); begin("sample"); } }, ic("play"), n))));

  // history + result
  const savedBox = h("ul", { class: "saved", id: "m-saved" });
  const histSheet = makeSheet("내 측정", savedBox, h("p", { class: "caption" }, "샘플 소리 측정은 시연용이에요. 실제 장소를 잰 값이 아니에요."));
  const badge = ctx.historyBtn.querySelector(".badge");
  ctx.historyBtn.addEventListener("click", () => histSheet.open());
  const resultSheet = makeSheet("측정 요약");

  root.append(
    h("div", { class: "ctxrow" }, h("div", { class: "selw" }, ic("map-pin"), place), timeBtn),
    live, privacy, h("div", { class: "actions" }, micBtn, smpBtn));

  function syncTimeTxt() { timeTxt.textContent = `${dayKo(daySel.value)} ${hourSel.value}시`; }
  function fillPlaces() {
    const cur = place.value, nm = nameIn.value.trim();
    place.replaceChildren(...ctx.places().map((p) => h("option", { value: p.id }, p.name)), h("option", { value: NEW }, nm || "+ 내 장소 추가"));
    place.value = [...place.options].some((o) => o.value === cur) && (cur !== NEW || pickedNew) ? cur : place.options[0].value; // places() is empty before the first render, so NEW is only kept when the user picked it
    dongSel.replaceChildren(...ctx.dongs.map((d) => h("option", { value: d.code }, d.name)));
    syncNew();
  }
  function syncNew() { if (place.value !== NEW) { nameIn.value = ""; placeErr.hidden = true; } }
  function syncTime() { daySel.value = ctx.day; hourSel.value = String(ctx.hour); syncTimeTxt(); }

  function btn(b, icon, text, label) { b.replaceChildren(ic(icon), h("span", null, text)); b.setAttribute("aria-label", label); }
  function syncHint() {
    hint.replaceChildren(ic("mic"), IDLE_HINT); hint.hidden = hasFrame || !!status || !errEl.hidden;
    if (!hasFrame) { gEl.textContent = status || "소리 대기"; gEl.classList.toggle("st", !!status); } // loading text lives in the name slot, not over the wave
  }
  function setError(msg) {
    errEl.hidden = !msg; errEl.textContent = msg ?? ""; errEl.classList.remove("model"); retryBtn.hidden = true;
    smpBtn.classList.toggle("hl", !!msg && kind === "mic");
    syncHint();
  }
  function setStatus(t) { status = t; syncHint(); }
  function setRunning(on) {
    running = on;
    on ? btn(micBtn, "square", "끝내기", "측정 끝내기") : btn(micBtn, "mic", "측정 시작", "마이크로 측정 시작");
    smpBtn.disabled = on;
    for (const el of [place, timeBtn, nameIn, dongSel, daySel, hourSel]) el.disabled = on;
    chipSun.hidden = on && kind === "sample";
    chipDemo.hidden = !(on && kind === "sample");
  }

  function resetLive() {
    hasFrame = false; stopClock(); lastGroup = "";
    gEl.textContent = "소리 대기"; live.className = "band"; gEl.classList.remove("st"); enEl.textContent = " "; dbEl.textContent = ""; timeEl.textContent = "00:00";
    gIc.firstChild.setAttribute("href", "vendor/icons/sprite.svg#ear"); gIcBox.classList.remove("calm");
    chipSudden.hidden = true; chipAnn.hidden = true;
  }

  // own clock: starts when the audio path is up (stream attached or first chunk), not at the first model frame
  function startClock() {
    if (clock) return;
    t0 = Date.now();
    clock = setInterval(() => (timeEl.textContent = mmss((Date.now() - t0) / 1000)), 250);
  }
  function stopClock() { clearInterval(clock); clock = null; }

  function modelFailed(msg) { // mic stays on; only the model load can be retried
    setStatus(""); setError(msg); errEl.classList.add("model"); retryBtn.hidden = false;
  }
  function retryModel() {
    setError(null); setStatus("분석 모델 불러오는 중"); listener.retryModel();
  }

  function onFrame(f) {
    if (!hasFrame) { hasFrame = true; status = ""; gEl.classList.remove("st"); syncHint(); }
    wave.frame(f.db);
    meas.push(f);
    const s = meas.summary();
    gEl.textContent = GROUP_KO[f.group];
    live.className = HUE[f.group] ? "band b-" + HUE[f.group] : "band";
    gIc.firstChild.setAttribute("href", `vendor/icons/sprite.svg#${GROUP_ICON[f.group]}`);
    gIcBox.classList.toggle("calm", f.group === "calm");
    enEl.textContent = `${f.topClass} ${Math.round(f.topScore * 100)}%`;
    if (f.ts - lastMeter >= 1000) { lastMeter = f.ts; meter.setAttribute("aria-valuenow", f.db.toFixed(0)); }
    if (f.group !== lastGroup && f.ts - lastAnn >= 5000) { lastAnn = f.ts; lastGroup = f.group; ctx.announce(GROUP_KO[f.group]); }
    if (s.suddenCount > lastSudden) {
      lastSudden = s.suddenCount;
      suddenAt = new Date(f.ts).toLocaleTimeString("ko-KR");
      wave.mark();
    }
    chipSudden.hidden = s.suddenCount < 1;
    suddenTxt.textContent = `갑자기 ${s.suddenCount}회`;
    chipAnn.hidden = s.announcementCount < 1;
  }

  async function begin(k) {
    kind = k; final = null; savedOnce = false; lastSudden = 0; suddenAt = null; lux = null; lastAnn = 0;
    meas = createMeasurement();
    resetLive(); setRunning(true); setError(null);
    wave.detach();
    setStatus("분석 모델을 준비하는 중이에요");
    try {
      if ("AmbientLightSensor" in window) { sensor = new window.AmbientLightSensor(); sensor.addEventListener("reading", () => (lux = sensor.illuminance)); sensor.start(); }
    } catch { sensor = null; } // no sensor or permission: brightness stays 미측정
    listener = createListener({
      onFrame,
      onAnalyser: (a) => { if (a) { wave.attach(a); startClock(); } else wave.detach(); },
      onLevel: (db) => { startClock(); if (kind === "sample") wave.feed(db); dbEl.textContent = `${db.toFixed(0)} dB`; },
      onError: (m, o) => { if (o?.retry && kind === "mic") modelFailed(m); else { abort(); setError(m); } },
      onStage: (st) => { if (!hasFrame && st === "warmup") setStatus("분석 모델 첫 실행 준비 중"); },
      onProgress: (p) => {
        if (p >= 1) { if (!retryBtn.hidden) setError(null); if (!hasFrame) setStatus(""); return; }
        if (!hasFrame) setStatus(`분석 모델 불러오는 중 ${Math.round(p * 100)}%`);
      },
    });
    if (k === "mic") await listener.start();
    else await listener.usingSample(`samples/${sampleFile}.wav`);
  }

  function abort() { stopClock(); listener?.stop(); try { sensor?.stop(); } catch {} sensor = null; setRunning(false); resetLive(); setStatus(""); }

  function stop() {
    stopClock(); listener?.stop(); try { sensor?.stop(); } catch {} sensor = null;
    setRunning(false); setStatus("");
    final = meas.summary();
    resetLive(); syncHint();
    if (!final.nFrames) { final = null; setError("소리를 아직 받지 못했어요. 다시 시도해 주세요."); return; }
    showResult(final);
  }

  function showResult(s) {
    const enough = s.nFrames >= 4;
    const row = (icon, label, val) => h("div", { class: "rrow" }, ic(icon), h("span", null, label), h("strong", null, val));
    resultSheet.body.replaceChildren(...[
      row("volume-2", "소리 크기 중앙값 (상대값)", `${s.dbMedian.toFixed(0)} dBFS`),
      row("volume-2", "배경 소리 (하위 10%)", `${s.dbP10.toFixed(0)} dBFS`),
      row("zap", "갑작스러운 소리", `${s.suddenCount}번${s.suddenCount && suddenAt ? ` · ${suddenAt}` : ""}`),
      row("speaker", "안내방송 추정", `${s.announcementCount}번`),
      h("p", { class: "caption" }, "dBFS는 이 폰 기준 상대값이에요. 저장되는 건 요약 숫자뿐이에요."),
      !enough && h("p", { class: "caption" }, "2초 이상 들려야 저장할 수 있어요."),
      h("button", { type: "button", class: "btn xl", id: "m-save", disabled: !enough, onclick: save }, "이 장소에 저장")].filter(Boolean)); // replaceChildren stringifies false
    resultSheet.open();
  }

  function save() {
    const entry = { daytype: daySel.value, hour: Number(hourSel.value), source: "local", lux, summary: final, sample: kind === "sample" };
    if (place.value === NEW) {
      const name = nameIn.value.trim();
      if (!name) {
        resultSheet.dlg.close(); placeErr.hidden = false; placeErr.textContent = "장소 이름을 적어 주세요."; placeSheet.open(); nameIn.focus(); return;
      }
      entry.custom = { name, dongCode: dongSel.value };
    } else entry.placeId = place.value;
    savedOnce = true;
    ctx.addSaved(entry);
    resultSheet.body.replaceChildren(h("p", { class: "lbl", role: "status" }, "저장했어요. 지도와 목록에 반영됐어요."));
    fillPlaces();
  }

  function renderSaved() {
    const names = new Map(ctx.places().map((p) => [p.id, p.name]));
    const items = ctx.saved();
    badge.hidden = !items.length; badge.textContent = String(items.length);
    savedBox.replaceChildren(...(items.length ? items.map((m, i) => {
      const name = m.custom?.name ?? names.get(m.placeId) ?? "(없는 장소)";
      return h("li", null, h("span", null, h("strong", null, name), h("span", { class: "en" }, ` · ${dayKo(m.daytype)} ${hourLabel(m.hour)} · ${m.sample ? "샘플 소리 · 시연용" : "마이크"} · 중앙값 ${m.summary.dbMedian.toFixed(0)} dBFS (상대값)`)),
        h("button", { type: "button", class: "btn sec2", "aria-label": `${name} 측정 삭제`, onclick: () => ctx.removeSaved(i) }, "삭제"));
    }) : [h("li", null, h("span", { class: "en" }, "아직 저장한 측정이 없어요."))]));
  }

  new ResizeObserver(() => !running && wave.detach()).observe(wavebox); // redraw the baseline when the band resizes or the tab opens
  btn(smpBtn, "play", "샘플", "샘플 소리로 보기"); setRunning(false); syncHint(); fillPlaces(); syncTime(); renderSaved();
  return {
    refresh() { if (!running) fillPlaces(); renderSaved(); },
    syncTime: () => !running && syncTime(),
    preselect(id) { if ([...place.options].some((o) => o.value === id)) { pickedNew = false; place.value = id; syncNew(); } },
    leave() { for (const s of [timeSheet, placeSheet, infoSheet, samplesSheet, histSheet, resultSheet]) s.close(); if (running) abort(); }, // do not keep the mic open on another tab; the unsaved summary is dropped
  };
}
