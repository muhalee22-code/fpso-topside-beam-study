# FPSO Topside Deck Beam Study

A small personal project by Lee Muha to explore a gravity-load path in an FPSO topside deck bay. A tributary deck strip is reduced to one simply supported I-beam. The calculator shows reactions, shear, bending moment, elastic stresses and deflection, then lets users compare different inputs.

The web tool was built with AI-assisted coding. Its model, equations and verification are documented below.

## What you can do

- Set deck dimensions, support span and tributary width.
- Enter permanent and variable area loads, with optional beam self-weight.
- Change I-section dimensions, material stiffness, yield strength and screening limits.
- Inspect moment, shear and deflection along the span.
- Save and compare up to five cases; reload cases, export CSV or print the study.

Saved cases stay in the visitor's browser. The application has no backend, tracking scripts, external runtime dependencies or API requests.

## Run locally

Use a static HTTP server because the calculator uses JavaScript modules:

```sh
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. To run verification with Node.js:

```sh
npm run check
npm test
```

There are no packages to install. The repository includes 20 engineering and application-logic tests. The page also runs 14 visible engine checks.

## Model and units

The analysed beam has a pin and roller, a constant rectangular I-section and a full-span downward UDL. Overall deck dimensions are context only. The loaded tributary area is support span × tributary width.

| Quantity | Input or output unit |
|---|---|
| Deck dimensions, span and tributary width | m |
| Permanent and variable area load | kN/m² |
| Beam line load | kN/m |
| Section dimensions | mm |
| Young's modulus E | GPa |
| Yield strength and stresses | MPa |
| Reactions and shear force | kN |
| Bending moment | kN·m |
| Deflection | mm |
| Utilisation | ratio or % |

The engine converts beam arithmetic to N and mm. In particular, 1 kN/m = 1 N/mm, 1 kN·m = 10⁶ N·mm and 1 GPa = 10³ MPa.

### Load path and beam response

```text
w = (pG + pQ) × tributary width + beam self-weight
RA = RB = wL / 2
V(x) = RA − wx
M(x) = RA × x − wx² / 2
Mmax = wL² / 8
σmax = Mmax / Z
τNA,max = |V|max × QNA / (I × tw)
δmax = 5wL⁴ / (384EI)
```

Section properties are calculated from two rectangular flanges and one rectangular web. Fillets and an effective deck flange are excluded. The reported shear stress is the neutral-axis web stress using VQ/(Itw), rather than average web shear. Euler–Bernoulli theory is used for elastic deflection.

Permanent area load should include deck plating/grating and equipment allowances. When automatic beam self-weight is enabled, exclude that selected beam from the permanent area load to avoid counting it twice. Gravity is 9.80665 m/s². Equipment loads are smeared as a UDL; equipment footprints and point loads are outside this model.

### Screening limits

Bending stress is compared with fy/γ, shear stress with fy/(√3γ), and deflection with L/N. Defaults γ = 1.5 and N = 250 are illustrative choices, not project or design-code limits. Loads are unfactored. The largest of the three independent ratios is reported as the governing screen.

Bending and shear maxima occur at different locations. They are not combined into a stress-interaction check. A utilisation below 100% does not establish structural adequacy or code compliance.

## Verification

The hand-check load case has w = 20 kN/m, L = 6 m and beam self-weight disabled:

| Result | Expected value |
|---|---|
| Reaction at A and B | 60 kN each |
| Maximum sagging moment | 90 kN·m |
| Maximum absolute shear | 60 kN |

The tests also cover an independently calculated I-section, unit conversions, zero loads, self-weight, invalid inputs, equilibrium, end conditions, response symmetry and a grid of 144 valid cases. Midspan deflection is independently checked by numerically integrating M(x)m(x)/(EI) using the unit-load method and Simpson quadrature.

Application-logic tests cover live updates, presets, plots, keyboard controls, scenario storage and restore, invalid-state handling, CSV export and print invocation. A limited DOM harness is used for these tests; it does not render CSS or replace real desktop/mobile browser QA. The interface includes responsive layouts, but actual browser visual QA is still outstanding.

## Scope and next steps

This is a local gravity-load beam study. It excludes vessel accelerations and motions, environmental and accidental loads, grillage continuity, connection behaviour, corrosion, local and lateral torsional buckling, fatigue, vibration, and lifting, transport and installation cases. No API, ISO, AISC or classification-rule compliance is claimed.

A useful next step is to compare the same simple case with a frame/grillage analysis before adding verified offshore load combinations and stability checks.

## Optional GitHub Pages demo

The repository includes a manually triggered Pages workflow. Uploading this repository alone does not trigger a Pages publication.

When a public demo is wanted:

1. In repository **Settings → Pages**, select **GitHub Actions** as the source.
2. In **Actions**, run **Deploy demo to GitHub Pages**.
3. Use the URL reported by the successful deployment as the resume's Live Demo link.

The workflow runs syntax and calculation tests before publishing only `dist/`. The source files and tests remain available separately in the repository.

## Mechanics references

- [MIT OpenCourseWare, 1.050 Solid Mechanics — Chapter 9: Stresses in Beams](https://ocw.mit.edu/courses/1-050-solid-mechanics-fall-2004/8f0200f4ca3236383a2ef048c7ec4c40_emech9_04.pdf)
- [MIT OpenCourseWare, 1.050 Solid Mechanics — Chapter 10: Beam Deflections](https://ocw.mit.edu/courses/1-050-solid-mechanics-fall-2004/f9a4d5764b9b0f51ffaacbdf69f7aed8_emech10_04.pdf)

These references support the elementary mechanics, not offshore project criteria.
