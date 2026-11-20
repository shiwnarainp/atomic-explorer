// Standalone test harness for engine.js — runs under JavaScriptCore via
// `osascript -l JavaScript test-engine.js` (no Node.js runtime available
// in this environment). engine.js is read and eval'd directly so this
// exercises the exact file the browser app loads.

ObjC.import("stdlib");
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const path = "/Users/kevin/atomic-explorer/engine.js";
const src = app.read(Path(path));
eval(src);
const E = AtomEngine;

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; } else { failed++; console.log("FAIL: " + name); }
}
function arrEq(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }

// --- data integrity ---
check("exactly 118 elements", E.ELEMENTS.length === 118);
check("no duplicate atomic numbers", new Set(E.ELEMENTS.map((e) => e.z)).size === 118);
check("no duplicate symbols", new Set(E.ELEMENTS.map((e) => e.sym)).size === 118);
check("z values span 1..118 with none missing", (function () {
  for (let z = 1; z <= 118; z++) if (!E.elementByZ(z)) return false;
  return true;
})());

// spot-check a handful of entries against the uploaded 2025 NYSED table
const spotChecks = [
  [1, "H", "Hydrogen", 1.01],
  [2, "He", "Helium", 4.00],
  [6, "C", "Carbon", 12.01],
  [8, "O", "Oxygen", 16.00],
  [11, "Na", "Sodium", 22.99],
  [12, "Mg", "Magnesium", 24.31],
  [17, "Cl", "Chlorine", 35.45],
  [19, "K", "Potassium", 39.10],
  [20, "Ca", "Calcium", 40.08],
  [26, "Fe", "Iron", 55.85],
  [47, "Ag", "Silver", 107.87],
  [79, "Au", "Gold", 196.97],
  [82, "Pb", "Lead", 207.2],
  [92, "U", "Uranium", 238.03],
];
spotChecks.forEach(([z, sym, name, mass]) => {
  const el = E.elementByZ(z);
  check("z=" + z + " symbol", el.sym === sym);
  check("z=" + z + " name", el.name === name);
  check("z=" + z + " mass", Math.abs(el.mass - mass) < 1e-9);
});

// elements with NO listed atomic mass on the reference table
const noMassZ = [43, 61, 84, 85, 86, 87, 88, 89, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103,
  104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118];
check("exactly 34 elements have no listed mass", noMassZ.length === 34);
noMassZ.forEach((z) => check("z=" + z + " has mass:null", E.elementByZ(z).mass === null));
check("approximateMassNumber(Tc) is null (no data to approximate from)", E.approximateMassNumber(E.elementByZ(43)) === null);
check("every other element HAS a mass", E.ELEMENTS.filter((e) => e.mass === null).length === 34);

// --- elementBySymbol / elementByZ lookup ---
check("elementBySymbol case-insensitive", E.elementBySymbol("na").z === 11);
check("elementBySymbol exact", E.elementBySymbol("Na").z === 11);
check("elementByZ unknown returns null", E.elementByZ(119) === null);

// --- proton/neutron/electron arithmetic ---
check("protonsOf carbon", E.protonsOf(E.elementByZ(6)) === 6);
check("neutronsOf sodium-23", E.neutronsOf(23, 11) === 12);
check("neutronsOf carbon-12", E.neutronsOf(12, 6) === 6);
check("neutronsOf carbon-14", E.neutronsOf(14, 6) === 8);
check("neutronsOf throws if massNumber < atomicNumber", (function () {
  try { E.neutronsOf(5, 11); return false; } catch (e) { return true; }
})());
check("electronsOfNeutralAtom magnesium", E.electronsOfNeutralAtom(E.elementByZ(12)) === 12);

// --- charge / neutrality ---
check("chargeFromParticles neutral = 0", E.chargeFromParticles(11, 11) === 0);
check("chargeFromParticles cation (fewer electrons) is positive", E.chargeFromParticles(11, 10) === 1);
check("chargeFromParticles anion (more electrons) is negative", E.chargeFromParticles(17, 18) === -1);
check("isNeutral true case", E.isNeutral(6, 6) === true);
check("isNeutral false case", E.isNeutral(6, 8) === false);

// --- identify element from proton count (the "Guess the Element" mechanic) ---
check("identifyByProtons(6) is Carbon", E.identifyByProtons(6).name === "Carbon");
check("identifyByProtons(20) is Calcium", E.identifyByProtons(20).name === "Calcium");
check("identifyByProtons(0) is null", E.identifyByProtons(0) === null);

// --- isotope notation / naming ---
check("isotopeName carbon-14", E.isotopeName(E.elementByZ(6), 14) === "Carbon-14");
{
  const lab = E.isotopeLabel(E.elementByZ(6), 14);
  check("isotopeLabel carbon-14 mass", lab.mass === "14");
  check("isotopeLabel carbon-14 z", lab.z === "6");
  check("isotopeLabel carbon-14 sym", lab.sym === "C");
}

// --- simplified shell filling (exact for z<=20 under the taught 2-8-8 rule) ---
check("H shells [1]", arrEq(E.simpleShellFill(1), [1]));
check("He shells [2]", arrEq(E.simpleShellFill(2), [2]));
check("Li shells [2,1]", arrEq(E.simpleShellFill(3), [2, 1]));
check("Ne shells [2,8]", arrEq(E.simpleShellFill(10), [2, 8]));
check("Na shells [2,8,1]", arrEq(E.simpleShellFill(11), [2, 8, 1]));
check("Cl shells [2,8,7]", arrEq(E.simpleShellFill(17), [2, 8, 7]));
check("Ar shells [2,8,8]", arrEq(E.simpleShellFill(18), [2, 8, 8]));
check("K shells [2,8,8,1]", arrEq(E.simpleShellFill(19), [2, 8, 8, 1]));
check("Ca shells [2,8,8,2]", arrEq(E.simpleShellFill(20), [2, 8, 8, 2]));
check("isSimpleShellExact true for Ca (z=20)", E.isSimpleShellExact(20) === true);
check("isSimpleShellExact false for Sc (z=21)", E.isSimpleShellExact(21) === false);

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) { $.exit(1); }
