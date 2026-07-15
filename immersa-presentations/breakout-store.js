const DEFAULT_DURATION_MS=60000;
const INPUT_WINDOW_MS=100;
const SPEED_STEP_PER_SECOND=.01;
const MAX_SPEED_MULTIPLIER=1.6;
const CONTROL_ROLES=new Set(['presenter','stage']);
const ACTIVE_STATUSES=new Set(['ready','running','paused']);
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function createGameId(nowMs=Date.now()){return'breakout_'+nowMs.toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function createBlocks(columns=7,rows=4){const blocks=[],gap=.012,marginX=.07,top=.09,w=(1-marginX*2-gap*(columns-1))/columns,h=.055;for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)blocks.push({id:`b_${row}_${column}`,x:marginX+column*(w+gap),y:top+row*(h+gap),width:w,height:h,active:true});return blocks;}
function createInitialState(nowMs,durationMs=DEFAULT_DURATION_MS){return{id:createGameId(nowMs),type:'breakout',status:'idle',duration_ms:durationMs,started_at_ms:null,ends_at_ms:null,remaining_ms:durationMs,score:0,misses:0,paddle:{x:.5,width:.22,speed:0},ball:{x:.5,y:.72,vx:.22,vy:-.3,radius:.016},blocks:createBlocks(),input:{left:0,right:0,window_started_at_ms:nowMs},last_input