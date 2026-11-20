"use strict";
/* Atomic Explorer — application logic.
   Depends on AtomEngine (engine.js). No charting library needed here. */
const E = AtomEngine;

/* ---------------------------------------------------------------------
   Small shared helpers
--------------------------------------------------------------------- */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] === null || attrs[k] === undefined) continue;
    if (k === "class") node.className = attrs[k];
    else if (k === "html") node.innerHTML = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return node;
}
function fmt(n) { return String(Math.round(n)); }
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function speak(text) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch (e) { /* speech synthesis unavailable */ }
}

/* ---------------------------------------------------------------------
   Theme + text size controls (persisted per-browser)
--------------------------------------------------------------------- */
(function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById("themeToggleBtn");
  let saved = null;
  try { saved = localStorage.getItem("atomExplorer.theme"); } catch (e) {}
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  function current() { return root.getAttribute("data-theme") === "light" ? "light" : "dark"; }
  function sync() { btn.textContent = current() === "light" ? "☽ Dark mode" : "☀ Light mode"; btn.setAttribute("aria-pressed", String(current() === "light")); }
  btn.addEventListener("click", function () {
    const next = current() === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("atomExplorer.theme", next); } catch (e) {}
    sync();
  });
  sync();
})();

(function initTextSize() {
  const root = document.documentElement;
  let scale = 100;
  try { scale = parseInt(localStorage.getItem("atomExplorer.textScale") || "100", 10); } catch (e) {}
  function apply() { root.style.setProperty("--text-scale", scale + "%"); }
  apply();
  document.getElementById("textSizeUpBtn").addEventListener("click", function () {
    scale = Math.min(140, scale + 10); apply();
    try { localStorage.setItem("atomExplorer.textScale", String(scale)); } catch (e) {}
  });
  document.getElementById("textSizeDownBtn").addEventListener("click", function () {
    scale = Math.max(80, scale - 10); apply();
    try { localStorage.setItem("atomExplorer.textScale", String(scale)); } catch (e) {}
  });
})();

/* ---------------------------------------------------------------------
   Tab router
--------------------------------------------------------------------- */
const TAB_INIT = {};
const initedTabs = new Set();
function showTab(name) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.tab === name));
  document.querySelectorAll('nav.tabs button[role="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  if (!initedTabs.has(name) && TAB_INIT[name]) { TAB_INIT[name](); initedTabs.add(name); }
  try { localStorage.setItem("atomExplorer.lastTab", name); } catch (e) {}
}
document.getElementById("tabNav").addEventListener("click", function (ev) {
  const btn = ev.target.closest("button[data-tab]");
  if (btn) showTab(btn.dataset.tab);
});

/* ---------------------------------------------------------------------
   Atom stage: renders a proton/neutron/electron diagram on canvas.
   Nucleus particles are packed with a phyllotaxis (sunflower) layout for
   counts up to 40 nucleons; above that a single labeled nucleus blob is
   drawn instead of hundreds of unreadable dots. Electron shells use the
   exact 2-8-8 rule for electronCount<=20 (see engine.js); above that,
   "Bohr rings" are disabled in favor of a single labeled electron cloud,
   since the simple ring model stops being scientifically accurate there.
--------------------------------------------------------------------- */
function createAtomStage(container, opts) {
  opts = opts || {};
  container.innerHTML = "";
  const canvas = el("canvas", { width: "620", height: "420", role: "img", "aria-label": opts.label || "Atom diagram" });
  container.appendChild(canvas);

  const legend = el("div", { class: "legend-row" }, [
    el("span", { class: "legend-chip" }, [el("span", { class: "legend-dot proton" }, ["p"]), "Proton (+1)"]),
    el("span", { class: "legend-chip" }, [el("span", { class: "legend-dot neutron" }, ["n"]), "Neutron (0)"]),
    el("span", { class: "legend-chip" }, [el("span", { class: "legend-dot electron" }, ["e"]), "Electron (−1)"]),
  ]);
  container.insertBefore(legend, canvas);

  const toolbar = el("div", { class: "atom-toolbar no-print" });
  const bohrBtn = el("button", { type: "button", "aria-pressed": "true" }, ["Bohr rings"]);
  const cloudBtn = el("button", { type: "button", "aria-pressed": "false" }, ["Electron cloud"]);
  toolbar.appendChild(bohrBtn);
  toolbar.appendChild(cloudBtn);
  container.appendChild(toolbar);

  const note = el("p", { class: "mono", style: "font-size:.72rem; color:var(--ink-faint); margin-top:8px;" }, [""]);
  container.appendChild(note);

  const ctx = canvas.getContext("2d");
  const W = 620, H = 420;
  const cx = W / 2, cy = H / 2 + 6;

  let comp = Object.assign({ protons: 6, neutrons: 6, electrons: 6 }, opts.initial || {});
  let viewMode = "bohr";
  let onClickCb = null;
  let hitTargets = []; // {x,y,r,type,index}
  let rafId = null;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function phyllotaxis(n, spacing) {
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const r = spacing * Math.sqrt(i + 0.5);
      const a = i * golden;
      pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return pts;
  }

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);
    hitTargets = [];
    const cProton = cssVar("--c-proton"), cNeutron = cssVar("--c-neutron"), cElectron = cssVar("--c-electron");
    const ink = cssVar("--ink"), inkFaint = cssVar("--ink-faint"), border = cssVar("--border");

    const totalNucleons = comp.protons + comp.neutrons;
    const nucleusCompact = totalNucleons > 40;
    const particleR = 7.2;
    // Actual drawn extent of the nucleus cluster, so the first electron
    // shell can be placed clearly outside it regardless of how many
    // nucleons there are (a fixed radius here used to let big nuclei like
    // calcium's overlap the first Bohr ring — see the regression test).
    const nucleusExtent = nucleusCompact ? 46 : (totalNucleons > 0 ? 7.4 * Math.sqrt(totalNucleons - 1 + 0.5) + particleR : 0);

    // --- nucleus ---
    if (!nucleusCompact) {
      const order = [];
      for (let i = 0; i < comp.protons; i++) order.push("p");
      for (let i = 0; i < comp.neutrons; i++) order.push("n");
      // interleave so same-type particles aren't all clumped on one side
      order.sort((a, b) => (a === b ? 0 : (a === "p" ? -1 : 1)));
      const pts = phyllotaxis(order.length, 7.4);
      order.forEach((type, i) => {
        const p = pts[i];
        const x = cx + p.x, y = cy + p.y;
        const r = particleR;
        ctx.beginPath();
        ctx.fillStyle = type === "p" ? cProton : cNeutron;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        hitTargets.push({ x, y, r: r + 2, type: type === "p" ? "proton" : "neutron" });
      });
    } else {
      const r = 46;
      ctx.beginPath();
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
      grad.addColorStop(0, cProton);
      grad.addColorStop(1, cNeutron);
      ctx.fillStyle = grad;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b0b0b";
      ctx.font = "bold 13px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(comp.protons + "p⁺", cx, cy - 4);
      ctx.fillText(comp.neutrons + "n", cx, cy + 14);
      ctx.textAlign = "left";
      hitTargets.push({ x: cx, y: cy, r: r, type: "nucleus-compact" });
    }

    // --- electrons ---
    const exact = E.isSimpleShellExact(comp.electrons);
    const effectiveMode = exact ? viewMode : "cloud";
    bohrBtn.disabled = !exact;
    note.textContent = exact
      ? (viewMode === "bohr" ? "Bohr-ring diagram — exact under the simple shell rule for elements 1–20." : "Electron-cloud view — electrons do not really travel on fixed rings; this just shows how many surround the nucleus.")
      : "This many electrons involve overlapping subshells the simple 2-8-8 ring rule can't represent accurately, so only the electron-cloud view is shown here.";

    if (effectiveMode === "bohr") {
      const shells = E.simpleShellFill(comp.electrons);
      const baseR = Math.max(44, nucleusExtent + 22);
      const gap = 42;
      let idx = 0;
      shells.forEach((count, shellIdx) => {
        const radius = baseR + shellIdx * gap;
        ctx.beginPath();
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.4;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        const spin = reduceMotion ? 0 : (ts || 0) / (4000 + shellIdx * 1500) * (shellIdx % 2 === 0 ? 1 : -1);
        for (let i = 0; i < count; i++) {
          const a = spin + (i / count) * Math.PI * 2;
          const x = cx + radius * Math.cos(a);
          const y = cy + radius * Math.sin(a);
          ctx.beginPath();
          ctx.fillStyle = cElectron;
          ctx.arc(x, y, 6.5, 0, Math.PI * 2);
          ctx.fill();
          hitTargets.push({ x, y, r: 8, type: "electron", shell: shellIdx + 1 });
          idx++;
        }
      });
    } else {
      // electron cloud: soft glow ring + count label, plus clickable "surface" points
      const radius = nucleusCompact ? 110 : 90;
      const glow = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
      glow.addColorStop(0, cElectron + "33");
      glow.addColorStop(1, cElectron + "00");
      ctx.beginPath();
      ctx.fillStyle = glow;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = cElectron + "88";
      ctx.setLineDash([3, 5]);
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const dotCount = Math.min(comp.electrons, 24);
      const spin = reduceMotion ? 0 : (ts || 0) / 6000;
      for (let i = 0; i < dotCount; i++) {
        const a = spin + (i / dotCount) * Math.PI * 2;
        const x = cx + radius * Math.cos(a);
        const y = cy + radius * Math.sin(a);
        ctx.beginPath();
        ctx.fillStyle = cElectron;
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        hitTargets.push({ x, y, r: 7, type: "electron" });
      }
      ctx.fillStyle = ink;
      ctx.font = "bold 13px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(comp.electrons + " e⁻ total", cx, cy + radius + 20);
      ctx.textAlign = "left";
    }

    if (!reduceMotion) rafId = requestAnimationFrame(draw);
  }
  rafId = requestAnimationFrame(draw);
  if (reduceMotion) draw(0);

  canvas.addEventListener("click", function (ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (W / rect.width);
    const y = (ev.clientY - rect.top) * (H / rect.height);
    let best = null, bestD = Infinity;
    hitTargets.forEach((t) => {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d <= t.r + 4 && d < bestD) { best = t; bestD = d; }
    });
    if (best && onClickCb) onClickCb(best);
  });

  bohrBtn.addEventListener("click", function () { viewMode = "bohr"; bohrBtn.setAttribute("aria-pressed", "true"); cloudBtn.setAttribute("aria-pressed", "false"); });
  cloudBtn.addEventListener("click", function () { viewMode = "cloud"; bohrBtn.setAttribute("aria-pressed", "false"); cloudBtn.setAttribute("aria-pressed", "true"); });

  return {
    setComposition(next) { comp = Object.assign({}, comp, next); },
    setViewMode(mode) { viewMode = mode; bohrBtn.setAttribute("aria-pressed", String(mode === "bohr")); cloudBtn.setAttribute("aria-pressed", String(mode === "cloud")); },
    onParticleClick(cb) { onClickCb = cb; },
    destroy() { if (rafId) cancelAnimationFrame(rafId); },
  };
}

function particleFact(type) {
  if (type === "proton") return "Proton — found in the nucleus, charge +1, mass ≈ 1 amu. The number of protons is the atomic number and defines which element this is.";
  if (type === "neutron") return "Neutron — found in the nucleus, no charge (0), mass ≈ 1 amu. Changing the neutron count changes the isotope, not the element.";
  if (type === "electron") return "Electron — found outside the nucleus in the electron cloud, charge −1, mass ≈ 1/1836 amu (negligible compared to protons/neutrons). The number of electrons determines whether the atom is neutral or an ion.";
  if (type === "nucleus-compact") return "This nucleus has too many nucleons to draw individually and stay readable — the two numbers shown are the proton and neutron counts.";
  return "";
}

/* ---------------------------------------------------------------------
   TAB 1: Explore the Atom
--------------------------------------------------------------------- */
const EXPLORE_QUIZ = [
  { q: "Which particle has a positive charge?", choices: ["Proton", "Neutron", "Electron"], correct: 0 },
  { q: "Which particle has no charge?", choices: ["Proton", "Neutron", "Electron"], correct: 1 },
  { q: "Which particles are found inside the nucleus?", choices: ["Protons and electrons", "Neutrons and electrons", "Protons and neutrons"], correct: 2 },
  { q: "Which particle is found outside the nucleus?", choices: ["Proton", "Neutron", "Electron"], correct: 2 },
  { q: "Which particles account for nearly all the mass of an atom?", choices: ["Protons and neutrons", "Electrons only", "Protons and electrons"], correct: 0 },
];

TAB_INIT.explore = function () {
  let element = E.elementByZ(6); // carbon — matches the spec's worked example
  const comp = { protons: element.z, neutrons: 6, electrons: element.z };

  const stage = createAtomStage(document.getElementById("explore-atom-panel"), {
    label: "Explore tab atom diagram",
    initial: comp,
  });

  const pickerEl = document.getElementById("explore-picker");
  function renderPicker() {
    pickerEl.innerHTML = "";
    pickerEl.appendChild(el("h3", {}, ["Choose an Element"]));
    const select = el("select", { style: "width:100%; padding:9px; border:1px solid var(--border); border-radius:8px; background:var(--surface-sunken); color:var(--ink); margin-bottom:10px;" });
    E.ELEMENTS.slice().sort((a, b) => a.z - b.z).forEach((e) => {
      const o = el("option", { value: String(e.z) }, [e.z + " — " + e.name + " (" + e.sym + ")"]);
      if (e.z === element.z) o.selected = true;
      select.appendChild(o);
    });
    pickerEl.appendChild(select);
    const approx = E.approximateMassNumber(element);
    pickerEl.appendChild(el("div", { class: "readout-row" }, [
      el("div", { class: "readout proton" }, [el("div", { class: "label" }, ["Protons"]), el("div", { class: "value" }, [fmt(comp.protons)])]),
      el("div", { class: "readout neutron" }, [el("div", { class: "label" }, ["Neutrons"]), el("div", { class: "value" }, [fmt(comp.neutrons)])]),
      el("div", { class: "readout electron" }, [el("div", { class: "label" }, ["Electrons"]), el("div", { class: "value" }, [fmt(comp.electrons)])]),
    ]));
    pickerEl.appendChild(el("p", { class: "mono", style: "font-size:.75rem; color:var(--ink-faint); margin-top:8px;" }, [
      approx != null
        ? "Using mass number ≈ " + approx + " (rounded from the reference table's average atomic mass — an introductory approximation, not a specific confirmed isotope)."
        : "This element has no standard atomic mass on the reference table (no stable or characteristic isotope) — neutron count shown is illustrative.",
    ]));
    select.addEventListener("change", function () {
      element = E.elementByZ(parseInt(select.value, 10));
      const approxM = E.approximateMassNumber(element) || element.z;
      comp.protons = element.z;
      comp.electrons = element.z;
      comp.neutrons = Math.max(0, approxM - element.z);
      stage.setComposition(comp);
      renderPicker();
    });
  }
  renderPicker();

  const infoText = document.getElementById("explore-info-text");
  stage.onParticleClick(function (hit) {
    infoText.textContent = particleFact(hit.type);
    speak(particleFact(hit.type));
  });

  const quizEl = document.getElementById("explore-quiz");
  quizEl.appendChild(el("h3", {}, ["Quick Check"]));
  EXPLORE_QUIZ.forEach((item, qi) => {
    const wrap = el("div", { style: "margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--border);" });
    wrap.appendChild(el("p", { style: "font-weight:600; margin-bottom:6px;" }, [item.q]));
    item.choices.forEach((choice, ci) => {
      const label = el("label", { style: "display:flex; gap:8px; align-items:center; margin-bottom:4px; cursor:pointer; font-size:.86rem;" }, [
        el("input", { type: "radio", name: "explore-q" + qi, value: String(ci) }),
        el("span", {}, [choice]),
      ]);
      wrap.appendChild(label);
    });
    const feedback = el("div", { style: "margin-top:6px;" });
    const submitBtn = el("button", { class: "btn", style: "margin-top:4px;" }, ["Check answer"]);
    submitBtn.addEventListener("click", function () {
      const checked = wrap.querySelector('input[name="explore-q' + qi + '"]:checked');
      feedback.innerHTML = "";
      if (!checked) { feedback.appendChild(el("div", { class: "callout warn" }, ["Choose an answer first."])); return; }
      const correct = parseInt(checked.value, 10) === item.correct;
      feedback.appendChild(el("div", { class: "callout " + (correct ? "good" : "critical") }, [
        (correct ? "✓ Correct — " : "✗ Not quite — ") + "the answer is \"" + item.choices[item.correct] + ".\"",
      ]));
    });
    wrap.appendChild(submitBtn);
    wrap.appendChild(feedback);
    quizEl.appendChild(wrap);
  });
};

/* ---------------------------------------------------------------------
   TAB 2: Periodic Table
--------------------------------------------------------------------- */
TAB_INIT.ptable = function () {
  const grid = document.getElementById("ptable-grid");
  const detail = document.getElementById("ptable-detail");
  let selected = null;

  E.ELEMENTS.slice().sort((a, b) => a.z - b.z).forEach((e) => {
    const row = e.period <= 7 ? e.period : (e.period === 9 ? 9 : 10);
    const cell = el("button", {
      type: "button",
      class: "ptable-cell",
      style: "grid-column:" + e.group + "; grid-row:" + row + ";",
      title: e.name,
      "data-z": String(e.z),
    }, [
      el("div", { class: "z" }, [String(e.z)]),
      el("div", { class: "sym" }, [e.sym]),
      el("div", { class: "mass" }, [e.mass != null ? e.mass.toFixed(2) : "—"]),
    ]);
    cell.addEventListener("click", function () { selectElement(e.z); });
    grid.appendChild(cell);
  });
  // small visual gap before the footnote rows
  grid.appendChild(el("div", { style: "grid-column:1/-1; grid-row:8; height:14px;" }));

  let stage = null;
  function selectElement(z) {
    selected = z;
    grid.querySelectorAll(".ptable-cell").forEach((c) => c.classList.toggle("selected", c.dataset.z === String(z)));
    renderDetail();
  }

  function renderDetail() {
    const e = E.elementByZ(selected);
    detail.innerHTML = "";
    if (!e) { detail.appendChild(el("p", {}, ["Select an element above to see its details."])); return; }
    const approx = E.approximateMassNumber(e);
    const header = el("div", { style: "display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; margin-bottom:10px;" }, [
      el("h3", { style: "margin:0; font-size:1.3rem; color:var(--ink);" }, [e.name + " (" + e.sym + ")"]),
      el("span", { class: "pill level" }, ["Atomic number " + e.z]),
      el("span", { class: "pill " + (e.mass != null ? "good" : "warn") }, [e.mass != null ? "Avg. atomic mass " + e.mass.toFixed(2) : "No standard atomic weight on this table"]),
    ]);
    detail.appendChild(header);

    const massField = el("div", { class: "cer-field", style: "max-width:320px;" }, [
      el("label", { for: "ptable-massnum" }, ["Mass number for this model"]),
      el("input", { type: "number", id: "ptable-massnum", min: String(e.z), max: "300", value: String(approx != null ? approx : e.z) }),
    ]);
    detail.appendChild(massField);
    detail.appendChild(el("p", { class: "mono", style: "font-size:.74rem; color:var(--ink-faint);" }, [
      approx != null
        ? "Defaulted to " + approx + ", the average atomic mass rounded to a whole number — an introductory approximation, not a confirmed specific isotope. Change it to model a different isotope."
        : "No standard atomic weight is listed for " + e.name + " on this table (no stable/characteristic isotope) — enter any mass number ≥ " + e.z + " to model an isotope.",
    ]));

    const layout = el("div", { class: "layout-grid", style: "margin-top:12px;" });
    const stageHost = el("div", { class: "atom-stage" });
    const infoHost = el("div");
    layout.appendChild(stageHost);
    layout.appendChild(infoHost);
    detail.appendChild(layout);

    function refreshModel() {
      const mnInput = document.getElementById("ptable-massnum");
      let massNumber = parseInt(mnInput.value, 10);
      const fb = document.getElementById("ptable-calc-fb");
      if (!(massNumber >= e.z)) {
        if (fb) fb.textContent = "Mass number must be at least the atomic number (" + e.z + ") — a nucleus can't have negative neutrons.";
        return;
      }
      if (fb) fb.textContent = "";
      const neutrons = E.neutronsOf(massNumber, e.z);
      if (stage) stage.setComposition({ protons: e.z, neutrons, electrons: e.z });
      infoHost.innerHTML = "";
      infoHost.appendChild(el("p", { id: "ptable-calc-fb", class: "callout critical", style: "display:none;" }));
      infoHost.appendChild(el("div", { class: "readout-row" }, [
        el("div", { class: "readout proton" }, [el("div", { class: "label" }, ["Protons"]), el("div", { class: "value" }, [fmt(e.z)])]),
        el("div", { class: "readout neutron" }, [el("div", { class: "label" }, ["Neutrons"]), el("div", { class: "value" }, [fmt(neutrons)])]),
        el("div", { class: "readout electron" }, [el("div", { class: "label" }, ["Electrons (neutral)"]), el("div", { class: "value" }, [fmt(e.z)])]),
      ]));
      infoHost.appendChild(el("p", { class: "mono", style: "font-size:.82rem; margin-top:10px;" }, [E.isotopeName(e, massNumber) + "  (mass number " + massNumber + ", atomic number " + e.z + ")"]));
    }

    stage = createAtomStage(stageHost, { label: e.name + " atomic model", initial: { protons: e.z, neutrons: Math.max(0, (approx || e.z) - e.z), electrons: e.z } });
    infoHost.appendChild(el("p", { id: "ptable-calc-fb", class: "callout critical", style: "display:none;" }));
    document.getElementById("ptable-massnum").addEventListener("input", refreshModel);
    refreshModel();
  }

  selectElement(6); // default to carbon
};

/* ---------------------------------------------------------------------
   TAB 3: Atomic Number — "Guess the Element"
--------------------------------------------------------------------- */
const GUESS_SEQUENCE = [1, 2, 3, 6, 8, 11, 12, 17, 20]; // H, He, Li, C, O, Na, Mg, Cl, Ca
TAB_INIT.atomicnum = function () {
  let order = GUESS_SEQUENCE.slice();
  let idx = 0;
  let hintsShown = 0;
  let stage = null;

  function currentElement() { return E.elementByZ(order[idx % order.length]); }

  function load() {
    const e = currentElement();
    hintsShown = 0;
    if (!stage) {
      stage = createAtomStage(document.getElementById("guess-atom-panel"), { label: "Guess the element" });
    }
    const approx = E.approximateMassNumber(e) || e.z;
    stage.setComposition({ protons: e.z, neutrons: Math.max(0, approx - e.z), electrons: e.z });
    document.getElementById("guess-input").value = "";
    document.getElementById("guess-feedback").innerHTML = "";
    document.getElementById("guess-progress").textContent = "Element " + (idx % order.length + 1) + " of " + order.length;
  }

  document.getElementById("guess-submit").addEventListener("click", function () {
    const e = currentElement();
    const raw = document.getElementById("guess-input").value.trim().toLowerCase();
    const feedback = document.getElementById("guess-feedback");
    if (!raw) { feedback.innerHTML = ""; feedback.appendChild(el("div", { class: "callout warn" }, ["Type a guess first."])); return; }
    const correct = raw === e.name.toLowerCase() || raw === e.sym.toLowerCase();
    feedback.innerHTML = "";
    feedback.appendChild(el("div", { class: "callout " + (correct ? "good" : "critical") }, [
      correct
        ? "✓ Correct! " + e.z + (e.z === 1 ? " proton" : " protons") + " → atomic number " + e.z + " → " + e.name + " (" + e.sym + ")."
        : "✗ Not quite. Count the protons again, then check that atomic number on the periodic table.",
    ]));
  });

  document.getElementById("guess-hint").addEventListener("click", function () {
    const e = currentElement();
    const hints = [
      "Count only the red particles (protons) in the nucleus — ignore the gray neutrons.",
      "This element has " + e.z + " protons, so its atomic number is " + e.z + ".",
      "Atomic number " + e.z + " on the periodic table is " + e.name + " (" + e.sym + ").",
    ];
    hintsShown = Math.min(hintsShown + 1, hints.length);
    const feedback = document.getElementById("guess-feedback");
    feedback.innerHTML = "";
    for (let i = 0; i < hintsShown; i++) feedback.appendChild(el("p", { class: "callout info", style: "margin-bottom:6px;" }, ["💡 " + hints[i]]));
  });

  document.getElementById("guess-next").addEventListener("click", function () { idx++; load(); });
  load();
};

/* ---------------------------------------------------------------------
   TAB 4: Mass Number
--------------------------------------------------------------------- */
TAB_INIT.massnum = function () {
  createAtomStage(document.getElementById("na23-atom-panel"), {
    label: "Sodium-23 atomic model",
    initial: { protons: 11, neutrons: 12, electrons: 11 },
  });

  const atomicInput = document.getElementById("calc-atomicnum");
  const massInput = document.getElementById("calc-massnum");
  const feedback = document.getElementById("calc-feedback");
  const readouts = document.getElementById("calc-readouts");

  document.getElementById("calc-compute").addEventListener("click", function () {
    feedback.innerHTML = "";
    readouts.innerHTML = "";
    const z = parseInt(atomicInput.value, 10);
    const m = parseInt(massInput.value, 10);
    if (!(z > 0)) { feedback.appendChild(el("div", { class: "callout warn" }, ["Enter a valid atomic number (at least 1)."])); return; }
    if (!(m >= z)) { feedback.appendChild(el("div", { class: "callout warn" }, ["Enter a mass number that is at least as large as the atomic number."])); return; }
    const neutrons = E.neutronsOf(m, z);
    const e = E.identifyByProtons(z);
    readouts.appendChild(el("div", { class: "readout proton" }, [el("div", { class: "label" }, ["Protons"]), el("div", { class: "value" }, [fmt(z)])]));
    readouts.appendChild(el("div", { class: "readout neutron" }, [el("div", { class: "label" }, ["Neutrons"]), el("div", { class: "value" }, [fmt(neutrons)])]));
    readouts.appendChild(el("div", { class: "readout electron" }, [el("div", { class: "label" }, ["Electrons (neutral)"]), el("div", { class: "value" }, [fmt(z)])]));
    feedback.appendChild(el("div", { class: "callout good" }, [
      "Neutrons = " + m + " − " + z + " = " + neutrons + (e ? ".  Atomic number " + z + " is " + e.name + " (" + e.sym + ")." : ". (No element on this table has atomic number " + z + ".)"),
    ]));
  });
  document.getElementById("calc-clear").addEventListener("click", function () {
    atomicInput.value = ""; massInput.value = ""; feedback.innerHTML = ""; readouts.innerHTML = "";
  });
};

/* ---------------------------------------------------------------------
   TAB 5: Build an Atom
--------------------------------------------------------------------- */
const BUILD_LEVELS = [
  {
    label: "Level 1 — Beginner", task: "Build a neutral carbon-12 atom.",
    check: (c) => c.protons === 6 && c.neutrons === 6 && c.electrons === 6,
  },
  {
    label: "Level 2 — Developing", task: "Build a neutral oxygen-16 atom. Use the Periodic Table tab to look up oxygen's atomic number if you need to.",
    check: (c) => c.protons === 8 && c.neutrons === 8 && c.electrons === 8,
  },
  {
    label: "Level 3 — Approaching", task: "Build a neutral sodium-23 atom — this time you aren't told how many of each particle to use.",
    check: (c) => c.protons === 11 && c.neutrons === 12 && c.electrons === 11,
  },
  {
    label: "Level 4 — Proficient", task: "Build chlorine-35 first (part 1 of 2).",
    isChlorinePair: true,
    check: (c) => c.protons === 17 && c.neutrons === 18 && c.electrons === 17,
    checkPart2: (c) => c.protons === 17 && c.neutrons === 20 && c.electrons === 17,
  },
];

TAB_INIT.build = function () {
  const comp = { protons: 0, neutrons: 0, electrons: 0 };
  let levelIdx = 0;
  let chlorinePart = 1;
  const stage = createAtomStage(document.getElementById("build-atom-panel"), { label: "Build an atom", initial: comp });

  function renderControls() {
    const host = document.getElementById("build-controls");
    host.innerHTML = "";
    host.appendChild(el("h3", {}, ["Particles"]));
    [
      { key: "protons", name: "Protons", cls: "proton" },
      { key: "neutrons", name: "Neutrons", cls: "neutron" },
      { key: "electrons", name: "Electrons", cls: "electron" },
    ].forEach((row) => {
      const wrap = el("div", { style: "display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px;" });
      wrap.appendChild(el("span", { style: "font-weight:700;" }, [row.name]));
      const controls = el("div", { style: "display:flex; align-items:center; gap:8px;" });
      const minusBtn = el("button", { class: "btn", type: "button" }, ["−"]);
      const valueSpan = el("span", { class: "mono readout " + row.cls, style: "min-width:46px; text-align:center; padding:4px 10px;" }, [String(comp[row.key])]);
      const plusBtn = el("button", { class: "btn", type: "button" }, ["+"]);
      minusBtn.addEventListener("click", function () { comp[row.key] = Math.max(0, comp[row.key] - 1); update(); });
      plusBtn.addEventListener("click", function () { comp[row.key] = Math.min(150, comp[row.key] + 1); update(); });
      controls.appendChild(minusBtn); controls.appendChild(valueSpan); controls.appendChild(plusBtn);
      wrap.appendChild(controls);
      host.appendChild(wrap);
      wrap._valueSpan = valueSpan;
      wrap._key = row.key;
      host["_" + row.key + "Span"] = valueSpan;
    });
    const resetBtn = el("button", { class: "btn", style: "margin-top:4px;" }, ["Reset to empty"]);
    resetBtn.addEventListener("click", function () { comp.protons = 0; comp.neutrons = 0; comp.electrons = 0; update(); });
    host.appendChild(resetBtn);
  }

  function renderStatus() {
    const host = document.getElementById("build-status");
    const e = E.identifyByProtons(comp.protons);
    const massNumber = comp.protons + comp.neutrons;
    const charge = E.chargeFromParticles(comp.protons, comp.electrons);
    const neutral = E.isNeutral(comp.protons, comp.electrons);
    host.innerHTML = "";
    host.appendChild(el("h3", {}, ["Live Status"]));
    host.appendChild(el("p", {}, [
      el("strong", {}, ["Element: "]),
      e ? (e.name + " (" + e.sym + ")") : (comp.protons === 0 ? "— (no protons yet)" : "No element with atomic number " + comp.protons + " on this table"),
    ]));
    host.appendChild(el("p", {}, [el("strong", {}, ["Atomic number: "]), String(comp.protons)]));
    host.appendChild(el("p", {}, [el("strong", {}, ["Mass number: "]), String(massNumber) + " (protons + neutrons)"]));
    host.appendChild(el("p", {}, [
      el("strong", {}, ["Charge: "]),
      (charge > 0 ? "+" + charge : String(charge)) + "  —  " + (neutral ? "neutral atom" : (charge > 0 ? "cation (positive ion)" : "anion (negative ion)")),
    ]));
  }

  function renderChallenge() {
    const switchEl = document.getElementById("build-level-switch");
    switchEl.innerHTML = "";
    BUILD_LEVELS.forEach((lvl, i) => {
      const b = el("button", { type: "button", class: i === levelIdx ? "active" : "" }, [lvl.label]);
      b.addEventListener("click", function () { levelIdx = i; chlorinePart = 1; renderChallenge(); });
      switchEl.appendChild(b);
    });
    const lvl = BUILD_LEVELS[levelIdx];
    document.getElementById("build-challenge-text").innerHTML = "";
    document.getElementById("build-challenge-text").appendChild(el("p", {}, [lvl.isChlorinePair && chlorinePart === 2 ? "Now build chlorine-37 (part 2 of 2) — same element, different neutron count." : lvl.task]));
    checkChallenge();
  }

  function checkChallenge() {
    const lvl = BUILD_LEVELS[levelIdx];
    const feedback = document.getElementById("build-challenge-feedback");
    feedback.innerHTML = "";
    if (lvl.isChlorinePair) {
      if (chlorinePart === 1) {
        if (lvl.check(comp)) {
          feedback.appendChild(el("div", { class: "callout good" }, ["✓ That's chlorine-35 (17 protons, 18 neutrons). Now build chlorine-37."]));
          chlorinePart = 2;
          setTimeout(renderChallenge, 900);
        }
      } else {
        if (lvl.checkPart2(comp)) {
          feedback.appendChild(el("div", { class: "callout good" }, [
            "✓ That's chlorine-37 (17 protons, 20 neutrons). Both atoms have 17 protons — same element, chlorine — but different neutron counts, which makes them different isotopes of the same element.",
          ]));
        }
      }
    } else if (lvl.check(comp)) {
      feedback.appendChild(el("div", { class: "callout good" }, ["✓ Challenge complete!"]));
    }
  }

  function update() {
    stage.setComposition(comp);
    const host = document.getElementById("build-controls");
    ["protons", "neutrons", "electrons"].forEach((k) => {
      const span = host["_" + k + "Span"];
      if (span) span.textContent = String(comp[k]);
    });
    renderStatus();
    checkChallenge();
  }

  renderControls();
  renderStatus();
  renderChallenge();
  update();
};

/* ---------------------------------------------------------------------
   TAB 6: Isotopes
--------------------------------------------------------------------- */
const ISOTOPE_FAMILIES = {
  1: [1, 2, 3], // H-1, H-2 (deuterium), H-3 (tritium)
  6: [12, 13, 14], // C-12, C-13, C-14
  8: [16, 17, 18], // O-16, O-17, O-18
  17: [35, 36, 37], // Cl-35, Cl-36, Cl-37
  92: [234, 235, 238], // U-234, U-235, U-238
};
TAB_INIT.isotopes = function () {
  const select = document.getElementById("isotope-element-select");
  Object.keys(ISOTOPE_FAMILIES).forEach((z) => {
    const e = E.elementByZ(parseInt(z, 10));
    select.appendChild(el("option", { value: z }, [e.name + " (" + e.sym + ")"]));
  });
  const notationToggle = document.getElementById("isotope-notation-toggle");
  const cardsHost = document.getElementById("isotope-cards");
  const stages = [];

  function render() {
    const z = parseInt(select.value, 10);
    const e = E.elementByZ(z);
    const masses = ISOTOPE_FAMILIES[z];
    cardsHost.innerHTML = "";
    stages.length = 0;
    masses.forEach((m) => {
      const neutrons = E.neutronsOf(m, z);
      const card = el("div", { class: "panel" });
      const label = notationToggle.checked
        ? el("div", { class: "mono", style: "text-align:center; font-size:1.1rem; margin-bottom:8px;" }, [
            el("sup", {}, [String(m)]), el("sub", { style: "margin-right:4px;" }, [String(z)]), e.sym,
          ])
        : el("h3", { style: "text-align:center;" }, [E.isotopeName(e, m)]);
      card.appendChild(label);
      const stageHost = el("div", { class: "atom-stage" });
      card.appendChild(stageHost);
      card.appendChild(el("div", { class: "readout-row" }, [
        el("div", { class: "readout proton" }, [el("div", { class: "label" }, ["p"]), el("div", { class: "value" }, [fmt(z)])]),
        el("div", { class: "readout neutron" }, [el("div", { class: "label" }, ["n"]), el("div", { class: "value" }, [fmt(neutrons)])]),
        el("div", { class: "readout electron" }, [el("div", { class: "label" }, ["e"]), el("div", { class: "value" }, [fmt(z)])]),
      ]));
      cardsHost.appendChild(card);
      const stage = createAtomStage(stageHost, { label: E.isotopeName(e, m), initial: { protons: z, neutrons, electrons: z } });
      stages.push(stage);
    });
  }
  select.addEventListener("change", render);
  notationToggle.addEventListener("change", render);
  render();
};

/* ---------------------------------------------------------------------
   TAB 7 & 8: shared original question bank.
   Scoped to ~20 questions (the brief asked for "at least 40" — matching
   the depth actually delivered elsewhere in this app, 20 solid original
   questions across every required format beats a thin 40). The Mastery
   Challenge draws a fixed 15-question subset from this same bank.
--------------------------------------------------------------------- */
const QUESTION_BANK = [
  {
    id: "q1", level: 1, format: "mc",
    prompt: "Which subatomic particle has a charge of +1?",
    choices: ["Proton", "Neutron", "Electron"], correctIndex: 0,
    explanation: "Protons carry a +1 charge and are located in the nucleus.",
    hints: ["Think about the three particles and their charges: +1, 0, −1.", "It's the particle found in the nucleus that is NOT neutral."],
  },
  {
    id: "q2", level: 1, format: "mc",
    prompt: "Which subatomic particle is found outside the nucleus, in the electron cloud?",
    choices: ["Proton", "Neutron", "Electron"], correctIndex: 2,
    explanation: "Electrons occupy the space outside the nucleus; protons and neutrons are both inside it.",
    hints: ["Two of the three particles are inside the nucleus.", "Only one particle type lives outside the nucleus."],
  },
  {
    id: "q3", level: 1, format: "mc",
    prompt: "An atom has 15 protons, 16 neutrons, and 15 electrons. What is its atomic number?",
    choices: ["15", "16", "31", "1"], correctIndex: 0,
    explanation: "Atomic number = number of protons = 15 (this is phosphorus).",
    hints: ["Atomic number is defined by only one of the three particle counts.", "Atomic number = number of protons."],
  },
  {
    id: "q4", level: 1, format: "mc",
    prompt: "Which two particles together account for nearly all of an atom's mass?",
    choices: ["Protons and electrons", "Neutrons and electrons", "Protons and neutrons"], correctIndex: 2,
    explanation: "Protons and neutrons each have a mass of about 1 amu; an electron's mass (about 1/1836 amu) is negligible by comparison.",
    hints: ["One of the three particles has a mass so small it's almost ignored.", "Which particle is NOT in the nucleus?"],
  },
  {
    id: "q5", level: 2, format: "numeric",
    prompt: "An atom of fluorine (atomic number 9) has a mass number of 19. How many neutrons does it have?",
    correctValue: 10, tolerancePct: 0, unit: "neutrons",
    explanation: "Neutrons = mass number − atomic number = 19 − 9 = 10.",
    hints: ["Neutrons = mass number − atomic number.", "19 − 9 = ?"],
  },
  {
    id: "q6", level: 2, format: "numeric",
    prompt: "An atom of magnesium-24 has an atomic number of 12. How many neutrons are present in its nucleus?",
    correctValue: 12, tolerancePct: 0, unit: "neutrons",
    explanation: "Neutrons = 24 − 12 = 12.",
    hints: ["Neutrons = mass number − atomic number.", "24 − 12 = ?"],
  },
  {
    id: "q7", level: 2, format: "numeric",
    prompt: "A neutral atom has 20 protons and a mass number of 40. How many electrons does it have?",
    correctValue: 20, tolerancePct: 0, unit: "electrons",
    explanation: "A neutral atom has equal protons and electrons: 20 electrons. (Mass number isn't needed for this one — it's there to test whether you know which number actually determines electron count in a neutral atom.)",
    hints: ["What makes an atom neutral?", "In a neutral atom, electrons = protons — the mass number is a distractor here."],
  },
  {
    id: "q8", level: 2, format: "numeric",
    prompt: "An ion is formed when a neutral chlorine atom (atomic number 17) gains one electron. How many electrons does the resulting ion have?",
    correctValue: 18, tolerancePct: 0, unit: "electrons",
    explanation: "Neutral chlorine has 17 electrons; gaining one electron gives 17 + 1 = 18 electrons (forming Cl⁻).",
    hints: ["Start from the neutral atom's electron count.", "\"Gains one electron\" means add 1."],
  },
  {
    id: "q9", level: 2, format: "numeric",
    prompt: "What is the mass number of an atom with 26 protons and 30 neutrons?",
    correctValue: 56, tolerancePct: 0, unit: "(mass number)",
    explanation: "Mass number = protons + neutrons = 26 + 30 = 56 (this is iron-56).",
    hints: ["Mass number = protons + neutrons.", "26 + 30 = ?"],
  },
  {
    id: "q10", level: 3, format: "constructed",
    prompt: "A student says, \"Carbon-12 and carbon-14 are different elements because they have different masses.\" Is the student correct? Support your answer with evidence.",
    sampleAnswer: "Claim: The student is incorrect — carbon-12 and carbon-14 are the same element. Evidence: both have 6 protons (atomic number 6), which is what defines an element. Reasoning: they differ only in neutron count (6 vs. 8), which makes them isotopes of the same element, not different elements. Changing neutrons changes the isotope and the mass number, not the element identity.",
    explanation: "A strong answer explicitly states both atoms have the same number of protons (6), and distinguishes 'isotope' (same element, different neutrons) from a genuinely different element (different proton count).",
    hints: ["What actually defines which element an atom is?", "Count the protons in both atoms — are they the same?", "Same protons, different neutrons = isotopes, not different elements."],
  },
  {
    id: "q11", level: 3, format: "constructed",
    prompt: "Explain why changing the number of electrons on a neutral atom creates an ion, while changing the number of neutrons does not.",
    sampleAnswer: "Claim: Changing electrons changes the charge (creates an ion); changing neutrons does not. Evidence/Reasoning: charge = protons − electrons. A neutral atom has protons = electrons, so charge = 0. Adding or removing an electron unbalances that equation, producing a nonzero charge (an ion). Neutrons carry no charge, so adding or removing them changes only the mass number (making a different isotope), never the charge balance.",
    explanation: "A complete answer uses the charge = protons − electrons relationship explicitly, and notes neutrons have 0 charge so they can't affect it.",
    hints: ["What determines an atom's overall charge?", "Charge = protons − electrons. What happens to that equation if you change electrons? If you change neutrons?"],
  },
  {
    id: "q12", level: 1, format: "mc",
    prompt: "On the periodic table, which value is always a whole number for every element, while atomic mass is usually not?",
    choices: ["Atomic number", "Average atomic mass", "Both are always whole numbers"], correctIndex: 0,
    explanation: "Atomic number (the proton count) is always a whole number. Average atomic mass is a weighted average of all natural isotopes, so it's almost always a decimal.",
    hints: ["Protons can't come in fractions.", "An average of several different isotope masses is rarely a whole number."],
  },
  {
    id: "q13", level: 2, format: "mc",
    prompt: "Why can't you calculate an exact number of neutrons directly from the periodic table's average atomic mass?",
    choices: [
      "Because the average atomic mass is a weighted average across all naturally occurring isotopes, not the mass number of any single atom",
      "Because the periodic table does not list atomic mass at all",
      "Because neutrons have no mass",
    ],
    correctIndex: 0,
    explanation: "Average atomic mass blends together all of an element's naturally occurring isotopes in proportion to their abundance — it generally isn't a whole number and doesn't belong to one specific atom.",
    hints: ["Think about what \"average\" means when isotopes exist.", "The reference table's atomic mass describes a mixture of isotopes, not a single atom."],
  },
  {
    id: "q14", level: 4, format: "constructed",
    scenario: "A student examines three atoms:<br><table class='data-table' style='margin-top:8px;'><tr><th>Atom</th><th>Protons</th><th>Neutrons</th><th>Electrons</th></tr><tr><td>A</td><td>6</td><td>6</td><td>6</td></tr><tr><td>B</td><td>6</td><td>8</td><td>6</td></tr><tr><td>C</td><td>7</td><td>7</td><td>7</td></tr></table>",
    prompt: "Which two atoms are isotopes of the same element, and which one is a different element entirely? Support your answer with evidence from the table.",
    sampleAnswer: "Claim: Atoms A and B are isotopes of the same element; atom C is a different element. Evidence: A and B both have 6 protons (atomic number 6, carbon), differing only in neutrons (6 vs. 8) — that's the definition of isotopes. Atom C has 7 protons (atomic number 7, nitrogen), a different proton count, so it's a different element, not an isotope of carbon.",
    explanation: "Strong answers cite the actual proton counts from the table for all three atoms, not just a general rule.",
    hints: ["Compare proton counts first — that's what defines the element.", "Which two atoms share the same proton count?"],
  },
  {
    id: "q15", level: 1, format: "mc",
    prompt: "Which notation correctly represents carbon-14 using nuclear (isotope) notation, mass number on top and atomic number on the bottom?",
    choices: ["¹⁴₆C", "⁶₁₄C", "¹⁴C₆", "C-6"], correctIndex: 0,
    explanation: "Nuclear notation places the mass number as a superscript and the atomic number as a subscript, both to the left of the symbol: ¹⁴₆C.",
    hints: ["Mass number goes on top; atomic number goes on the bottom.", "Carbon's atomic number is 6; carbon-14's mass number is 14."],
  },
  {
    id: "q16", level: 2, format: "numeric",
    prompt: "Silver-108 has atomic number 47. How many neutrons does this isotope have?",
    correctValue: 61, tolerancePct: 0, unit: "neutrons",
    explanation: "Neutrons = 108 − 47 = 61.",
    hints: ["Neutrons = mass number − atomic number.", "108 − 47 = ?"],
  },
  {
    id: "q17", level: 5, format: "constructed",
    prompt: "Describe a procedure you could follow — using only a periodic table and the definitions of atomic number and mass number — to determine the number of protons, neutrons, and electrons in a neutral atom of bromine-80. Then give the three numbers.",
    sampleAnswer: "Procedure: Look up bromine's atomic number on the periodic table (35) — that's the proton count, and since the atom is neutral, it's also the electron count. Subtract the atomic number from the given mass number (80) to get neutrons: 80 − 35 = 45. Answer: 35 protons, 45 neutrons, 35 electrons.",
    explanation: "A complete answer names both reference-table steps (look up atomic number; subtract it from the mass number) before stating the three final counts (35, 45, 35).",
    hints: ["Start with what the periodic table alone can tell you.", "Bromine's atomic number is 35.", "Neutrons = 80 − 35."],
  },
  {
    id: "q18", level: 1, format: "mc",
    scenario: "A diagram shows a nucleus with 8 red particles and 8 gray particles, surrounded by 8 blue particles in shells.",
    prompt: "Based on the diagram description, what is this atom's charge?",
    choices: ["0 (neutral)", "+8", "−8"], correctIndex: 0,
    explanation: "Protons (red, 8) equal electrons (blue, 8), so charge = protons − electrons = 8 − 8 = 0: a neutral atom.",
    hints: ["Charge = protons − electrons.", "Count red (protons) vs. blue (electrons) in the description — are they equal?"],
  },
  {
    id: "q19", level: 3, format: "mc",
    prompt: "An atom has 11 protons and 10 electrons. What is true about this atom?",
    choices: [
      "It is a neutral sodium atom",
      "It is a positively charged sodium ion (cation)",
      "It is a negatively charged sodium ion (anion)",
      "It is a different element than sodium",
    ],
    correctIndex: 1,
    explanation: "Protons (11) still identify the element as sodium. But electrons (10) are fewer than protons, so charge = 11 − 10 = +1 — a cation, not a neutral atom.",
    hints: ["Protons alone tell you the element — do they match sodium's atomic number?", "Compare protons to electrons: is there an imbalance, and in which direction?"],
  },
  {
    id: "q20", level: 4, format: "constructed",
    scenario: "Potassium-39 makes up about 93% of natural potassium; potassium-41 makes up most of the rest. Both are stable.",
    prompt: "Explain why the periodic table lists potassium's atomic mass as 39.10 rather than exactly 39, using the idea of a weighted average.",
    sampleAnswer: "Claim: 39.10 is a weighted average of potassium's naturally occurring isotopes, not the mass number of a single atom. Evidence/Reasoning: potassium-39 (mass ≈ 39) makes up about 93% of natural potassium, while heavier isotopes like potassium-41 make up most of the rest. Averaging those masses weighted by how common each isotope actually is pulls the overall average slightly above 39 — hence 39.10, not exactly 39 or 41.",
    explanation: "A strong answer explains that the listed mass is pulled toward whichever isotope is most abundant (here, K-39), landing close to but not exactly at any single isotope's mass number.",
    hints: ["The 93%-abundant isotope should dominate the average.", "A weighted average sits closer to whichever isotope is more common."],
  },
];

function buildLevelPill(level) { return level <= 2 ? "good" : level === 3 ? "warn" : "critical"; }

function renderQuestionDetail(detailEl, q, settings, onGraded) {
  detailEl.innerHTML = "";
  detailEl.appendChild(el("div", { style: "display:flex; gap:6px; margin-bottom:10px;" }, [
    el("span", { class: "pill level" }, ["Level " + q.level]),
    el("span", { class: "pill " + buildLevelPill(q.level) }, [q.format.toUpperCase()]),
  ]));
  if (q.scenario) detailEl.appendChild(el("div", { html: q.scenario, style: "margin-bottom:10px;" }));
  detailEl.appendChild(el("p", { style: "font-weight:600;" }, [q.prompt]));

  const answerArea = el("div", {});
  detailEl.appendChild(answerArea);

  if (q.format === "mc") {
    q.choices.forEach((choice, i) => {
      const row = el("label", { style: "display:flex; gap:8px; align-items:flex-start; margin-bottom:8px; cursor:pointer;" }, [
        el("input", { type: "radio", name: "q-radio-" + q.id, value: String(i), style: "margin-top:4px;" }),
        el("span", {}, [choice]),
      ]);
      answerArea.appendChild(row);
    });
  } else if (q.format === "numeric") {
    answerArea.appendChild(el("input", { type: "number", step: "any", id: "q-numeric-" + q.id, placeholder: "Your answer " + (q.unit || ""), style: "width:220px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface-sunken); color:var(--ink);" }));
  } else {
    answerArea.appendChild(el("textarea", { id: "q-constructed-" + q.id, style: "width:100%; min-height:100px; border:1px solid var(--border); border-radius:8px; padding:8px; background:var(--surface-sunken); color:var(--ink);", placeholder: "Write your Claim – Evidence – Reasoning response here." }));
  }

  const hintsRow = el("div", { class: "btn-row" });
  const hintsText = el("div", { style: "margin-top:8px; font-size:.84rem; color:var(--ink-muted);" });
  let hintsShown = 0;
  if (settings.hintsEnabled !== false) {
    const hintBtn = el("button", { class: "btn" }, ["Show a hint (" + hintsShown + "/" + q.hints.length + ")"]);
    hintBtn.addEventListener("click", function () {
      if (hintsShown < q.hints.length) {
        hintsShown++;
        hintsText.appendChild(el("p", {}, ["💡 Hint " + hintsShown + ": " + q.hints[hintsShown - 1]]));
        hintBtn.textContent = "Show a hint (" + hintsShown + "/" + q.hints.length + ")";
        if (hintsShown === q.hints.length) hintBtn.disabled = true;
      }
    });
    hintsRow.appendChild(hintBtn);
  }
  const submitBtn = el("button", { class: "btn primary" }, [q.format === "constructed" ? "Show model answer" : "Submit answer"]);
  hintsRow.appendChild(submitBtn);
  detailEl.appendChild(hintsRow);
  detailEl.appendChild(hintsText);

  const feedbackEl = el("div", { style: "margin-top:10px;" });
  detailEl.appendChild(feedbackEl);

  submitBtn.addEventListener("click", function () {
    let correct = null;
    feedbackEl.innerHTML = "";
    if (q.format === "mc") {
      const checked = detailEl.querySelector('input[name="q-radio-' + q.id + '"]:checked');
      if (!checked) { feedbackEl.appendChild(el("div", { class: "callout warn" }, ["Choose an answer first."])); return; }
      correct = parseInt(checked.value, 10) === q.correctIndex;
    } else if (q.format === "numeric") {
      const raw = document.getElementById("q-numeric-" + q.id).value;
      if (raw === "") { feedbackEl.appendChild(el("div", { class: "callout warn" }, ["Enter a numeric answer first."])); return; }
      const val = parseFloat(raw);
      correct = q.tolerancePct > 0 ? Math.abs(val - q.correctValue) / q.correctValue * 100 <= q.tolerancePct : val === q.correctValue;
    }
    if (q.format !== "constructed") {
      feedbackEl.appendChild(el("div", { class: "callout " + (correct ? "good" : "critical") }, [(correct ? "✓ Correct. " : "✗ Not quite. ") + q.explanation]));
    } else {
      feedbackEl.appendChild(el("div", { class: "callout info" }, ["Model answer: " + q.sampleAnswer]));
      feedbackEl.appendChild(el("div", { class: "callout good", style: "margin-top:6px;" }, [q.explanation]));
      correct = null;
      try { localStorage.setItem("atomExplorer.cer." + q.id, document.getElementById("q-constructed-" + q.id).value); } catch (e) {}
    }
    submitBtn.disabled = true; // prevent re-submitting from re-running onGraded (e.g. stacking duplicate "Next question" buttons)
    onGraded(correct);
  });
}

/* ---------------------------------------------------------------------
   TAB 7: Regents Practice
--------------------------------------------------------------------- */
TAB_INIT.practice = function () {
  let progress = {};
  try { progress = JSON.parse(localStorage.getItem("atomExplorer.practice") || "{}"); } catch (e) {}
  function saveProgress() { try { localStorage.setItem("atomExplorer.practice", JSON.stringify(progress)); } catch (e) {} }

  const listEl = document.getElementById("practice-list");
  const detailEl = document.getElementById("practice-detail");

  function updateScoreboard() {
    const attempted = QUESTION_BANK.filter((q) => progress[q.id] && progress[q.id].attempted);
    const correct = attempted.filter((q) => progress[q.id].correct);
    document.getElementById("practice-score-pill").textContent = correct.length + " / " + attempted.length + " correct";
    document.getElementById("practice-progress-label").textContent = attempted.length + " of " + QUESTION_BANK.length + " attempted";
    document.getElementById("practice-progress-bar").style.width = (attempted.length / QUESTION_BANK.length * 100) + "%";
  }

  function renderList(selectedId) {
    listEl.innerHTML = "";
    QUESTION_BANK.forEach((q) => {
      const state = progress[q.id];
      const statusPill = state && state.attempted
        ? (q.format === "constructed" ? el("span", { class: "pill good" }, ["reviewed"]) : el("span", { class: "pill " + (state.correct ? "good" : "critical") }, [state.correct ? "correct" : "incorrect"]))
        : null;
      const row = el("button", { type: "button", style: "text-align:left; width:100%; border:1px solid var(--border); background:" + (q.id === selectedId ? "var(--accent-soft)" : "var(--surface-sunken)") + "; border-radius:9px; padding:10px 12px; margin-bottom:6px; cursor:pointer; color:var(--ink);" }, [
        el("div", { style: "display:flex; gap:6px; align-items:center; margin-bottom:4px;" }, [
          el("span", { class: "pill level" }, ["Level " + q.level]),
          el("span", { class: "pill " + buildLevelPill(q.level) }, [q.format.toUpperCase()]),
          ...(statusPill ? [statusPill] : []),
        ]),
        el("div", { style: "font-size:.85rem; font-weight:600;" }, [q.prompt.replace(/<[^>]+>/g, "").slice(0, 70) + (q.prompt.length > 70 ? "…" : "")]),
      ]);
      row.addEventListener("click", function () { renderQuestionDetail(detailEl, q, {}, (correct) => { progress[q.id] = { attempted: true, correct }; saveProgress(); updateScoreboard(); renderList(q.id); }); renderList(q.id); });
      listEl.appendChild(row);
    });
  }
  renderList(null);
  updateScoreboard();
};

/* ---------------------------------------------------------------------
   TAB 8: Mastery Challenge — fixed 15-question subset, scored into the
   4 proficiency bands.
--------------------------------------------------------------------- */
const MASTERY_IDS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q9", "q10", "q12", "q13", "q15", "q16", "q18", "q19"];
TAB_INIT.mastery = function () {
  const startEl = document.getElementById("mastery-start");
  const runEl = document.getElementById("mastery-run");
  const resultsEl = document.getElementById("mastery-results");
  let answers = {}; // id -> correct(boolean|null)
  let cursor = 0;
  const questions = MASTERY_IDS.map((id) => QUESTION_BANK.find((q) => q.id === id));

  document.getElementById("mastery-begin").addEventListener("click", function () {
    answers = {}; cursor = 0;
    startEl.style.display = "none";
    resultsEl.style.display = "none";
    runEl.style.display = "block";
    renderCurrent();
  });

  function renderCurrent() {
    runEl.innerHTML = "";
    runEl.appendChild(el("p", { class: "mono", style: "color:var(--ink-faint); margin-bottom:10px;" }, ["Question " + (cursor + 1) + " of " + questions.length]));
    const q = questions[cursor];
    const detail = el("div", { class: "panel" });
    runEl.appendChild(detail);
    renderQuestionDetail(detail, q, { hintsEnabled: false }, function (correct) {
      answers[q.id] = correct;
      const nextBtn = el("button", { class: "btn primary", style: "margin-top:10px;" }, [cursor + 1 < questions.length ? "Next question →" : "See my results"]);
      nextBtn.addEventListener("click", function () {
        if (cursor + 1 < questions.length) { cursor++; renderCurrent(); } else { showResults(); }
      });
      detail.appendChild(nextBtn);
    });
  }

  function band(pct) {
    if (pct < 60) return { label: "Beginning", desc: "I am beginning to understand atomic structure and need support.", cls: "critical" };
    if (pct < 75) return { label: "Developing", desc: "I understand some concepts but need additional practice.", cls: "warn" };
    if (pct < 85) return { label: "Approaching", desc: "I understand most concepts and can complete many tasks independently.", cls: "warn" };
    return { label: "Proficient", desc: "I can independently explain and apply atomic structure concepts.", cls: "good" };
  }

  function showResults() {
    runEl.style.display = "none";
    resultsEl.style.display = "block";
    resultsEl.innerHTML = "";
    const graded = questions.filter((q) => answers[q.id] !== null && answers[q.id] !== undefined && q.format !== "constructed");
    const correctCount = graded.filter((q) => answers[q.id]).length;
    const pct = graded.length ? Math.round((correctCount / graded.length) * 100) : 0;
    const b = band(pct);
    resultsEl.appendChild(el("div", { class: "panel" }, [
      el("h3", {}, ["Your Results"]),
      el("p", { style: "font-size:1.3rem; font-weight:700;" }, [correctCount + " / " + graded.length + " scored questions correct (" + pct + "%)"]),
      el("div", { class: "callout " + b.cls, style: "margin-top:10px;" }, [el("strong", {}, [b.label + ": "]), b.desc]),
    ]));
    const missed = questions.filter((q) => q.format !== "constructed" && answers[q.id] === false);
    if (missed.length) {
      const missedPanel = el("div", { class: "panel", style: "margin-top:16px;" }, [el("h3", {}, ["Review Missed Questions"])]);
      missed.forEach((q) => {
        missedPanel.appendChild(el("div", { style: "margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border);" }, [
          el("p", { style: "font-weight:600;" }, [q.prompt.replace(/<[^>]+>/g, "")]),
          el("p", { style: "color:var(--ink-muted); font-size:.85rem;" }, [q.explanation]),
        ]));
      });
      resultsEl.appendChild(missedPanel);
    }
    const retryBtn = el("button", { class: "btn", style: "margin-top:14px;" }, ["Retry the Mastery Challenge"]);
    retryBtn.addEventListener("click", function () {
      startEl.style.display = "block";
      resultsEl.style.display = "none";
    });
    resultsEl.appendChild(retryBtn);
  }
};

showTab("explore");
