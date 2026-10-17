// Tiny DOM + storage helpers. Text always goes in as text nodes (user-typed place names are never parsed as HTML).
const SVG = "http://www.w3.org/2000/svg";

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.setAttribute("class", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  return el;
}
const fill = (el, kids) => (el.append(...kids.flat(2).filter((k) => k != null && k !== false)), el);

/** h("button", {class:"x", onclick}, "text", child...) */
export const h = (tag, attrs, ...kids) => fill(apply(document.createElement(tag), attrs), kids);
/** svg element builder */
export const s = (tag, attrs, ...kids) => fill(apply(document.createElementNS(SVG, tag), attrs), kids);

/** localStorage JSON with a fallback: private windows or blocked storage must not break the page. */
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

/** Lucide icon from the vendored sprite; decorative (the control or text beside it carries the name). */
export const ic = (name, cls = "") => s("svg", { class: `ic ${cls}`.trim(), "aria-hidden": "true" }, s("use", { href: `vendor/icons/sprite.svg#${name}` }));
