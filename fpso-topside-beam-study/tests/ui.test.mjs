import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupDOM} from './dom-harness.mjs';
import {analyse,DEFAULTS} from '../dist/beam.js';
let count=0;
async function open(storage){const env=setupDOM(storage);await import(`../dist/app.js?test=${++count}`);return {...env,$:id=>env.document.getElementById(id)};}
const change=(el,v)=>{el.value=String(v);el.dispatch('input');};

test('initial UI uses real engine outputs and visible checks',async()=>{
  const {$}=await open();
  assert.equal($('reaction-value').textContent,'50.44');assert.equal($('moment-value').textContent,'75.67');assert.equal($('deflection-value').textContent,'3.92');
  assert.equal($('verification-status').textContent,'14 / 14 checks passed');assert.equal($('result-shell').hidden,false);
  assert.match($('deck-plan').innerHTML,/12.0 × 8.0 m/);assert.match($('beam-diagram').innerHTML,/16.81 kN\/m/);
});
test('input changes update results; invalid inputs hide stale output and disable actions',async()=>{
  const {$}=await open();change($('span'),8);assert.equal($('moment-value').textContent,'134.52');
  change($('span'),13);assert.equal($('result-shell').hidden,true);assert.equal($('save-case').disabled,true);assert.equal($('print-study').disabled,true);assert.equal($('span').getAttribute('aria-invalid'),'true');assert.match($('error-summary').textContent,/Span cannot exceed/);
  change($('span'),6);assert.equal($('result-shell').hidden,false);assert.equal($('span').getAttribute('aria-invalid'),'false');
  change($('liveLoad'),'');assert.equal($('result-shell').hidden,true);
});
test('presets, self-weight toggle and reset follow the input state',async()=>{
  const {$}=await open();$('preset').value='benchmark';$('preset').dispatch('change');assert.equal($('moment-value').textContent,'90.00');assert.equal($('reaction-value').textContent,'60.00');assert.equal($('includeSelfWeight').checked,false);
  $('includeSelfWeight').checked=true;$('includeSelfWeight').dispatch('input');assert.equal($('reaction-value').textContent,'62.44');
  $('reset').click();assert.equal($('case-name').value,'Deck bay baseline');assert.equal($('span').value,'6');assert.equal($('reaction-value').textContent,'50.44');
});
test('response tabs, keyboard navigation, slider and plot inspection work',async()=>{
  const {$,document}=await open();$('tab-shear').click();assert.equal($('plot-panel').getAttribute('aria-labelledby'),'tab-shear');assert.match($('response-plot').innerHTML,/V · kN/);
  $('position').value=0;$('position').dispatch('input');assert.equal($('position-label').textContent,'x = 0.00 m');assert.match($('position-results').textContent,/50.44 kN/);
  $('tab-shear').dispatch('keydown',{key:'ArrowRight'});assert.equal($('tab-deflection').getAttribute('aria-selected'),'true');assert.equal(document.activeElement,$('tab-deflection'));
  $('response-plot').dispatch('click',{clientX:404.5});assert.equal($('position').value,'500');assert.equal($('position-label').textContent,'x = 3.00 m');
});
test('saved snapshots retain inputs, compare, reload and remove correctly',async()=>{
  const {$,storage}=await open();$('save-case').click();change($('span'),8);change($('case-name'),'Long bay');$('save-case').click();
  const saved=JSON.parse(storage.data.get('muha.topside.deck-studio.v1'));assert.equal(saved.cases.length,2);assert.equal(saved.cases[0].input.span,6);assert.equal(saved.cases[1].input.span,8);assert.match($('compare-insight').textContent,/\+77.8%/);
  const first=$('comparison-table').querySelectorAll('[data-load]')[0];first.click();assert.equal($('span').value,'6');assert.equal($('moment-value').textContent,'75.67');
  $('comparison-table').querySelectorAll('[data-remove]')[0].click();assert.equal(JSON.parse(storage.data.get('muha.topside.deck-studio.v1')).cases.length,1);
});
test('comparison snapshot limit is enforced and saved cases export during invalid editing',async()=>{
  const {$,storage}=await open();for(let i=0;i<6;i++){$('case-name').value=`Case ${i}`;$('save-case').click();}
  assert.equal(JSON.parse(storage.data.get('muha.topside.deck-studio.v1')).cases.length,5);assert.equal($('save-case').disabled,true);
  change($('span'),13);assert.equal($('export-csv').disabled,false);assert.match($('compare-insight').textContent,/invalid/);
});
test('CSV has exact inputs and results, neutralises formula names and escapes quotes',async()=>{
  const {$,downloads}=await open();change($('case-name'),'=SUM(1,2) "case"');$('save-case').click();$('export-csv').click();
  assert.equal(downloads.length,1);const csv=await downloads[0].text();assert.match(csv,/'=SUM\(1,2\) ""case""/);assert.match(csv,/maximum_moment_kNm/);assert.match(csv,/75.665122661025/);assert.match(csv,/Unfactored UDL/);assert.equal(csv.split('\r\n').length,3);
});
test('storage restore recomputes valid cases and filters invalid snapshots',async()=>{
  const {$}=await open({'muha.topside.deck-studio.v1':JSON.stringify({version:'1.0.0',cases:[{id:'ok',name:'Restored case',input:{...DEFAULTS,span:8},createdAt:'2026-10-11T00:00:00Z'},{id:'bad',name:'Invalid case',input:{...DEFAULTS,span:500}}]})});
  assert.equal($('comparison-table').querySelectorAll('[data-load]').length,1);assert.match($('comparison-table').textContent,/Restored case/);assert.doesNotMatch($('comparison-table').textContent,/Invalid case/);
  $('comparison-table').querySelectorAll('[data-load]')[0].click();assert.equal($('moment-value').textContent,'134.52');
});
test('unsafe case labels remain escaped and model notices appear for large/short response',async()=>{
  const {$}=await open();change($('case-name'),'<img src=x onerror=alert(1)>');$('save-case').click();assert.doesNotMatch($('comparison-table').innerHTML,/<img src=x/);assert.match($('comparison-table').innerHTML,/&lt;img/);
  change($('span'),1);assert.equal($('model-warnings').hidden,false);assert.match($('model-warnings').textContent,/Shear deformation/);
  $('reset').click();change($('liveLoad'),500);assert.equal($('screen-status').textContent,'Selected limit exceeded');assert.match($('model-warnings').textContent,/yield reference/);
});
test('printing uses current state and responsive, accessible structure is present',async()=>{
  const {$,document}=await open();$('print-study').click();assert.equal(document.printed,true);
  const css=readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:650px\)/);assert.match(css,/@media\(max-width:1150px\)/);assert.match(css,/@media print/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/overflow:auto/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/name="viewport"/);assert.match(html,/class="skip-link"/);assert.match(html,/role="tablist"/);assert.match(html,/role="region"/);
  for(const id of Object.keys(DEFAULTS).filter(k=>k!=='includeSelfWeight'))assert.ok($(id),`labelled input ${id}`);
  assert.equal(analyse(DEFAULTS).equilibriumResidual,0);
});
