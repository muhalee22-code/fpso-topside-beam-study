import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, GRAVITY, analyse, atPosition, validate, runVerification} from '../dist/beam.js';
const close = (a,b,tol=1e-9) => assert.ok(Math.abs(a-b) <= tol * Math.max(1,Math.abs(b)), `${a} != ${b}`);

test('all user-visible benchmark checks pass', () => {
  for (const check of runVerification()) assert.ok(check.passed, check.name);
});
test('hand-calculated section, Q, stresses and deflection use consistent units', () => {
  const p = {...DEFAULTS, depth:300, flangeWidth:150, flangeThickness:10, webThickness:6, deadLoad:10, liveLoad:0, includeSelfWeight:false};
  const r=analyse(p);
  close(r.section.area,4680); close(r.section.inertia,74076000); close(r.section.modulus,493840); close(r.section.firstMoment,276300);
  close(r.bendingStress,90e6/493840); close(r.shearStress,60000*276300/(74076000*6));
  close(r.deflectionMax,5*20*6000**4/(384*200000*74076000));
  close(r.bendingUtil,r.bendingStress/(355/1.5)); close(r.shearUtil,r.shearStress/(355/(Math.sqrt(3)*1.5)));
});
test('beam self-weight toggles and density changes only the correct contribution', () => {
  const p={...DEFAULTS,deadLoad:0,liveLoad:0}; const r=analyse(p);
  close(r.selfWeight,r.section.area*1e-6*7850*GRAVITY/1000);
  close(analyse({...p,includeSelfWeight:false}).lineLoad,0);
  close(analyse({...p,density:15700}).lineLoad/r.lineLoad,2);
});
test('whole-deck geometry is context; tributary width transfers the area load', () => {
  const p={...DEFAULTS,includeSelfWeight:false}; const r=analyse(p);
  close(analyse({...p,deckLength:24,deckWidth:16}).momentMax,r.momentMax);
  close(analyse({...p,tributary:4}).momentMax/r.momentMax,2);
  close(r.totalBeamLoad,(p.deadLoad+p.liveLoad)*p.tributary*p.span);
});
test('E, fy and screen divisors act on the intended quantities', () => {
  const r=analyse(DEFAULTS); const s=analyse({...DEFAULTS,yieldStrength:710,youngModulus:250,stressDivisor:3,deflectionDivisor:500});
  close(s.momentMax,r.momentMax); close(s.bendingStress,r.bendingStress);
  close(s.bendingUtil,r.bendingUtil); close(s.deflectionMax/r.deflectionMax,0.8); close(s.deflectionUtil/r.deflectionUtil,1.6);
});
test('zero-load paths stay finite and all results are zero', () => {
  const p={...DEFAULTS,deadLoad:0,liveLoad:0,includeSelfWeight:false}; const r=analyse(p);
  for(const k of ['reactionA','reactionB','momentMax','shearMax','bendingStress','shearStress','deflectionMax','governingUtil']) close(r[k],0);
  for(const x of [0,1,3,6]) {const s=atPosition(p,r,x); close(s.moment,0); close(s.shear,0); close(s.deflection,0);}
});
test('invalid and physically impossible inputs are rejected', () => {
  for(const patch of [{span:0},{span:NaN},{deadLoad:-1},{youngModulus:Infinity},{span:13},{tributary:9},{flangeThickness:225},{webThickness:200},{includeSelfWeight:'yes'},{span:''}]) {
    assert.ok(Object.keys(validate({...DEFAULTS,...patch})).length); assert.throws(()=>analyse({...DEFAULTS,...patch}));
  }
  assert.throws(()=>atPosition(DEFAULTS,analyse(DEFAULTS),7),RangeError);
});
test('moment and deflection are symmetric; shear is antisymmetric', () => {
  const r=analyse(DEFAULTS);
  for(let j=0;j<=100;j++) { const x=j*DEFAULTS.span/100;const a=atPosition(DEFAULTS,r,x),b=atPosition(DEFAULTS,r,DEFAULTS.span-x);close(a.moment,b.moment);close(a.shear,-b.shear);close(a.deflection,b.deflection); }
});
test('numerical virtual-work integration independently checks peak deflection', () => {
  // Unit-load method: delta = integral M(x)*m(x)/(EI) dx.
  // N-mm units; numerical Simpson quadrature, independent from deflection formula.
  for(const patch of [{},{span:4,tributary:1.5},{span:10,deadLoad:8,depth:600}]) {
    const p={...DEFAULTS,...patch},r=analyse(p),L=p.span*1000,n=2000,dx=L/n;
    let sum=0;
    for(let j=0;j<=n;j++) { const x=j*dx;const M=r.lineLoad*L*x/2-r.lineLoad*x*x/2;const m=Math.min(x,L-x)/2;const f=M*m/(p.youngModulus*1000*r.section.inertia);sum+=f*(j===0||j===n?1:j%2?4:2); }
    close(sum*dx/3,r.deflectionMax,1e-10);
  }
});
test('grid of valid cases satisfies equilibrium, end conditions and peak locations', () => {
  for(const span of [0.1,2,6,12]) for(const q of [0,2,50,500]) for(const E of [10,200,300]) {
    const p={...DEFAULTS,span,deadLoad:q,liveLoad:0,youngModulus:E},r=analyse(p);
    close(r.reactionA+r.reactionB,r.lineLoad*span);close(atPosition(p,r,span).moment,0,1e-8);
    close(atPosition(p,r,span/2).moment,r.momentMax);close(atPosition(p,r,span/2).deflection,r.deflectionMax);
    assert.ok(Number.isFinite(r.governingUtil));
  }
});
