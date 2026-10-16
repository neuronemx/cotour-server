const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createView}=require('../public/events-v2/game-time-page');
const html=fs.readFileSync(require.resolve('../events-v2/console.html'),'utf8');
function harness(kind='STAGE'){
 class Element{constructor(tag=''){this.tagName=tag;this.children=[];this.handlers={};this.value='';this.open=false;this.draws=[];}set innerHTML(_){throw new Error('Unsafe HTML');}append(...xs){this.children.push(...xs);}replaceChildren(){this.children=[];}setAttribute(k,v){this[k]=v;}addEventListener(k,f){(this.handlers[k]||=[]).push(f);}fire(k,e={}){for(const f of this.handlers[k]||[])f(e);}showModal(){this.open=true;}close(){this.open=false;}getContext(){return{clearRect:()=>this.draws.push('clear'),fillRect:()=>this.draws.push('rect'),beginPath(){},ellipse:()=>this.draws.push('ball'),fill(){}};}}
 const e=Object.fromEntries([...html.matchAll(/<(\w+)[^>]*id="((?:game|time)-[^"]+)"/g)].map(m=>[m[2],new Element(m[1].toUpperCase())]));e['time-mode'].value='stopwatch';e['time-hours'].value='0';e['time-minutes'].value='5';e['time-seconds'].value='0';
 const document=new Element();document.getElementById=k=>e[k];document.createElement=tag=>new Element(tag.toUpperCase());document.visibilityState='visible';
 let now=1000,seq=0,reads=0;const timers=new Map(),sent=[];
 const queue={status:'idle',selected:[],catalog:[{id:'breakout',title:'<img>',mode:'Colaborativo',available:true},{id:'pong',title:'Pong',mode:'Competitivo',available:true}],locked:false};
 let gs={status:'ready',kind,pending:false,code:null,snapshot:{revision:0,queueRunId:null,game:null,queue}},ts={status:'ready',kind,pending:false,code:null,snapshot:{revision:0,timeRunId:null,serverNow:100000,screen:kind==='PARTICIPANT'?null:{visible:false,running:false,mode:null,elapsedMs:0,remainingMs:0,durationMs:0},...(['STAGE','SPEAKER'].includes(kind)?{speaker:{running:false,elapsedMs:0}}:{})}};
 const game={getState:()=>gs,availableActions:()=>gs.status!=='ready'?[]:kind==='PARTICIPANT'?gs.snapshot.game?['input','join_team']:[]:gs.snapshot.game?['start','pause','resume','skip','end','team_names']:['configure','start_queue'],refresh:()=>{reads++;},operate:(action,input)=>{sent.push({family:'game',action,input});}};
 const time={getState:()=>ts,availableActions:()=>['screen:start','screen:stop','screen:resume','screen:reset','screen:hide','speaker:start','speaker:stop','speaker:reset'],refresh:()=>{reads++;},operate:(action,input)=>{sent.push({family:'time',action,input});}};
 const view=createView({document,game,time,now:()=>now,setTimeoutFn:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeoutFn:id=>timers.delete(id)});
 const g={id:'one',type:'breakout',status:'running',score:100,remaining_ms:1000,paddle:{x:.5,width:.2},ball:{x:.5,y:.5,radius:.01},blocks:[{active:true,x:.1,y:.1,width:.1,height:.05}],countdown_remaining_ms:0};
 return{e,document,sent,timers,reads:()=>reads,game:g,gs:()=>gs,ts:()=>ts,renderGame(value){gs=value;view.renderGame(gs);},renderTime(value){ts=value;view.renderTime(ts);},advance(ms){now+=ms;const pending=[...timers.values()];timers.clear();for(const f of pending)f();}};
}
test('catalog and team-name nodes survive physics frames and preserve typed corrections; all text remains literal',()=>{
 const h=harness();const first=h.e['game-catalog'].children[0];assert.equal(first.children[1].textContent,'<img> · Colaborativo');first.children[0].checked=true;first.children[0].fire('change');assert.deepEqual(h.sent.at(-1).input.selected,['breakout']);
 const g={...h.game,type:'pong',status:'ready',teams:{left:{name:'Blue',score:0},right:{name:'Red',score:0}}};h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,queueRunId:'queue',game:g}});h.e['game-name-left'].value='Corrected';h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,revision:3,game:{...g}}});assert.equal(h.e['game-name-left'].value,'Corrected');assert.equal(h.e['game-catalog'].children[0],first);h.e['game-save-names'].fire('click');assert.equal(h.sent.at(-1).input.left,'Corrected');
 h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,game:null}});assert.equal(h.e['game-name-left'].value,'');
});
test('game confirmation survives a physics-only revision and retires on run/state change or access loss',()=>{
 const h=harness();h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,queueRunId:'queue',game:h.game}});h.e['game-end'].fire('click');assert.equal(h.e['game-time-confirm-dialog'].open,true);
 h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,revision:3,game:{...h.game,ball:{x:.6,y:.4,radius:.01}}}});assert.equal(h.e['game-time-confirm-dialog'].open,true);h.e['game-time-confirm'].fire('click');assert.equal(h.sent.at(-1).action,'end');
 h.e['game-end'].fire('click');h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,game:{...h.game,id:'two'}}});assert.equal(h.e['game-time-confirm-dialog'].open,false);const n=h.sent.length;h.e['game-time-confirm'].fire('click');assert.equal(h.sent.length,n);
 h.e['game-end'].fire('click');h.renderGame({status:'waiting',kind:null,snapshot:null,pending:false});assert.equal(h.e['game-time-confirm-dialog'].open,false);assert.equal(h.timers.size,0);
});
test('Público holds explicit directional input only for its current game; pointer cancellation, hidden page and revoke stop timers',()=>{
 const h=harness('PARTICIPANT');h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,game:h.game}});let prevented=0;h.e['game-input-left'].fire('pointerdown',{preventDefault(){prevented++;}});assert.equal(h.sent.at(-1).input.direction,'left');h.advance(90);assert.equal(h.sent.length,2);assert.equal(prevented,1);
 h.e['game-input-left'].fire('pointercancel');h.advance(100);assert.equal(h.sent.length,2);
 h.e['game-input-right'].fire('keydown',{key:'Enter',repeat:false,preventDefault(){}});h.document.visibilityState='hidden';h.document.fire('visibilitychange');h.advance(100);assert.equal(h.sent.length,3);
 h.e['game-input-left'].fire('pointerdown');h.renderGame({status:'waiting',kind:null,snapshot:null,pending:false});h.advance(100);assert.equal(h.sent.length,4);assert.equal(h.timers.size,0);
});
test('Player draws canonical geometry and clears it on loss; Público never draws a board',()=>{
 const h=harness('PLAYER');h.renderGame({...h.gs(),snapshot:{...h.gs().snapshot,game:h.game}});assert.equal(h.e['game-board'].hidden,false);assert.ok(h.e['game-board'].draws.includes('ball'));h.renderGame({status:'waiting',kind:null,snapshot:null,pending:false});assert.equal(h.e['game-board'].hidden,true);assert.equal(h.e['game-score'].textContent,'');
 const p=harness('PARTICIPANT');p.renderGame({...p.gs(),snapshot:{...p.gs().snapshot,game:p.game}});assert.equal(p.e['game-board'].hidden,true);assert.equal(p.e['game-board'].draws.includes('ball'),false);
});
test('Time advances from server-relative readings without sending commands, resets no clock on form changes and clears timers on denial',()=>{
 const h=harness('SPEAKER');h.renderTime({...h.ts(),snapshot:{...h.ts().snapshot,timeRunId:'time',screen:{visible:true,mode:'countdown',running:true,remainingMs:2000,durationMs:2000,elapsedMs:0},speaker:{running:true,elapsedMs:1000}}});h.advance(1000);assert.equal(h.e['time-screen-output'].textContent,'00:00:01');assert.equal(h.e['time-speaker-output'].textContent,'00:00:02');
 h.e['time-mode'].value='clock';h.e['time-mode'].fire('change');assert.equal(h.e['time-speaker-output'].textContent,'00:00:02');h.advance(1100);assert.equal(h.reads(),1);assert.equal(h.sent.length,0);
 h.e['time-screen-reset'].fire('click');assert.equal(h.e['game-time-confirm-dialog'].open,true);h.renderTime({...h.ts(),snapshot:{...h.ts().snapshot,revision:2}});assert.equal(h.e['game-time-confirm-dialog'].open,false);
 h.renderTime({status:'waiting',kind:null,snapshot:null,pending:false});assert.equal(h.e['time-screen-output'].textContent,'');assert.equal(h.e['time-speaker-output'].textContent,'');assert.equal(h.timers.size,0);
 const p=harness('PARTICIPANT');assert.equal(p.e['time-panel'].hidden,true);
});
