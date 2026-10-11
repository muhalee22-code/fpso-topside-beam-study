import {DEFAULTS, LIMITS, LABELS, MODEL_VERSION, analyse, atPosition, validate, runVerification} from './beam.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits = 2) => {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < 0.001)) return value.toExponential(2);
  return value.toLocaleString('en-GB', {minimumFractionDigits: digits, maximumFractionDigits: digits});
};
const pc = (value) => `${fmt(value * 100, 1)}%`;
const units = {deckLength:'m',deckWidth:'m',span:'m',tributary:'m',deadLoad:'kN/m²',liveLoad:'kN/m²',depth:'mm',flangeWidth:'mm',flangeThickness:'mm',webThickness:'mm',yieldStrength:'MPa',youngModulus:'GPa',density:'kg/m³',stressDivisor:'—',deflectionDivisor:'L / N'};
const steps = {deckLength:0.5,deckWidth:0.5,span:0.1,tributary:0.1,deadLoad:0.1,liveLoad:0.1,depth:10,flangeWidth:10,flangeThickness:1,webThickness:1,yieldStrength:5,youngModulus:1,density:50,stressDivisor:0.1,deflectionDivisor:10};
const groups = [
  {title:'Deck geometry',symbol:'01',fields:['deckLength','deckWidth','span','tributary'],help:'L is the centre-to-centre support span. The selected strip is contained within the deck; adjoining bays are not analysed.',open:true},
  {title:'Distributed loading',symbol:'02',fields:['deadLoad','liveLoad'],help:'Unfactored gravity loads. Permanent load excludes the selected beam’s self-weight. No vessel motion or point-load effects.',toggle:true,open:true},
  {title:'I-section geometry',symbol:'03',fields:['depth','flangeWidth','flangeThickness','webThickness'],section:true,open:false},
  {title:'Material & screening limits',symbol:'04',fields:['yieldStrength','youngModulus','density','stressDivisor','deflectionDivisor'],help:'Material values are assumed inputs. γ = 1.5 and L/250 are illustrative screens, not project or code criteria.',open:false}
];
const fieldHTML = (key) => {
  const [min,max] = LIMITS[key];
  return `<div class="field${key === 'density' ? ' full' : ''}"><label for="${key}">${esc(LABELS[key])}</label><div class="input-unit"><input type="number" id="${key}" name="${key}" value="${DEFAULTS[key]}" min="${min}" max="${max}" step="${steps[key]}" inputmode="decimal" required aria-describedby="${key}-error"><span class="unit">${units[key]}</span></div><span class="field-error" id="${key}-error" hidden></span></div>`;
};
$('input-groups').innerHTML = groups.map(g => `<details class="input-group"${g.open ? ' open' : ''}><summary><span><span class="group-symbol">${g.symbol}</span>${g.title}</span><span class="group-arrow" aria-hidden="true">+</span></summary><div class="group-fields">${g.fields.map(fieldHTML).join('')}${g.toggle ? '<label class="toggle-field" for="includeSelfWeight"><input type="checkbox" id="includeSelfWeight" checked>Include selected beam self-weight</label>' : ''}${g.section ? '<div class="section-mini"><svg viewBox="0 0 70 85" role="img" aria-label="Symmetric I-section: two flanges and one web"><path d="M10 5 H60 V17 H41 V68 H60 V80 H10 V68 H29 V17 H10 Z" fill="#d8ded2" stroke="#657462" stroke-width="1.5"/><line x1="4" y1="43" x2="66" y2="43" stroke="#b8502f" stroke-dasharray="3 3"/></svg><p>Rectangular flanges and web.<br>Major-axis bending; no fillets.<br>Neutral axis at h / 2.</p></div>' : ''}${g.help ? `<p class="field-help">${g.help}</p>` : ''}</div></details>`).join('');

let input = {...DEFAULTS};
let result = null;
let plot = 'moment';
let valid = true;
let cases = [];
let storageAvailable = true;
let toastTimer;
const storageKey = 'muha.topside.deck-studio.v1';

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function readForm() {
  const p = {};
  for (const key of Object.keys(LIMITS)) p[key] = $(key).value.trim() === '' ? NaN : Number($(key).value);
  p.includeSelfWeight = $('includeSelfWeight').checked;
  return p;
}
function fillForm(p) {
  for (const key of Object.keys(LIMITS)) $(key).value = p[key];
  $('includeSelfWeight').checked = p.includeSelfWeight;
}
function update() {
  input = readForm();
  const errors = validate(input);
  valid = !Object.keys(errors).length;
  for (const key of Object.keys(LIMITS)) {
    const error = errors[key];
    $(key).setAttribute('aria-invalid', String(!!error));
    $(`${key}-error`).textContent = error || '';
    $(`${key}-error`).hidden = !error;
    if (error) $(key).closest('details').open = true;
  }
  $('error-summary').hidden = valid;
  $('result-shell').hidden = !valid;
  $('save-case').disabled = !valid || cases.length >= 5;
  $('print-study').disabled = !valid;
  $('export-csv').disabled = !valid && !cases.length;
  if (!valid) {
    result = null;
    $('error-summary').innerHTML = `<h2>Check the model inputs</h2><p>Current results are paused until these values are valid.</p><ul>${Object.entries(errors).map(([k,v])=>`<li><strong>${esc(LABELS[k] || k)}:</strong> ${esc(v)}</li>`).join('')}</ul>`;
    renderComparison();
    return;
  }
  result = analyse(input);
  renderModel();
  $('reaction-value').textContent = fmt(result.reactionA);
  $('moment-value').textContent = fmt(result.momentMax);
  $('shear-value').textContent = fmt(result.shearMax);
  $('deflection-value').textContent = fmt(result.deflectionMax);
  renderPlot();
  renderScreens();
  renderComparison();
}

function renderModel() {
  const p = input, r = result;
  // Perspective plan is schematic. Physical dimensions drive the projection.
  const scale = Math.min(268 / (p.deckLength + .58*p.deckWidth),112 / (.65*p.deckWidth));
  const ox = (350 - scale * (p.deckLength + .58*p.deckWidth)) / 2;
  const point = (x,y) => [ox+scale*(x+.58*y),145-scale*.65*y];
  const pair = (a) => a.map(v=>v.toFixed(2)).join(',');
  const polygon = (coords) => coords.map(v=>pair(point(...v))).join(' ');
  const center = p.deckWidth/2, low = center-p.tributary/2, high = center+p.tributary/2;
  const outline = polygon([[0,0],[p.deckLength,0],[p.deckLength,p.deckWidth],[0,p.deckWidth]]);
  const strip = polygon([[0,low],[p.span,low],[p.span,high],[0,high]]);
  const beams = Array.from({length:5},(_,i) => {
    const y=p.deckWidth*(i+1)/6;
    return `<line x1="${point(0,y)[0]}" y1="${point(0,y)[1]}" x2="${point(p.deckLength,y)[0]}" y2="${point(p.deckLength,y)[1]}" stroke="#5c747c" stroke-width="1"/>`;
  }).join('');
  const edgeA=point(0,center),edgeB=point(p.span,center);
  const support=(x)=>`<line x1="${point(x,0)[0]}" y1="${point(x,0)[1]}" x2="${point(x,p.deckWidth)[0]}" y2="${point(x,p.deckWidth)[1]}" stroke="#aec0c3" stroke-width="2"/>`;
  $('deck-plan').innerHTML = `<svg viewBox="0 0 350 202" role="img" aria-label="Deck ${fmt(p.deckLength)} by ${fmt(p.deckWidth)} metres, highlighted beam strip ${fmt(p.span)} by ${fmt(p.tributary)} metres. Schematic plan."><polygon points="${outline}" fill="#293f48" stroke="#819ba1" stroke-width="1.3"/>${beams}<polygon points="${strip}" fill="#b8502f" fill-opacity=".43" stroke="#e49a75" stroke-width="1.3"/>${support(0)}${support(p.span)}<line x1="${edgeA[0]}" y1="${edgeA[1]}" x2="${edgeB[0]}" y2="${edgeB[1]}" stroke="#f0b58c" stroke-width="3"/><circle cx="${edgeA[0]}" cy="${edgeA[1]}" r="3" fill="#f0b58c"/><circle cx="${edgeB[0]}" cy="${edgeB[1]}" r="3" fill="#f0b58c"/><text x="175" y="170" text-anchor="middle" fill="#c2d4d4" font-size="11" font-family="monospace">Deck ${fmt(p.deckLength,1)} × ${fmt(p.deckWidth,1)} m</text><text x="175" y="190" text-anchor="middle" fill="#e8a588" font-size="10" font-family="monospace">L = ${fmt(p.span,1)} m · bₜ = ${fmt(p.tributary,1)} m</text><text x="12" y="16" fill="#8ca6ad" font-size="8" font-family="Arial">SCHEMATIC · NO SCALE</text></svg>`;
  const arrows = Array.from({length:12},(_,i)=>{const x=47+i*25.2;return `<path d="M${x} 51 V95 m-4 -6 l4 6 l4 -6" fill="none" stroke="#e6a286" stroke-width="1.6"/>`;}).join('');
  $('beam-diagram').innerHTML = `<svg viewBox="0 0 380 202" role="img" aria-label="Simply supported beam, span ${fmt(p.span)} metres. Downward line load ${fmt(r.lineLoad)} kilonewtons per metre. Reactions at A and B are ${fmt(r.reactionA)} kilonewtons each."><text x="189" y="24" fill="#e6a286" font-size="12" text-anchor="middle" font-family="monospace">w = ${fmt(r.lineLoad)} kN/m ↓</text><line x1="46" y1="46" x2="326" y2="46" stroke="#cf8d70" stroke-width="1.2"/>${arrows}<line x1="46" y1="101" x2="326" y2="101" stroke="#cfdfd9" stroke-width="5"/><path d="M46 107 L36 123 H56 Z" fill="#4d636b" stroke="#b7c9c8"/><path d="M326 107 L316 120 H336 Z" fill="#4d636b" stroke="#b7c9c8"/><circle cx="321" cy="125" r="2.5" fill="none" stroke="#b7c9c8"/><circle cx="331" cy="125" r="2.5" fill="none" stroke="#b7c9c8"/><path d="M46 164 V133 m-4 6 l4 -6 l4 6 M326 164 V135 m-4 6 l4 -6 l4 6" fill="none" stroke="#aeced3" stroke-width="1.5"/><text x="46" y="187" fill="#c7dedd" font-size="10" text-anchor="middle" font-family="monospace">A: ${fmt(r.reactionA,1)} kN</text><text x="326" y="187" fill="#c7dedd" font-size="10" text-anchor="middle" font-family="monospace">B: ${fmt(r.reactionB,1)} kN</text><path d="M70 143 H302 M70 139 V147 M302 139 V147" stroke="#68838a" fill="none"/><text x="187" y="137" fill="#a9bdc3" text-anchor="middle" font-size="10" font-family="monospace">L = ${fmt(p.span,1)} m</text></svg>`;
  $('load-equation').innerHTML = `<span class="equation-left">AREA LOAD → LINE LOAD</span><span>(${fmt(p.deadLoad,1)} + ${fmt(p.liveLoad,1)}) × ${fmt(p.tributary,1)} + ${fmt(r.selfWeight,3)}</span><strong>= ${fmt(r.lineLoad)} kN/m</strong>`;
}

function renderPlot() {
  if (!result) return;
  const p=input,r=result,fraction=Number($('position').value)/1000,x=fraction*p.span;
  const sample=atPosition(p,r,x);
  const cfg={moment:{label:'M · kN·m',value:'moment',max:r.momentMax,zero:197,gain:-137,color:'#b8502f',maxLabel:'Sagging'},shear:{label:'V · kN',value:'shear',max:r.shearMax,zero:117,gain:-77,color:'#46778a',maxLabel:'Positive / negative'},deflection:{label:'δ↓ · mm',value:'deflection',max:r.deflectionMax,zero:47,gain:137,color:'#497c5c',maxLabel:'Downward'}}[plot];
  const max=cfg.max || 1,X=(v)=>58+v/p.span*693,Y=(v)=>cfg.zero+(v/max)*cfg.gain;
  const points=Array.from({length:101},(_,i)=>{const xi=p.span*i/100;return [X(xi),Y(atPosition(p,r,xi)[cfg.value])];});
  const line=points.map(([a,b],i)=>`${i?'L':'M'}${a.toFixed(2)},${b.toFixed(2)}`).join(' ');
  const fill=`M58,${cfg.zero} ${line.replace(/^M/,'L')} L751,${cfg.zero} Z`;
  let grid='';
  const vals=plot==='shear' ? [r.shearMax,0,-r.shearMax] : [0,cfg.max/2,cfg.max];
  for(const v of vals) grid+=`<line x1="58" y1="${Y(v)}" x2="751" y2="${Y(v)}" stroke="#e6eae3" stroke-dasharray="3 5"/><text x="49" y="${Y(v)+3}" text-anchor="end" fill="#758078" font-size="9" font-family="monospace">${fmt(v,1)}</text>`;
  for(let i=0;i<=4;i++) {const xi=p.span*i/4;grid+=`<line x1="${X(xi)}" y1="32" x2="${X(xi)}" y2="200" stroke="#eef0eb"/><text x="${X(xi)}" y="219" text-anchor="middle" fill="#758078" font-size="9" font-family="monospace">${fmt(xi,1)}</text>`;}
  const vertical=`<line x1="${X(x)}" y1="33" x2="${X(x)}" y2="201" stroke="#617168" stroke-dasharray="4 4"/><circle cx="${X(x)}" cy="${Y(sample[cfg.value])}" r="4.5" fill="${cfg.color}" stroke="white" stroke-width="2"/>`;
  $('response-plot').innerHTML=`<svg viewBox="0 0 780 237" role="img" aria-label="${esc(cfg.label)} diagram. At x equals ${fmt(x)} metres, value is ${fmt(sample[cfg.value])}. Peak magnitude ${fmt(cfg.max)}."><text x="58" y="17" fill="#69756d" font-size="10" font-family="monospace">${cfg.label}</text><text x="751" y="17" text-anchor="end" fill="#899187" font-size="9" font-family="Arial">${cfg.maxLabel}</text>${grid}<path d="${fill}" fill="${cfg.color}" fill-opacity=".10"/><line x1="58" y1="${cfg.zero}" x2="751" y2="${cfg.zero}" stroke="#9caaa0"/><path d="${line}" fill="none" stroke="${cfg.color}" stroke-width="2.5"/>${vertical}<text x="751" y="236" fill="#899187" text-anchor="end" font-size="9" font-family="monospace">x from support A · m</text></svg>`;
  $('position-label').textContent=`x = ${fmt(x)} m`;
  $('position').setAttribute('aria-valuetext',`${fmt(x)} metres from support A`);
  $('position-results').innerHTML=`<div><span>Moment at x</span><strong>${fmt(sample.moment)} kN·m</strong></div><div><span>Shear at x</span><strong>${fmt(sample.shear)} kN</strong></div><div><span>Deflection at x</span><strong>${fmt(sample.deflection)} mm ↓</strong></div>`;
}

function renderScreens() {
  const r=result,p=input;
  const list=[{name:'Extreme-fibre bending stress',stress:r.bendingStress,unit:'MPa',limit:r.bendingLimit,util:r.bendingUtil,description:'σ / (fᵧ / γ)'},{name:'Web shear at the neutral axis',stress:r.shearStress,unit:'MPa',limit:r.shearLimit,util:r.shearUtil,description:'τ / (fᵧ / (√3 γ))'},{name:'Midspan deflection',stress:r.deflectionMax,unit:'mm',limit:r.deflectionLimit,util:r.deflectionUtil,description:`δ / (L / ${fmt(p.deflectionDivisor,0)})`}];
  $('screen-bars').innerHTML=list.map(a=>`<div class="screen-row"><div class="screen-row-header"><strong>${a.name}</strong><span><span class="stress-value">${fmt(a.stress)} ${a.unit}</span><span class="util-value${a.util>1?' exceeded':''}">${pc(a.util)}</span></span></div><div class="screen-row-sub"><span>${a.description}</span><span>Selected limit ${fmt(a.limit)} ${a.unit}</span></div><div class="screen-track${a.util>1?' exceeded':''}" role="meter" aria-label="${esc(a.name)} utilisation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,a.util*100)}" aria-valuetext="${pc(a.util)} of selected limit"><span style="width:${Math.min(100,a.util*100)}%"></span></div></div>`).join('');
  const exceeded=r.governingUtil>1;
  $('screen-status').textContent=exceeded?'Selected limit exceeded':'Within selected screens';
  $('screen-status').className=`screen-status${exceeded?' exceeded':''}`;
  $('screen-summary').innerHTML=`<span>Governing: <strong>${esc(r.governing)}</strong> · ${pc(r.governingUtil)}</span><span>ΣR − wL = <strong>${fmt(r.equilibriumResidual,3)} kN</strong></span>`;
  $('model-warnings').hidden=!r.warnings.length;
  $('model-warnings').innerHTML=r.warnings.map(s=>`<p>${esc(s)}</p>`).join('');
  const props=[['Area A',`${fmt(r.section.area,0)} mm²`],['Second moment I',`${fmt(r.section.inertia/1e6,3)} × 10⁶ mm⁴`],['Elastic modulus Z',`${fmt(r.section.modulus/1e3,2)} × 10³ mm³`],['First moment Q at NA',`${fmt(r.section.firstMoment/1e3,2)} × 10³ mm³`],['Beam mass',`${fmt(r.massPerMetre)} kg/m`],['Clear web height',`${fmt(r.section.webHeight,1)} mm`],['Deck area (context)',`${fmt(r.deckArea,1)} m²`],['Loaded tributary area',`${fmt(r.tributaryArea,1)} m²`],['Span / depth',`${fmt(p.span*1000/p.depth,1)}`]];
  $('section-properties').innerHTML=props.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function persist() {
  try{localStorage.setItem(storageKey,JSON.stringify({version:MODEL_VERSION,cases}));}
  catch{storageAvailable=false;}
  $('storage-note').textContent=storageAvailable?'Snapshots stay in this browser. Export a copy to keep your study.':'Browser storage is unavailable. Cases stay only in this tab; export a copy.';
}
function restore() {
  try {
    const raw=localStorage.getItem(storageKey);
    if(raw){
      const saved=JSON.parse(raw);
      if(saved.version===MODEL_VERSION && Array.isArray(saved.cases)) cases=saved.cases.filter(c=>c && typeof c.name==='string' && typeof c.id==='string' && c.input && !Object.keys(validate(c.input)).length).slice(0,5).map(c=>({id:c.id,name:c.name.slice(0,48),input:Object.fromEntries([...Object.keys(LIMITS),'includeSelfWeight'].map(k=>[k,c.input[k]])),createdAt:typeof c.createdAt==='string'?c.createdAt:''}));
    }
  }catch{storageAvailable=false;}
  if(!storageAvailable)$('storage-note').textContent='Browser storage is unavailable. Cases stay only in this tab; export a copy.';
}

const compareRows=[
  {group:'INPUTS & ASSUMPTIONS'},
  {label:'Deck L × W (m)',get:(p)=>`${fmt(p.deckLength,1)} × ${fmt(p.deckWidth,1)}`},
  {label:'Support span L (m)',get:p=>fmt(p.span)},
  {label:'Tributary width (m)',get:p=>fmt(p.tributary)},
  {label:'Permanent / variable (kN/m²)',get:p=>`${fmt(p.deadLoad,1)} / ${fmt(p.liveLoad,1)}`},
  {label:'h × bᶠ × tᶠ × tʷ (mm)',get:p=>[p.depth,p.flangeWidth,p.flangeThickness,p.webThickness].map(v=>fmt(v,0)).join(' × ')},
  {label:'fᵧ (MPa) / E (GPa)',get:p=>`${fmt(p.yieldStrength,0)} / ${fmt(p.youngModulus,0)}`},
  {label:'Density (kg/m³)',get:p=>fmt(p.density,0)},
  {label:'Stress γ / deflection L/N',get:p=>`${fmt(p.stressDivisor,1)} / L/${fmt(p.deflectionDivisor,0)}`},
  {label:'Self-weight (kN/m)',get:(p,r)=>`${fmt(r.selfWeight,3)}${p.includeSelfWeight?'':' · off'}`},
  {group:'BEAM RESPONSE'},
  {label:'Total line load (kN/m)',get:(p,r)=>fmt(r.lineLoad)},
  {label:'Rᴀ = Rʙ (kN)',get:(p,r)=>fmt(r.reactionA)},
  {label:'Mₘₐₓ (kN·m)',get:(p,r)=>fmt(r.momentMax)},
  {label:'|V|ₘₐₓ (kN)',get:(p,r)=>fmt(r.shearMax)},
  {label:'σₘₐₓ (MPa)',get:(p,r)=>fmt(r.bendingStress)},
  {label:'τ at NA, max (MPa)',get:(p,r)=>fmt(r.shearStress)},
  {label:'δₘₐₓ (mm)',get:(p,r)=>fmt(r.deflectionMax)},
  {group:'SELECTED SCREENS'},
  {label:'Bending utilisation',get:(p,r)=>pc(r.bendingUtil),util:'bendingUtil'},
  {label:'Shear utilisation',get:(p,r)=>pc(r.shearUtil),util:'shearUtil'},
  {label:'Deflection utilisation',get:(p,r)=>pc(r.deflectionUtil),util:'deflectionUtil'},
  {label:'Governing utilisation',get:(p,r)=>pc(r.governingUtil),util:'governingUtil'},
  {label:'Governing screen',get:(p,r)=>r.governing}
];
function renderComparison() {
  const entries=[];
  if(valid && result)entries.push({id:'current',name:$('case-name').value.trim()||'Current inputs',input,result,current:true});
  entries.push(...cases.map(c=>({...c,result:analyse(c.input),current:false})));
  const empty=!cases.length;
  let header='<thead><tr><th scope="col"><span class="case-kicker">STUDY REGISTER</span><span class="case-title">Inputs & results</span></th>';
  for(const c of entries)header+=`<th scope="col"${c.current?' class="current-cell"':''}><span class="case-kicker">${c.current?'LIVE MODEL':'SAVED SNAPSHOT'}</span><span class="case-title" title="${esc(c.name)}">${esc(c.name)}</span>${c.current?'':'<span class="case-controls"><button type="button" data-load="'+esc(c.id)+'" aria-label="Load '+esc(c.name)+'">Load case</button><button type="button" data-remove="'+esc(c.id)+'" aria-label="Remove '+esc(c.name)+'">×</button></span>'}</th>`;
  if(empty)header+='<th scope="col"><span class="case-kicker">YOUR NEXT ITERATION</span><span class="case-title">Add a comparison case</span></th>';
  header+='</tr></thead><tbody>';
  let emptyAdded=false;
  for(const row of compareRows){
    if(row.group){header+=`<tr class="section-row"><td>${row.group}</td>${entries.map(()=>'<td></td>').join('')}${empty&&!emptyAdded?'<td></td>':''}</tr>`;continue;}
    header+=`<tr><th scope="row">${esc(row.label)}</th>${entries.map(c=>`<td class="${c.current?'current-cell ':''}${row.util&&c.result[row.util]>1?'over-limit':''}">${esc(row.get(c.input,c.result))}</td>`).join('')}`;
    if(empty&&!emptyAdded){const rows=compareRows.filter(r=>!r.group).length;header+=`<td class="empty-case" rowspan="${rows+compareRows.filter(r=>r.group).length-1}">Save the baseline, change one input, then save your next case.<br><br>Try a longer span to see how moment and deflection respond differently.<br><br><strong>Tip:</strong> equal line load + doubled span → 4× moment and 16× deflection.</td>`;emptyAdded=true;}
    header+='</tr>';
  }
  $('comparison-table').innerHTML=header+'</tbody>';
  $('save-case').disabled=!valid||cases.length>=5;
  $('save-case').innerHTML=cases.length>=5?'Five cases saved':'Save current case <span aria-hidden="true">+</span>';
  if(cases.length && valid && result){
    const base=cases[0],br=analyse(base.input);
    const delta=(now,was)=>was===0?(now===0?'unchanged':'from a zero baseline'):`${now>=was?'+':''}${fmt((now/was-1)*100,1)}%`;
    $('compare-insight').innerHTML=`Relative to <strong>${esc(base.name)}</strong>: current moment <strong>${delta(result.momentMax,br.momentMax)}</strong>, deflection <strong>${delta(result.deflectionMax,br.deflectionMax)}</strong>. Compare the load, section and screening criteria together; each saved case retains its own inputs.`;
  }else $('compare-insight').textContent=cases.length?'Current model is invalid. Saved cases remain available to load or export.':'A longer span raises moment with L² and elastic deflection with L⁴ when line load and section stiffness are unchanged.';
  $('export-csv').disabled=!valid&&!cases.length;
}

function saveCase(){
  if(!valid||!result||cases.length>=5)return;
  const name=$('case-name').value.trim()||`Case ${cases.length+1}`;
  const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  cases.push({id,name:name.slice(0,48),input:{...input},createdAt:new Date().toISOString()});
  persist();renderComparison();
  notify(storageAvailable?`Saved “${name}”.`:`Saved “${name}” in this tab. Export to keep it.`);
}
function download(content,mime,filename){
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportCSV(){
  const entries=cases.map(c=>({...c,result:analyse(c.input)}));
  if(valid&&result)entries.unshift({name:$('case-name').value.trim()||'Current model',input,result,createdAt:new Date().toISOString()});
  if(!entries.length)return;
  const inputKeys=[...Object.keys(LIMITS),'includeSelfWeight'];
  const results=[['line_load_kN_per_m','lineLoad'],['self_weight_kN_per_m','selfWeight'],['reaction_A_kN','reactionA'],['reaction_B_kN','reactionB'],['maximum_moment_kNm','momentMax'],['maximum_abs_shear_kN','shearMax'],['bending_stress_MPa','bendingStress'],['web_shear_stress_MPa','shearStress'],['maximum_deflection_mm','deflectionMax'],['bending_limit_MPa','bendingLimit'],['shear_limit_MPa','shearLimit'],['deflection_limit_mm','deflectionLimit'],['bending_utilisation_ratio','bendingUtil'],['shear_utilisation_ratio','shearUtil'],['deflection_utilisation_ratio','deflectionUtil'],['governing_utilisation_ratio','governingUtil']];
  // Quote CSV cells; neutralise spreadsheet formulas in user-supplied text.
  const cell=v=>{let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const inputColumns={deckLength:'deck_length_m',deckWidth:'deck_width_m',span:'support_span_m',tributary:'tributary_width_m',deadLoad:'permanent_area_load_kN_per_m2',liveLoad:'variable_area_load_kN_per_m2',depth:'section_depth_mm',flangeWidth:'flange_width_mm',flangeThickness:'flange_thickness_mm',webThickness:'web_thickness_mm',yieldStrength:'yield_strength_MPa',youngModulus:'young_modulus_GPa',density:'density_kg_per_m3',stressDivisor:'stress_screen_divisor_gamma',deflectionDivisor:'deflection_divisor_N',includeSelfWeight:'include_beam_self_weight_boolean'};
  const columns=['case_name','model_version','snapshot_time_UTC',...inputKeys.map(k=>inputColumns[k]),...results.map(a=>a[0]),'area_mm2','inertia_mm4','elastic_section_modulus_mm3','first_moment_Q_mm3','assumption_note'];
  const rows=entries.map(c=>[c.name,MODEL_VERSION,c.createdAt,...inputKeys.map(k=>c.input[k]),...results.map(([,key])=>c.result[key]),c.result.section.area,c.result.section.inertia,c.result.section.modulus,c.result.section.firstMoment,'Unfactored UDL; simply supported elastic beam; illustrative screens; no code compliance assessment.']);
  download('\uFEFF'+[columns,...rows].map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8','topside-deck-study.csv');
  notify('Exported current inputs and saved cases as CSV.');
}

function setPlot(next,focus=false){
  plot=next;
  document.querySelectorAll('[data-plot]').forEach(b=>{const active=b.dataset.plot===plot;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;if(active&&focus)b.focus();});
  $('plot-panel').setAttribute('aria-labelledby',`tab-${plot}`);
  renderPlot();
}
$('input-form').addEventListener('submit',e=>e.preventDefault());
$('input-form').addEventListener('input',()=>{$('preset').value='custom';update();});
$('reset').addEventListener('click',()=>{fillForm(DEFAULTS);$('preset').value='baseline';$('case-name').value='Deck bay baseline';$('position').value=500;update();notify('Model reset to the deck bay baseline.');});
$('preset').addEventListener('change',()=>{
  const preset=$('preset').value;
  const choices={baseline:{name:'Deck bay baseline',patch:{}},long:{name:'Longer span · 8 m',patch:{span:8}},heavy:{name:'Variable load · 10 kN/m²',patch:{liveLoad:10}},benchmark:{name:'Hand-check · 20 kN/m',patch:{deadLoad:10,liveLoad:0,includeSelfWeight:false}}};
  if(!choices[preset])return;
  fillForm({...DEFAULTS,...choices[preset].patch});$('case-name').value=choices[preset].name;$('position').value=500;update();
});
$('position').addEventListener('input',renderPlot);
document.querySelectorAll('[data-plot]').forEach(b=>{
  b.addEventListener('click',()=>setPlot(b.dataset.plot));
  b.addEventListener('keydown',e=>{const choices=['moment','shear','deflection'];let index=choices.indexOf(plot);if(e.key==='ArrowRight')index=(index+1)%3;else if(e.key==='ArrowLeft')index=(index+2)%3;else if(e.key==='Home')index=0;else if(e.key==='End')index=2;else return;e.preventDefault();setPlot(choices[index],true);});
});
$('response-plot').addEventListener('click',e=>{
  const svg=$('response-plot').querySelector('svg');if(!svg||!valid)return;
  const box=svg.getBoundingClientRect();if(!box.width)return;
  const logical=(e.clientX-box.left)*780/box.width;
  $('position').value=Math.round(Math.max(0,Math.min(1,(logical-58)/693))*1000);renderPlot();
});
$('case-name').addEventListener('input',renderComparison);
$('case-name').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveCase();}});
$('save-case').addEventListener('click',saveCase);
$('comparison-table').addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.load){const c=cases.find(c=>c.id===button.dataset.load);if(!c)return;fillForm(c.input);$('case-name').value=c.name;$('preset').value='custom';$('position').value=500;update();notify(`Loaded “${c.name}”.`);$('workspace').scrollIntoView({behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  if(button.dataset.remove){cases=cases.filter(c=>c.id!==button.dataset.remove);persist();renderComparison();notify('Saved case removed.');}
});
$('export-csv').addEventListener('click',exportCSV);
$('print-study').addEventListener('click',()=>{if(valid)window.print();});
const checks=runVerification(),passed=checks.filter(c=>c.passed).length;
$('verification-status').textContent=`${passed} / ${checks.length} checks passed`;
if(passed!==checks.length)$('verification-status').classList.add('failed');
$('verification-results').innerHTML=checks.map(c=>`<div class="verification-result"><span>${esc(c.name)}</span><strong>${c.passed?'PASS':'FAIL'}</strong></div>`).join('');
restore();update();
