// A deliberately limited DOM/event harness for application logic tests.
// This is not a browser, CSS layout engine, or substitute for visual browser QA.
import {readFileSync} from 'node:fs';
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const decode=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");

class Element {
  constructor(tag,document){this.tagName=tag.toLowerCase();this.document=document;this.children=[];this.parent=null;this.attributes={};this.listeners={};this.dataset={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.open=false;this._text='';this._html='';this.tabIndex=0;this.className='';this.classList={add:(s)=>{this.className+=' '+s;}};}
  setAttribute(k,v){v=String(v);this.attributes[k]=v;if(k==='id')this.document.ids.set(v,this);if(k==='value')this.value=v;if(k==='class')this.className=v;if(k==='hidden')this.hidden=true;if(k==='disabled')this.disabled=true;if(k==='checked')this.checked=true;if(k==='open')this.open=true;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
  getAttribute(k){return this.attributes[k]??null;}
  get value(){return this._value??'';}
  set value(v){this._value=String(v);}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(s){this.children=[];this._html='';this._text=String(s);}
  get innerHTML(){return this._html;}
  set innerHTML(s){this._html=String(s);this._text='';this.children=[];parse(this._html,this,this.document);}
  append(child){child.parent=this;this.children.push(child);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  dispatch(type,extra={}){const event={type,target:this,key:'',preventDefault(){},...extra};for(let el=this;el;el=el.parent)for(const fn of el.listeners[type]||[])fn(event);}
  click(){this.dispatch('click');}
  closest(selector){for(let el=this;el;el=el.parent)if(matches(el,selector))return el;return null;}
  querySelectorAll(selector){const found=[];const visit=el=>{for(const c of el.children){if(matches(c,selector))found.push(c);visit(c);}};visit(this);return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  focus(){this.document.activeElement=this;}
  scrollIntoView(){this.document.scrolled=this;}
  getBoundingClientRect(){return {left:0,top:0,width:780,height:237};}
}
function matches(el,selector){if(selector.startsWith('['))return Object.hasOwn(el.attributes,selector.slice(1,-1));return el.tagName===selector.toLowerCase();}
function parse(html,parent,document){
  const stack=[parent];
  for(const token of html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g)){
    const t=token[0];if(t.startsWith('<!'))continue;
    if(t.startsWith('</')){const tag=t.slice(2).match(/^\w+/)?.[0]?.toLowerCase();for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}
    if(t.startsWith('<')){const tag=t.match(/^<([\w-]+)/)[1].toLowerCase();const el=new Element(tag,document);const attrs=t.slice(tag.length+1,-1);for(const a of attrs.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))el.setAttribute(a[1],decode(a[2]??a[3]??a[4]??''));stack.at(-1).append(el);if(!voids.has(tag)&&!t.endsWith('/>'))stack.push(el);}
    else stack.at(-1)._text+=decode(t);
  }
}
export function setupDOM(initialStorage={}){
  const document={ids:new Map(),activeElement:null,scrolled:null,getElementById(id){return this.ids.get(id)??null;},createElement(tag){return new Element(tag,this);},querySelectorAll(s){return this.root.querySelectorAll(s);}};
  document.root=new Element('root',document);
  parse(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),document.root,document);
  document.body=document.root.querySelector('body');
  const data=new Map(Object.entries(initialStorage));
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),data};
  const downloads=[];globalThis.document=document;globalThis.localStorage=storage;
  globalThis.window={print:()=>{document.printed=true;}};
  globalThis.matchMedia=()=>({matches:false});
  URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test-download';};URL.revokeObjectURL=()=>{};
  const nativeTimer=globalThis.setTimeout;
  if(!globalThis.__domHarnessTimer){globalThis.setTimeout=(...args)=>{const t=nativeTimer(...args);t.unref?.();return t;};globalThis.__domHarnessTimer=true;}
  return {document,storage,downloads};
}
