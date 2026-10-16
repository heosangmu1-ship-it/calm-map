// Place detail bottom sheet (native <dialog>: focus trap, Esc, inert background). Content built with h()/s(), never innerHTML.
import { slot, sentence, storyCard } from "../index.js";
import { h, s } from "./dom.js";
import { GLYPH, KIND_KO, STIMULUS_KO, bandText, dayKo, hourLabel, ranges, rangeText, sourceTag } from "./helpers.js";

const bandOf = (x) => (x < 40 ? "calm" : x < 70 ? "moderate" : "high");
const SUBS = [["crowd", "혼잡", "crowd"], ["soundVolume", "소리 크기", "soundVolume"], ["soundType", "소리 종류", "soundType"], ["brightness", "밝기", "brightness"]];

/** ctx: {day, hour, profile, all, texts, saveText(key, value|null), goMeasure(id)} */
export function createSheet(dlg, onClose) {
  let place, ctx, view;
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close()); // backdrop click
  dlg.addEventListener("close", () => onClose?.());

  const key = (kind) => `${kind}:${place.id}:${ctx.day}:${ctx.hour}`;

  const hatch = (valText) => [h("div", { class: "bar unk", "aria-hidden": "true" }), h("span", { class: "val na" }, valText)];
  function subRows(sl) {
    const tag = sourceTag(place, sl);
    return SUBS.map(([k, label, reasonKey]) => {
      const v = sl[k];
      const decides = sl.reasonMain === reasonKey && sl.status === "ok";
      if (v === null) return h("div", { class: "sub-row b-unknown" }, h("span", null, label), ...hatch("미측정"));
      return h("div", { class: `sub-row b-${bandOf(v)}` }, h("span", null, label),
        h("div", { class: "bar", "aria-hidden": "true" }, h("i", { style: `width:${Math.round(v)}%` })),
        h("div", { class: "end" }, h("span", { class: "val" }, `${Math.round(v)} · ${k === "crowd" ? "추정" : tag}`), decides && h("span", { class: "max" }, "가장 큰 부담")));
    });
  }

  function timeline(slots) {
    const W = 340, H = 130, L = 30, R = 8, T = 10, B = 24;
    const x = (hr) => L + ((W - L - R) * hr) / 23, y = (v) => T + (H - T - B) * (1 - v / 100);
    const crowdOnly = slots.every((q) => q.status !== "ok");
    const val = (q) => (crowdOnly ? q.crowd : q.index);
    const usable = (q) => val(q) !== null && (crowdOnly || q.status === "ok");
    const kids = [s("rect", { x: L, y: y(100), width: W - L - R, height: y(70) - y(100), fill: "var(--high)", "fill-opacity": 0.1 })];
    for (const t of [40, 70]) kids.push(s("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: "var(--line)", "stroke-width": 1 }), s("text", { x: 2, y: y(t) + 4 }, String(t)));
    let run = []; // one 2 px line, broken where the hour has no value
    const flush = () => { if (run.length > 1) kids.push(s("polyline", { points: run.join(" "), fill: "none", stroke: "var(--ink-2)", "stroke-width": 2, "stroke-linejoin": "round" })); run = []; };
    slots.forEach((q, i) => { if (usable(q)) run.push(`${x(i).toFixed(1)},${y(val(q)).toFixed(1)}`); else flush(); });
    flush();
    slots.forEach((q, i) => {
      if (!usable(q)) return;
      const solid = !crowdOnly && q.measured; // measured hours solid, estimated hollow
      kids.push(s("circle", { cx: x(i), cy: y(val(q)), r: 3, fill: solid ? "var(--ink-2)" : "var(--surface)", stroke: "var(--ink-2)", "stroke-width": 1.5 }));
    });
    kids.push(s("line", { x1: x(ctx.hour), x2: x(ctx.hour), y1: T, y2: H - B, stroke: "var(--accent)", "stroke-width": 2 }));
    [0, 6, 12, 18, 23].forEach((hr) => kids.push(s("text", { x: x(hr), y: H - 6, "text-anchor": hr === 0 ? "start" : hr === 23 ? "end" : "middle" }, `${hr}시`)));
    const desc = crowdOnly ? "혼잡 추정만 있는 하루 그래프 (빈 점)" : "하루 부담 지수 그래프, 속이 찬 점은 측정한 시간대, 빈 점은 추정";
    return s("svg", { class: "timeline", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": desc }, kids);
  }

  function editable(kind, defaultText, statusEl) {
    const saved = ctx.texts[key(kind)];
    const ta = h("textarea", { "aria-label": "문장 편집", rows: "4" }, saved ?? defaultText);
    const btn = h("button", { type: "button", class: "btn sec2", onclick: () => {
      const v = ta.value.trim();
      ctx.saveText(key(kind), !v || v === defaultText ? null : v);
      if (!v) ta.value = defaultText;
      statusEl.textContent = "저장했어요";
    } }, "저장");
    return [ta, btn];
  }

  function info() {
    const sl = slot(place, ctx.day, ctx.hour, ctx.all, ctx.profile);
    const slots = Array.from({ length: 24 }, (_, hr) => slot(place, ctx.day, hr, ctx.all, ctx.profile));
    const ok = sl.status === "ok";
    const st = h("span", { class: "en", role: "status" });
    const calmHrs = (m) => ranges(slots.flatMap((q, hr) => (q.band === "calm" && q.measured === m ? [hr] : [])));
    const mHrs = calmHrs(true), eHrs = calmHrs(false);
    const hoursText = !ok ? "정보 부족이라 시간대 추천은 못 해요. 소리를 측정하면 알 수 있어요."
      : [mHrs.length && `무던함 (측정): ${rangeText(mHrs)}`, eHrs.length && `후보 (추정): ${rangeText(eHrs)}`].filter(Boolean).join(" / ") || "무던함으로 볼 수 있는 시간대가 없어요.";
    return [
      h("h2", { id: "sheet-title" }, place.name),
      h("div", { class: "chips" }, h("span", { class: "chip plain" }, KIND_KO[place.kind]), place.demo && h("span", { class: "demo-tag" }, "시연용 가상 측정, 실제 매장 값이 아님"),
        place.custom && h("span", { class: "chip plain" }, "내가 측정한 장소"), h("span", { class: "en" }, `${place.dong || "동 정보 없음"} · ${dayKo(ctx.day)} ${hourLabel(ctx.hour)}`)),
      h("div", { class: "chips" },
        h("span", { class: `chip big b-${sl.band}` }, h("span", { "aria-hidden": "true" }, GLYPH[sl.band]), bandText(sl)),
        ok && h("span", { class: "num" }, String(Math.round(sl.index))),
        h("span", { class: "chip plain" }, ok ? sourceTag(place, sl) : "혼잡만 추정")),
      sl.caution.map((c) => h("div", { class: "caution" }, h("span", { "aria-hidden": "true" }, "!"), `주의: ${STIMULUS_KO[c]}에 민감하다고 설정했어요`)),
      h("div", null, subRows(sl), h("div", { class: "sub-row b-unknown" }, h("span", null, "깜빡임"), ...hatch("미측정"))),
      h("section", null, h("h3", null, "하루 흐름"), timeline(slots),
        h("p", { class: "note" }, ok ? "속이 찬 점 = 측정, 빈 점 = 추정. 가는 선 = 40·70 기준, 붉은 칠 = 70 넘는 구간." : "빈 점 = 혼잡 추정만. 소리 측정이 없어 부담 지수는 계산하지 않았어요."),
        h("p", null, hoursText)),
      h("section", null, h("h3", null, "한 줄 설명"), ...editable("sentence", sentence(place, sl), st), " ", st),
      h("section", null, h("button", { type: "button", class: "btn sec2", onclick: () => { view = "story"; render(); } }, "이야기 카드 보기"), " ",
        h("button", { type: "button", class: "btn sec2", onclick: () => { dlg.close(); ctx.goMeasure(place.id); } }, "여기서 측정하기")),
      h("p", { class: "note" }, "지수는 환경 정보예요. 아이의 반응을 진단하거나 보장하지 않아요. 소리 크기는 상대값이고 보정되지 않았어요."),
    ];
  }

  function story() {
    const sl = slot(place, ctx.day, ctx.hour, ctx.all, ctx.profile);
    const def = storyCard(place, sl);
    const cur = ctx.texts[key("story")] ?? def;
    const st = h("span", { class: "en", role: "status" });
    const f = (label, val, area = true) => {
      const el = area ? h("textarea", { id: `st-${label}`, rows: "2" }, val) : h("input", { type: "text", id: `st-${label}`, value: val });
      return [h("div", { class: "field" }, h("label", { for: `st-${label}` }, label), el), el];
    };
    const rows = [f("제목", cur.title, false), ...cur.steps.map((t, i) => f(`${i + 1}단계`, t)), f("예상", cur.expected), f("대처", cur.coping)];
    return [
      h("h2", { id: "sheet-title" }, `이야기 카드 · ${place.name}`),
      h("p", { class: "note" }, "고정 양식이에요. 아이에게 맞게 고쳐 쓰세요."),
      rows.map((r) => r[0]),
      h("button", { type: "button", class: "btn", onclick: () => {
        const v = rows.map((r) => r[1].value.trim());
        const next = { title: v[0], steps: v.slice(1, 4), expected: v[4], coping: v[5] };
        ctx.saveText(key("story"), JSON.stringify(next) === JSON.stringify(def) ? null : next);
        st.textContent = "저장했어요";
      } }, "저장"), " ", st, " ",
      h("button", { type: "button", class: "btn sec2", onclick: () => { view = "info"; render(); } }, "돌아가기"),
    ];
  }

  function render() {
    dlg.replaceChildren(h("div", { class: "sheet-in" },
      h("div", { class: "sheet-head" }, h("div", { class: "handle", "aria-hidden": "true" }),
        h("button", { type: "button", class: "x", "aria-label": "닫기", onclick: () => dlg.close() }, "✕")),
      ...(view === "story" ? story() : info())));
    dlg.scrollTop = 0;
    dlg.querySelector(".x").focus();
  }

  return {
    open(p, c) { place = p; ctx = c; view = "info"; render(); if (!dlg.open) dlg.showModal(); },
  };
}
