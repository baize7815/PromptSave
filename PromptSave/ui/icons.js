const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = Object.freeze({
  fullscreen: [
    ["path", { d: "M6 6L16 15.8995", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M6 41.8995L16 32", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M42.0001 41.8995L32.1006 32", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M41.8995 6L32 15.8995", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M33 6H42V15", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M42 33V42H33", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M15 42H6V33", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M6 15V6H15", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  refresh: [
    ["path", { d: "M42 8V24", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M6 24L6 40", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M42 24C42 14.0589 33.9411 6 24 6C18.9145 6 14.3216 8.10896 11.0481 11.5", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M6 24C6 33.9411 14.0589 42 24 42C28.8556 42 33.2622 40.0774 36.5 36.9519", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  manage: [
    ["rect", { x: "6", y: "28", width: "36", height: "14", rx: "4", fill: "none", stroke: "currentColor", "stroke-width": "4" }],
    ["path", { d: "M20 7H10C7.79086 7 6 8.79086 6 11V17C6 19.2091 7.79086 21 10 21H20", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }],
    ["circle", { cx: "34", cy: "14", r: "8", fill: "none", stroke: "currentColor", "stroke-width": "4" }],
    ["circle", { cx: "34", cy: "14", r: "3", fill: "currentColor" }]
  ],
  grid: [
    ["rect", { x: "5", y: "5", width: "38", height: "38", rx: "2", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M5 18H43", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }],
    ["path", { d: "M5 30H43", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }],
    ["path", { d: "M17 5V43", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }],
    ["path", { d: "M30 5V43", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }]
  ],
  settings: [
    ["path", { d: "M34.0003 41L44 24L34.0003 7H14.0002L4 24L14.0002 41H34.0003Z", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linejoin": "round" }],
    ["path", { d: "M24 29C26.7614 29 29 26.7614 29 24C29 21.2386 26.7614 19 24 19C21.2386 19 19 21.2386 19 24C19 26.7614 21.2386 29 24 29Z", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linejoin": "round" }]
  ],
  add: [
    ["path", { d: "M24.0605 10L24.0239 38", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M10 24L38 24", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  close: [
    ["path", { d: "M14 14L34 34", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M14 34L34 14", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  edit: [
    ["path", { d: "M42 26V40C42 41.1046 41.1046 42 40 42H8C6.89543 42 6 41.1046 6 40V8C6 6.89543 6.89543 6 8 6L22 6", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M14 26.7199V34H21.3172L42 13.3081L34.6951 6L14 26.7199Z", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linejoin": "round" }]
  ],
  folder: [
    ["path", { d: "M4 9V41L9 21H39.5V15C39.5 13.8954 38.6046 13 37.5 13H24L19 7H6C4.89543 7 4 7.89543 4 9Z", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M40 41L44 21H8.8125L4 41H40Z", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  chevron: [
    ["path", { d: "M36 18L24 30L12 18", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  copy: [
    ["rect", { x: "17", y: "17", width: "24", height: "24", rx: "5", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M31 17V14C31 11.2386 28.7614 9 26 9H14C11.2386 9 9 11.2386 9 14V26C9 28.7614 11.2386 31 14 31H17", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ],
  trash: [
    ["path", { d: "M18 12V9.5C18 8.11929 19.1193 7 20.5 7H27.5C28.8807 7 30 8.11929 30 9.5V12", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M9 12H39", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M11.5 12L13.6 38.4C13.82 41.04 15.2 42.5 17.8 42.5H30.2C32.8 42.5 34.18 41.04 34.4 38.4L36.5 12", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M20 19V35", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }],
    ["path", { d: "M28 19V35", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round" }]
  ],
  listen: [
    ["circle", { cx: "24", cy: "24", r: "20", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M24 37V44", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M36 24H44", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M4 24H11", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
    ["path", { d: "M24 11V4", fill: "none", stroke: "currentColor", "stroke-width": "4", "stroke-linecap": "round", "stroke-linejoin": "round" }]
  ]
});

function setAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
}

export function createIcon(name, size = 24) {
  const definition = ICONS[name];
  if (!definition) throw new RangeError(`Unknown icon: ${name}`);

  const svg = document.createElementNS(SVG_NS, "svg");
  setAttributes(svg, {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    "aria-hidden": "true",
    focusable: "false"
  });
  svg.classList.add("icon-svg");

  for (const [tagName, attributes] of definition) {
    const element = document.createElementNS(SVG_NS, tagName);
    setAttributes(element, attributes);
    svg.appendChild(element);
  }

  return svg;
}

export function setButtonIcon(button, name, { label, size } = {}) {
  if (!button || typeof button.replaceChildren !== "function") {
    throw new TypeError("setButtonIcon expects a button element");
  }

  const svg = createIcon(name, size);
  button.replaceChildren(svg);
  if (label !== undefined) {
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
  return button;
}
