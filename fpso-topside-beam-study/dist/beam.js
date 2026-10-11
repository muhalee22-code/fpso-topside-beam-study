// One simply supported, prismatic I-beam under a full-span downward UDL.
// Geometry: mm; beam equations: N, mm, N/mm². 1 kN/m = 1 N/mm.
export const MODEL_VERSION = '1.0.0';
export const GRAVITY = 9.80665;
export const DEFAULTS = Object.freeze({
  deckLength: 12, deckWidth: 8, span: 6, tributary: 2,
  deadLoad: 3, liveLoad: 5, includeSelfWeight: true,
  depth: 450, flangeWidth: 200, flangeThickness: 16, webThickness: 10,
  yieldStrength: 355, youngModulus: 200, density: 7850,
  stressDivisor: 1.5, deflectionDivisor: 250
});

export const LIMITS = Object.freeze({
  deckLength: [0.1, 200], deckWidth: [0.1, 100], span: [0.1, 100], tributary: [0.05, 100],
  deadLoad: [0, 500], liveLoad: [0, 500], depth: [20, 3000], flangeWidth: [10, 2000],
  flangeThickness: [1, 200], webThickness: [1, 200], yieldStrength: [50, 1500],
  youngModulus: [10, 300], density: [1000, 25000], stressDivisor: [1, 10], deflectionDivisor: [50, 2000]
});

export const LABELS = Object.freeze({
  deckLength: 'Deck length', deckWidth: 'Deck width', span: 'Support span', tributary: 'Tributary width',
  deadLoad: 'Permanent area load', liveLoad: 'Variable area load', depth: 'Section depth',
  flangeWidth: 'Flange width', flangeThickness: 'Flange thickness', webThickness: 'Web thickness',
  yieldStrength: 'Yield strength', youngModulus: 'Young’s modulus', density: 'Material density',
  stressDivisor: 'Stress screening divisor', deflectionDivisor: 'Deflection divisor'
});

export function validate(input) {
  const errors = {};
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) errors[key] = `${LABELS[key]} needs a finite number.`;
    else if (value < min || value > max) errors[key] = `Enter ${min}–${max}.`;
  }
  if (typeof input.includeSelfWeight !== 'boolean') errors.includeSelfWeight = 'Select a self-weight option.';
  if (!errors.span && !errors.deckLength && input.span > input.deckLength) errors.span = 'Span cannot exceed the deck length.';
  if (!errors.tributary && !errors.deckWidth && input.tributary > input.deckWidth) errors.tributary = 'Tributary width cannot exceed the deck width.';
  if (!errors.depth && !errors.flangeThickness && input.depth <= 2 * input.flangeThickness) errors.flangeThickness = 'Two flanges must leave a positive web height.';
  if (!errors.webThickness && !errors.flangeWidth && input.webThickness >= input.flangeWidth) errors.webThickness = 'Web thickness must be smaller than the flange width.';
  return errors;
}

export function sectionProperties(input) {
  const {depth: h, flangeWidth: b, flangeThickness: tf, webThickness: tw} = input;
  const hw = h - 2 * tf;
  const area = 2 * b * tf + hw * tw;
  const inertia = 2 * (b * tf ** 3 / 12 + b * tf * ((h - tf) / 2) ** 2) + tw * hw ** 3 / 12;
  const modulus = inertia / (h / 2);
  const firstMoment = b * tf * (h - tf) / 2 + tw * hw ** 2 / 8;
  return {area, inertia, modulus, firstMoment, webHeight: hw, webArea: tw * hw};
}

export function analyse(input) {
  const errors = validate(input);
  if (Object.keys(errors).length) {
    const error = new Error('Invalid beam inputs');
    error.fields = errors;
    throw error;
  }
  const section = sectionProperties(input);
  const lengthMm = input.span * 1000;
  const modulusMPa = input.youngModulus * 1000;
  const massPerMetre = section.area * 1e-6 * input.density;
  const selfWeight = input.includeSelfWeight ? massPerMetre * GRAVITY / 1000 : 0;
  const areaLoad = input.deadLoad + input.liveLoad;
  const permanentLine = input.deadLoad * input.tributary;
  const variableLine = input.liveLoad * input.tributary;
  const lineLoad = permanentLine + variableLine + selfWeight; // kN/m = N/mm
  const totalBeamLoad = lineLoad * input.span;
  const reactionA = totalBeamLoad / 2;
  const reactionB = reactionA;
  const momentMax = lineLoad * input.span ** 2 / 8; // kN·m
  const shearMax = reactionA; // kN
  const bendingStress = momentMax * 1e6 / section.modulus; // MPa
  // Q at the neutral axis; peak elastic web shear immediately inside a support.
  const shearStress = shearMax * 1000 * section.firstMoment / (section.inertia * input.webThickness);
  const deflectionMax = 5 * lineLoad * lengthMm ** 4 / (384 * modulusMPa * section.inertia); // mm
  const bendingLimit = input.yieldStrength / input.stressDivisor;
  const shearLimit = input.yieldStrength / (Math.sqrt(3) * input.stressDivisor);
  const deflectionLimit = lengthMm / input.deflectionDivisor;
  const bendingUtil = bendingStress / bendingLimit;
  const shearUtil = shearStress / shearLimit;
  const deflectionUtil = deflectionMax / deflectionLimit;
  const governingUtil = Math.max(bendingUtil, shearUtil, deflectionUtil);
  const governing = governingUtil === 0 ? 'No applied load' :
    governingUtil === deflectionUtil ? 'Deflection' : governingUtil === bendingUtil ? 'Bending stress' : 'Web shear stress';
  const warnings = [];
  if (lengthMm / input.depth < 10) warnings.push('L/h is below 10. Shear deformation may matter; Euler–Bernoulli deflection may be too small.');
  if (deflectionMax / lengthMm > 0.01) warnings.push('Predicted deflection exceeds 1% of the span. Reconsider the small-deflection assumption.');
  if (bendingStress > input.yieldStrength || shearStress > input.yieldStrength / Math.sqrt(3)) warnings.push('An elastic stress exceeds its yield reference. These elastic results do not model redistribution or plasticity.');
  return {
    section, massPerMetre, areaLoad, permanentLine, variableLine, selfWeight, lineLoad,
    deckArea: input.deckLength * input.deckWidth,
    tributaryArea: input.span * input.tributary,
    // Whole-deck area load is context only; selected-beam self-weight is excluded.
    deckAreaLoadTotal: areaLoad * input.deckLength * input.deckWidth,
    totalBeamLoad, reactionA, reactionB, momentMax, shearMax, bendingStress, shearStress,
    deflectionMax, bendingLimit, shearLimit, deflectionLimit,
    bendingUtil, shearUtil, deflectionUtil, governingUtil, governing,
    equilibriumResidual: reactionA + reactionB - totalBeamLoad, warnings
  };
}

export function atPosition(input, result, xMetres) {
  if (!Number.isFinite(xMetres) || xMetres < 0 || xMetres > input.span) throw new RangeError('x must be within the beam span.');
  const x = xMetres * 1000;
  const L = input.span * 1000;
  return {
    x: xMetres,
    shear: result.reactionA - result.lineLoad * xMetres,
    moment: result.reactionA * xMetres - result.lineLoad * xMetres ** 2 / 2,
    deflection: result.lineLoad * x * (L ** 3 - 2 * L * x ** 2 + x ** 3) / (24 * input.youngModulus * 1000 * result.section.inertia)
  };
}

export function runVerification() {
  const checks = [];
  const base = {...DEFAULTS, deadLoad: 10, liveLoad: 0, includeSelfWeight: false};
  const r = analyse(base);
  const add = (name, actual, expected) => checks.push({name, actual, expected, passed: Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected))});
  add('UDL: each reaction, q = 20 kN/m & L = 6 m', r.reactionA, 60);
  add('UDL: peak sagging moment', r.momentMax, 90);
  add('UDL: peak absolute shear', r.shearMax, 60);
  add('Vertical equilibrium residual', r.equilibriumResidual, 0);
  add('Bending moment at left support', atPosition(base, r, 0).moment, 0);
  add('Deflection at right support', atPosition(base, r, base.span).deflection, 0);
  add('Shear at midspan', atPosition(base, r, base.span / 2).shear, 0);
  add('Curve agrees with maximum deflection', atPosition(base, r, base.span / 2).deflection, r.deflectionMax);
  const double = analyse({...base, span: 12});
  add('Double span: moment multiplier', double.momentMax / r.momentMax, 4);
  add('Double span: deflection multiplier', double.deflectionMax / r.deflectionMax, 16);
  const stiff = analyse({...base, youngModulus: 250});
  add('Increase E: inverse deflection ratio', stiff.deflectionMax / r.deflectionMax, 0.8);
  const known = analyse({...base, depth: 300, flangeWidth: 150, flangeThickness: 10, webThickness: 6});
  add('Hand I-section: area (mm²)', known.section.area, 4680);
  add('Hand I-section: I (mm⁴)', known.section.inertia, 74076000);
  const zero = analyse({...base, deadLoad: 0});
  add('Zero load: all screens', zero.governingUtil, 0);
  return checks;
}
