const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/audience/speaker-profile.js'),'utf8');
class Node {
  constructor(){this.listeners={};this.attrs={};this.children=[];this.dataset={};this.hidden=false;this.scrollLeft=0;this.scrollTop=0;this.offsetLeft=0;this.textContent='';const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,v)=>{if(v)classes.add(x);else classes.delete(x);}};}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);}
  dispatch(k,data={}){for(const fn of this.listeners[k] || [])fn(data);}
  querySelector(){return this.child ||= new Node();}
  appendChild(n){this.children.push(n);return n;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;nodes.forEach((n,i)=>{n.offsetLeft=i*300;});}
  focus(){this.focused=true;}
  scrollTo({left}){this.scrollLeft=left;this.dispatch('scroll');}
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(fetcher){
  const ids=Object.fromEntries([...source.matchAll(/getElementById\("([^"]+)"\)/g)].map(m=>[m[1],new Node()]));
  const document=new Node();document.getElementById=id=>ids[id];document.createElement=()=>new Node();document.hidden=false;
  const window=new Node();window.location={search:'?deck=deck-a',reload:()=>assert.fail('No presentation reload allowed')};window.matchMedia=()=>({matches:true});
  const rendered=[];window.ImmersaSpeakerCards={createCard:(_doc,profile)=>{rendered.push(profile.id);const n=new Node();n.dataset.profileId=profile.id;return n;}};
  const socket=new Node();socket.on=socket.addEventListener;const fetches=[];const timer=[];
  const presentation={name:'Arturo',slide:5,answer:'A',socketId:'same-connection'};
  vm.runInNewContext(source,{window,document,socket,URL,URLSearchParams,fetch:async url=>{fetches.push(url);return {ok:true,json:()=>fetcher()};},requestAnimationFrame:fn=>fn(),setInterval:fn=>timer.push(fn)});
  return {ids,window,document,socket,rendered,fetches,timer,presentation};
}
const multi=(revision,ids)=>({mode:'multiple',revision,available:!!ids.length,profiles:ids.map(id=>({id,displayName:id}))});
test('Público updates active cards and order through its existing socket without resetting the presentation',async()=>{
  let data=multi(1,['Ana','Luis']);const f=fixture(()=>data);await settle();
  assert.deepEqual(f.rendered,['Ana','Luis']);assert.equal(f.ids.speakerProfileLauncher.hidden,false);
  f.ids.speakerProfileTab.dispatch('click');assert.equal(f.ids.speakerProfilePanel.inert,false);
  data=multi(2,['Luis','Ana','Rosa']);f.socket.dispatch('speaker-profiles:changed',{deckId:'deck-a',revision:2});await settle();
  assert.deepEqual(f.rendered.slice(-3),['Luis','Ana','Rosa']);
  assert.equal(f.ids.speakerProfileLauncher.classList.contains('is-active'),true);
  assert.deepEqual(f.presentation,{name:'Arturo',slide:5,answer:'A',socketId:'same-connection'});
  const count=f.fetches.length;f.socket.dispatch('speaker-profiles:changed',{deckId:'deck-b'});await settle();assert.equal(f.fetches.length,count);
});
test('All-off hides and closes the launcher; turning a profile back on and reconnecting restores it',async()=>{
  let data=multi(1,['Ana']);const f=fixture(()=>data);await settle();f.ids.speakerProfileTab.dispatch('click');
  data=multi(2,[]);f.socket.dispatch('speaker-profiles:changed',{deckId:'deck-a'});await settle();
  assert.equal(f.ids.speakerProfileLauncher.hidden,true);assert.equal(f.ids.speakerProfilePanel.inert,true);
  assert.equal(f.ids.speakerProfileLauncher.classList.contains('is-active'),false);
  data=multi(3,['Rosa']);f.socket.dispatch('connect');await settle();
  assert.equal(f.ids.speakerProfileLauncher.hidden,false);assert.equal(f.rendered.at(-1),'Rosa');
  assert.equal(f.ids.speakerProfileName.textContent,'');
});
test('Unchanged reconciliation preserves cards and vertical reading position',async()=>{
  const f=fixture(()=>multi(1,['Ana','Luis']));await settle();const count=f.rendered.length;
  f.timer[0]();await settle();assert.equal(f.rendered.length,count);
  f.document.dispatch('visibilitychange');await settle();assert.equal(f.rendered.length,count);
});
test('A stale in-flight response cannot redisplay a profile turned off by a newer notification',async()=>{
  let resolve, calls=0;
  const first=new Promise(r=>{resolve=r;});
  const f=fixture(()=>++calls===1 ? first : multi(2,[]));await settle();
  f.socket.dispatch('speaker-profiles:changed',{deckId:'deck-a',revision:2});
  resolve(multi(1,['Stale']));await settle();
  assert.equal(f.rendered.includes('Stale'),false);assert.equal(f.ids.speakerProfileLauncher.hidden,true);assert.equal(calls,2);
});
test('Decks without multiple-profile mode keep the personal profile and its original title',async()=>{
  const f=fixture(()=>({available:true,profile:{displayName:'Personal',publicTitle:'Ponente'}}));await settle();
  assert.equal(f.ids.speakerProfileName.textContent,'Personal');assert.equal(f.ids.speakerProfileTab.querySelector('span').textContent,'Ponente');
  assert.equal(f.ids.speakerProfileLauncher.classList.contains('is-multiple'),false);
});
