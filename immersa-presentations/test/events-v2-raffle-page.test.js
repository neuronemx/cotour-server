const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createView } = require('../public/events-v2/raffle-page');
const html = fs.readFileSync(require.resolve('../events-v2/console.html'), 'utf8');
function harness(kind = 'PARTICIPANT') {
  class Element {
    constructor(tag = '') { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ''; this.open = false; }
    set innerHTML(_) { throw new Error('Unsafe HTML'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; if (this.tagName === 'SELECT') this.value = ''; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(key, fn) { this.handlers[key] = fn; }
    fire(key) { this.handlers[key]?.(); }
    showModal() { this.open = true; } close() { this.open = false; }
  }
  const e = Object.fromEntries([...html.matchAll(/<(\w+)[^>]*id="(raffle-[^"]+)"/g)].map(m => [m[2], new Element(m[1].toUpperCase())]));
  const sent=[],timers=new Map();let seq=0,time=0,reads=0;
  let state={status:'ready',kind,pending:false,code:null,snapshot:{revision:1,raffleRunId:'run',displayName:'Saved name',available:[{id:'one',title:'One',mode:'free'},{id:'two',title:'<script>Two</script>',mode:'visual_key',keyOptions:[{id:'a',label:'A'},{id:'b',label:'B'}]}],active:{id:'run',mode:'free',title:'Free',prompt:'<img>Join',state:'collecting',ticketDigits:2,options:[],ownEntry:null,ownSelection:null}}};
  const controller={getState:()=>state,operate:(action,input)=>sent.push({action,input}),refresh:()=>reads++,availableActions:()=>kind==='PARTICIPANT'?[]:['close_entries','close','reset_winners']};
  const document={getElementById:id=>e[id],createElement:tag=>new Element(tag.toUpperCase())};
  const view=createView({document,controller,now:()=>time,setTimeoutFn:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeoutFn:id=>timers.delete(id)});
  return {e,sent,timers,reads:()=>reads,run:()=>state.snapshot.active,render(extra){state={...state,...extra};view.render(state);},tick(ms){time+=ms;const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1].fn();}}};
}
test('public raffle name edits survive updates; participation and ticket are explicit and canonical',()=>{const h=harness(),e=h.e;assert.equal(e['raffle-name'].value,'Saved name');e['raffle-name'].value='Correction';h.render({pending:true});h.render({pending:false});assert.equal(e['raffle-name'].value,'Correction');e['raffle-enter'].fire('click');assert.deepEqual(h.sent.at(-1),{action:'enter',input:{name:'Correction'}});assert.equal(e['raffle-receipt'].textContent,'');h.render({snapshot:{revision:2,raffleRunId:'run',active:{...h.run(),ownEntry:{ticketNumber:7,name:'Correction'}}}});assert.match(e['raffle-receipt'].textContent,/07/);assert.match(e['raffle-receipt'].textContent,/Mucha suerte/);assert.equal(e['raffle-registration'].hidden,true);});
test('visual selections retain button nodes and reflect only confirmed choice; closed wrong selections do not invent a ticket',()=>{const h=harness(),e=h.e;h.render({snapshot:{raffleRunId:'run',active:{...h.run(),mode:'visual_key',options:[{id:'a',label:'<script>A</script>'},{id:'b',label:'B'}]}}});const button=e['raffle-options'].children[0];assert.equal(button.textContent,'<script>A</script>');button.fire('click');h.render({snapshot:{raffleRunId:'run',active:{...h.run(),ownSelection:{selectedOptionId:'a'}}}});assert.equal(e['raffle-options'].children[0],button);assert.equal(button['aria-pressed'],'true');h.render({snapshot:{raffleRunId:'run',active:{...h.run(),state:'entries_closed',options:[]}}});assert.match(e['raffle-receipt'].textContent,/no participa/);assert.equal(e['raffle-options'].children.length,0);});
test('catalog/key selection survives select resets and confirmation is retired when revision or run changes',()=>{const h=harness('STAGE'),e=h.e;e['raffle-catalog'].value='two';h.render({snapshot:{revision:3,raffleRunId:'run',available:[{id:'one',title:'One',mode:'free'},{id:'two',title:'Two',mode:'visual_key',keyOptions:[{id:'a',label:'A'},{id:'b',label:'B'}]}],active:null}});assert.equal(e['raffle-catalog'].value,'two');e['raffle-key'].value='b';e['raffle-configure-key'].fire('click');assert.deepEqual(h.sent.at(-1),{action:'configure_key',input:{definitionId:'two',optionId:'b',expectedRevision:3}});e['raffle-reset_winners'].fire('click');assert.equal(e['raffle-confirm-dialog'].open,true);h.render({snapshot:{revision:4,raffleRunId:'run',available:[],active:null}});e['raffle-confirm'].fire('click');assert.equal(h.sent.length,1);e['raffle-reset_winners'].fire('click');e['raffle-confirm'].fire('click');assert.equal(h.sent.at(-1).action,'reset_winners');});
test('drawing clock requests authorized reads only and loss of authority clears timers, output and dialogs',()=>{const h=harness('PLAYER'),e=h.e;h.render({snapshot:{raffleRunId:'run',active:{...h.run(),state:'drawing',countdownRemainingMs:5000}}});assert.equal(e['raffle-clock'].textContent,'5 s');h.tick(5001);h.tick(1001);assert.equal(h.reads(),1);assert.equal(h.sent.length,0);h.render({status:'waiting',snapshot:null});assert.equal(h.timers.size,0);assert.equal(e['raffle-panel'].hidden,true);assert.equal(e['raffle-winner'].textContent,'');});
test('Player shows literal revealed winner; Público only sees its own winning status and no other name',()=>{const player=harness('PLAYER');player.render({snapshot:{raffleRunId:'run',active:{...player.run(),state:'winner',winner:{name:'<script>Winner</script>',ticketNumber:2}}}});assert.equal(player.e['raffle-winner'].textContent,'<script>Winner</script> · 02');const h=harness();h.render({snapshot:{raffleRunId:'run',active:{...h.run(),state:'winner',isWinner:true}}});assert.equal(h.e['raffle-winner'].textContent,'Ganaste');});

test('visual raffle image cards, key preview and Player output use scoped URLs',()=>{
 const crypto=require('node:crypto'),u=()=>crypto.randomUUID(),url=`/api/events-v2/live/${u()}/${u()}/${u()}/interaction-images/raffle/${u()}/${u()}`,image={url,width:80,height:80};
 const h=harness();h.render({snapshot:{raffleRunId:'run',active:{...h.run(),mode:'visual_key',options:[{id:'a',label:'A',image},{id:'b',label:'B'}]}}});assert.equal(h.e['raffle-options'].children[0].children[0].src,url);
 const p=harness('PLAYER');p.render({snapshot:{active:{...p.run(),displayOption:{id:'a',label:'A',image}}}});assert.equal(p.e['raffle-display-image'].children[0].src,url);p.render({status:'waiting',snapshot:null});assert.equal(p.e['raffle-display-image'].hidden,true);
 const stage=harness('STAGE');stage.render({snapshot:{available:[{id:'one',title:'Visual',mode:'visual_key',keyOptions:[{id:'a',label:'A',image}]}],active:null}});assert.equal(stage.e['raffle-key-image'].children[0].src,url);
});
