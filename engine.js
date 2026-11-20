/*
 * Atomic Explorer — core data + calculation engine
 * Pure functions and data only (no DOM access), so this file can be loaded
 * both in the browser UI and in a standalone test harness (test-engine.js).
 *
 * Element data (symbol, name, atomic number, atomic mass) is transcribed
 * directly from the uploaded "Reference Tables for Physical Science:
 * CHEMISTRY — 2025 Edition" (NYSED). Where that table prints no atomic
 * mass (elements with no stable or characteristic isotope — Technetium,
 * Promethium, and most elements past Bismuth), `mass` is null here rather
 * than invented. See NOTES below for exactly which elements that covers.
 *
 * NOTES — elements with mass:null (no standard atomic weight in the 2025
 * NYSED table): Tc(43), Pm(61), Po(84), At(85), Rn(86), Fr(87), Ra(88),
 * Ac(89), Np(93)-Lr(103), Rf(104)-Og(118).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AtomEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // { z, sym, name, mass (amu, rounded as printed on the reference table, or null), period, group }
  // group follows the standard 18-column layout; lanthanides/actinides are
  // placed in footnote rows (period 9 = lanthanide row, period 10 = actinide row)
  // with group counted 4..17, matching the reference table's own layout.
  const ELEMENTS = [
    { z: 1, sym: "H", name: "Hydrogen", mass: 1.01, period: 1, group: 1 },
    { z: 2, sym: "He", name: "Helium", mass: 4.00, period: 1, group: 18 },
    { z: 3, sym: "Li", name: "Lithium", mass: 6.94, period: 2, group: 1 },
    { z: 4, sym: "Be", name: "Beryllium", mass: 9.01, period: 2, group: 2 },
    { z: 5, sym: "B", name: "Boron", mass: 10.81, period: 2, group: 13 },
    { z: 6, sym: "C", name: "Carbon", mass: 12.01, period: 2, group: 14 },
    { z: 7, sym: "N", name: "Nitrogen", mass: 14.01, period: 2, group: 15 },
    { z: 8, sym: "O", name: "Oxygen", mass: 16.00, period: 2, group: 16 },
    { z: 9, sym: "F", name: "Fluorine", mass: 19.00, period: 2, group: 17 },
    { z: 10, sym: "Ne", name: "Neon", mass: 20.18, period: 2, group: 18 },
    { z: 11, sym: "Na", name: "Sodium", mass: 22.99, period: 3, group: 1 },
    { z: 12, sym: "Mg", name: "Magnesium", mass: 24.31, period: 3, group: 2 },
    { z: 13, sym: "Al", name: "Aluminum", mass: 26.98, period: 3, group: 13 },
    { z: 14, sym: "Si", name: "Silicon", mass: 28.09, period: 3, group: 14 },
    { z: 15, sym: "P", name: "Phosphorus", mass: 30.97, period: 3, group: 15 },
    { z: 16, sym: "S", name: "Sulfur", mass: 32.06, period: 3, group: 16 },
    { z: 17, sym: "Cl", name: "Chlorine", mass: 35.45, period: 3, group: 17 },
    { z: 18, sym: "Ar", name: "Argon", mass: 39.95, period: 3, group: 18 },
    { z: 19, sym: "K", name: "Potassium", mass: 39.10, period: 4, group: 1 },
    { z: 20, sym: "Ca", name: "Calcium", mass: 40.08, period: 4, group: 2 },
    { z: 21, sym: "Sc", name: "Scandium", mass: 44.96, period: 4, group: 3 },
    { z: 22, sym: "Ti", name: "Titanium", mass: 47.87, period: 4, group: 4 },
    { z: 23, sym: "V", name: "Vanadium", mass: 50.94, period: 4, group: 5 },
    { z: 24, sym: "Cr", name: "Chromium", mass: 52.00, period: 4, group: 6 },
    { z: 25, sym: "Mn", name: "Manganese", mass: 54.94, period: 4, group: 7 },
    { z: 26, sym: "Fe", name: "Iron", mass: 55.85, period: 4, group: 8 },
    { z: 27, sym: "Co", name: "Cobalt", mass: 58.93, period: 4, group: 9 },
    { z: 28, sym: "Ni", name: "Nickel", mass: 58.69, period: 4, group: 10 },
    { z: 29, sym: "Cu", name: "Copper", mass: 63.55, period: 4, group: 11 },
    { z: 30, sym: "Zn", name: "Zinc", mass: 65.38, period: 4, group: 12 },
    { z: 31, sym: "Ga", name: "Gallium", mass: 69.72, period: 4, group: 13 },
    { z: 32, sym: "Ge", name: "Germanium", mass: 72.63, period: 4, group: 14 },
    { z: 33, sym: "As", name: "Arsenic", mass: 74.92, period: 4, group: 15 },
    { z: 34, sym: "Se", name: "Selenium", mass: 78.97, period: 4, group: 16 },
    { z: 35, sym: "Br", name: "Bromine", mass: 79.90, period: 4, group: 17 },
    { z: 36, sym: "Kr", name: "Krypton", mass: 83.80, period: 4, group: 18 },
    { z: 37, sym: "Rb", name: "Rubidium", mass: 85.47, period: 5, group: 1 },
    { z: 38, sym: "Sr", name: "Strontium", mass: 87.62, period: 5, group: 2 },
    { z: 39, sym: "Y", name: "Yttrium", mass: 88.91, period: 5, group: 3 },
    { z: 40, sym: "Zr", name: "Zirconium", mass: 91.22, period: 5, group: 4 },
    { z: 41, sym: "Nb", name: "Niobium", mass: 92.91, period: 5, group: 5 },
    { z: 42, sym: "Mo", name: "Molybdenum", mass: 95.95, period: 5, group: 6 },
    { z: 43, sym: "Tc", name: "Technetium", mass: null, period: 5, group: 7 },
    { z: 44, sym: "Ru", name: "Ruthenium", mass: 101.07, period: 5, group: 8 },
    { z: 45, sym: "Rh", name: "Rhodium", mass: 102.91, period: 5, group: 9 },
    { z: 46, sym: "Pd", name: "Palladium", mass: 106.42, period: 5, group: 10 },
    { z: 47, sym: "Ag", name: "Silver", mass: 107.87, period: 5, group: 11 },
    { z: 48, sym: "Cd", name: "Cadmium", mass: 112.41, period: 5, group: 12 },
    { z: 49, sym: "In", name: "Indium", mass: 114.82, period: 5, group: 13 },
    { z: 50, sym: "Sn", name: "Tin", mass: 118.71, period: 5, group: 14 },
    { z: 51, sym: "Sb", name: "Antimony", mass: 121.76, period: 5, group: 15 },
    { z: 52, sym: "Te", name: "Tellurium", mass: 127.60, period: 5, group: 16 },
    { z: 53, sym: "I", name: "Iodine", mass: 126.90, period: 5, group: 17 },
    { z: 54, sym: "Xe", name: "Xenon", mass: 131.29, period: 5, group: 18 },
    { z: 55, sym: "Cs", name: "Cesium", mass: 132.91, period: 6, group: 1 },
    { z: 56, sym: "Ba", name: "Barium", mass: 137.33, period: 6, group: 2 },
    { z: 57, sym: "La", name: "Lanthanum", mass: 138.91, period: 6, group: 3 },
    { z: 72, sym: "Hf", name: "Hafnium", mass: 178.49, period: 6, group: 4 },
    { z: 73, sym: "Ta", name: "Tantalum", mass: 180.95, period: 6, group: 5 },
    { z: 74, sym: "W", name: "Tungsten", mass: 183.84, period: 6, group: 6 },
    { z: 75, sym: "Re", name: "Rhenium", mass: 186.21, period: 6, group: 7 },
    { z: 76, sym: "Os", name: "Osmium", mass: 190.23, period: 6, group: 8 },
    { z: 77, sym: "Ir", name: "Iridium", mass: 192.22, period: 6, group: 9 },
    { z: 78, sym: "Pt", name: "Platinum", mass: 195.08, period: 6, group: 10 },
    { z: 79, sym: "Au", name: "Gold", mass: 196.97, period: 6, group: 11 },
    { z: 80, sym: "Hg", name: "Mercury", mass: 200.59, period: 6, group: 12 },
    { z: 81, sym: "Tl", name: "Thallium", mass: 204.38, period: 6, group: 13 },
    { z: 82, sym: "Pb", name: "Lead", mass: 207.2, period: 6, group: 14 },
    { z: 83, sym: "Bi", name: "Bismuth", mass: 208.98, period: 6, group: 15 },
    { z: 84, sym: "Po", name: "Polonium", mass: null, period: 6, group: 16 },
    { z: 85, sym: "At", name: "Astatine", mass: null, period: 6, group: 17 },
    { z: 86, sym: "Rn", name: "Radon", mass: null, period: 6, group: 18 },
    { z: 87, sym: "Fr", name: "Francium", mass: null, period: 7, group: 1 },
    { z: 88, sym: "Ra", name: "Radium", mass: null, period: 7, group: 2 },
    { z: 89, sym: "Ac", name: "Actinium", mass: null, period: 7, group: 3 },
    { z: 104, sym: "Rf", name: "Rutherfordium", mass: null, period: 7, group: 4 },
    { z: 105, sym: "Db", name: "Dubnium", mass: null, period: 7, group: 5 },
    { z: 106, sym: "Sg", name: "Seaborgium", mass: null, period: 7, group: 6 },
    { z: 107, sym: "Bh", name: "Bohrium", mass: null, period: 7, group: 7 },
    { z: 108, sym: "Hs", name: "Hassium", mass: null, period: 7, group: 8 },
    { z: 109, sym: "Mt", name: "Meitnerium", mass: null, period: 7, group: 9 },
    { z: 110, sym: "Ds", name: "Darmstadtium", mass: null, period: 7, group: 10 },
    { z: 111, sym: "Rg", name: "Roentgenium", mass: null, period: 7, group: 11 },
    { z: 112, sym: "Cn", name: "Copernicium", mass: null, period: 7, group: 12 },
    { z: 113, sym: "Nh", name: "Nihonium", mass: null, period: 7, group: 13 },
    { z: 114, sym: "Fl", name: "Flerovium", mass: null, period: 7, group: 14 },
    { z: 115, sym: "Mc", name: "Moscovium", mass: null, period: 7, group: 15 },
    { z: 116, sym: "Lv", name: "Livermorium", mass: null, period: 7, group: 16 },
    { z: 117, sym: "Ts", name: "Tennessine", mass: null, period: 7, group: 17 },
    { z: 118, sym: "Og", name: "Oganesson", mass: null, period: 7, group: 18 },
    // Lanthanide series (footnote row)
    { z: 58, sym: "Ce", name: "Cerium", mass: 140.12, period: 9, group: 4 },
    { z: 59, sym: "Pr", name: "Praseodymium", mass: 140.91, period: 9, group: 5 },
    { z: 60, sym: "Nd", name: "Neodymium", mass: 144.24, period: 9, group: 6 },
    { z: 61, sym: "Pm", name: "Promethium", mass: null, period: 9, group: 7 },
    { z: 62, sym: "Sm", name: "Samarium", mass: 150.36, period: 9, group: 8 },
    { z: 63, sym: "Eu", name: "Europium", mass: 151.96, period: 9, group: 9 },
    { z: 64, sym: "Gd", name: "Gadolinium", mass: 157.25, period: 9, group: 10 },
    { z: 65, sym: "Tb", name: "Terbium", mass: 158.93, period: 9, group: 11 },
    { z: 66, sym: "Dy", name: "Dysprosium", mass: 162.50, period: 9, group: 12 },
    { z: 67, sym: "Ho", name: "Holmium", mass: 164.93, period: 9, group: 13 },
    { z: 68, sym: "Er", name: "Erbium", mass: 167.26, period: 9, group: 14 },
    { z: 69, sym: "Tm", name: "Thulium", mass: 168.93, period: 9, group: 15 },
    { z: 70, sym: "Yb", name: "Ytterbium", mass: 173.04, period: 9, group: 16 },
    { z: 71, sym: "Lu", name: "Lutetium", mass: 174.97, period: 9, group: 17 },
    // Actinide series (footnote row)
    { z: 90, sym: "Th", name: "Thorium", mass: 232.04, period: 10, group: 4 },
    { z: 91, sym: "Pa", name: "Protactinium", mass: 231.04, period: 10, group: 5 },
    { z: 92, sym: "U", name: "Uranium", mass: 238.03, period: 10, group: 6 },
    { z: 93, sym: "Np", name: "Neptunium", mass: null, period: 10, group: 7 },
    { z: 94, sym: "Pu", name: "Plutonium", mass: null, period: 10, group: 8 },
    { z: 95, sym: "Am", name: "Americium", mass: null, period: 10, group: 9 },
    { z: 96, sym: "Cm", name: "Curium", mass: null, period: 10, group: 10 },
    { z: 97, sym: "Bk", name: "Berkelium", mass: null, period: 10, group: 11 },
    { z: 98, sym: "Cf", name: "Californium", mass: null, period: 10, group: 12 },
    { z: 99, sym: "Es", name: "Einsteinium", mass: null, period: 10, group: 13 },
    { z: 100, sym: "Fm", name: "Fermium", mass: null, period: 10, group: 14 },
    { z: 101, sym: "Md", name: "Mendelevium", mass: null, period: 10, group: 15 },
    { z: 102, sym: "No", name: "Nobelium", mass: null, period: 10, group: 16 },
    { z: 103, sym: "Lr", name: "Lawrencium", mass: null, period: 10, group: 17 },
  ];

  const BY_Z = {};
  const BY_SYM = {};
  ELEMENTS.forEach((e) => { BY_Z[e.z] = e; BY_SYM[e.sym.toLowerCase()] = e; });

  function elementByZ(z) { return BY_Z[z] || null; }
  function elementBySymbol(sym) { return BY_SYM[String(sym).toLowerCase()] || null; }

  /** Rounds an atomic mass to the nearest whole number — used ONLY as an
   * introductory, explicitly-labeled approximation of a plausible mass
   * number, never presented as a specific real isotope. Returns null if
   * the reference table lists no atomic mass for this element. */
  function approximateMassNumber(element) {
    if (element.mass == null) return null;
    return Math.round(element.mass);
  }

  function protonsOf(element) { return element.z; }

  function neutronsOf(massNumber, atomicNumber) {
    const n = massNumber - atomicNumber;
    if (n < 0) throw new Error("Mass number cannot be less than atomic number");
    return n;
  }

  function electronsOfNeutralAtom(element) { return element.z; }

  /** charge = protons - electrons (standard sign convention: cation positive) */
  function chargeFromParticles(protons, electrons) { return protons - electrons; }

  function isNeutral(protons, electrons) { return protons === electrons; }

  /** Identify an element purely from a proton count. */
  function identifyByProtons(protons) { return elementByZ(protons); }

  /** Nuclear (isotope) notation pieces: mass number on top, atomic number on
   * bottom, symbol — e.g. 12/6 C. Returns strings for display composition. */
  function isotopeLabel(element, massNumber) {
    return { mass: String(massNumber), z: String(element.z), sym: element.sym };
  }
  function isotopeName(element, massNumber) {
    return element.name + "-" + massNumber;
  }

  /**
   * Simplified shell filling, exact for elements 1-20 under the standard
   * introductory rule taught at this level (shells cap at 2, 8, 8 before a
   * new shell starts) — this matches real ground-state configurations for
   * every element from hydrogen through calcium. It is NOT extended past
   * z=20: from scandium on, real configurations involve d-subshells that
   * break the simple 2-8-8 pattern (e.g. real Sc is 2-8-9-2, not 2-8-8-3),
   * so callers should only treat the result as an exact diagram for z<=20.
   */
  const SIMPLE_SHELL_CAPACITY = [2, 8, 8];
  function simpleShellFill(electronCount) {
    const shells = [];
    let remaining = electronCount;
    for (let i = 0; i < SIMPLE_SHELL_CAPACITY.length && remaining > 0; i++) {
      const take = Math.min(SIMPLE_SHELL_CAPACITY[i], remaining);
      shells.push(take);
      remaining -= take;
    }
    if (remaining > 0) shells.push(remaining); // beyond z=20; approximate overflow shell
    return shells;
  }
  function isSimpleShellExact(electronCount) { return electronCount <= 20; }

  return {
    ELEMENTS,
    elementByZ,
    elementBySymbol,
    approximateMassNumber,
    protonsOf,
    neutronsOf,
    electronsOfNeutralAtom,
    chargeFromParticles,
    isNeutral,
    identifyByProtons,
    isotopeLabel,
    isotopeName,
    simpleShellFill,
    isSimpleShellExact,
  };
});
