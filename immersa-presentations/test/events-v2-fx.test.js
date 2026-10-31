const test=require('node:test'),assert=require('node:assert/strict');
const {parseCue,normalizeCue,isFx,createCueMonitor}=require('../public/events-v2/av-fx');
test('Event FX uses the approved seconds:frames TXT and rational frame rates, with no luminance processing or local-source fallback',()=>{
 assert.deepEqual(parseCue('\uFEFF03:15\r\nFPS=30'),{timecode:'03:15',fps:30,seconds:3.5});const cue=parseCue('03:15\nFPS=30000/1001');assert.equal(cue.seconds,3+15/(30000/1001));
 for(const txt of ['03:15','03:30\nFPS=30','03:15\nFPS=0','03:15\nFPS=999','03:15\nFPS=30\nextra','86400:00\nFPS=30'])assert.throws(()=>parseCue(txt));assert.equal(normalizeCue({timecode:'03:15',fps:30}).seconds,3.5);const resource={type:'video',category:'fx',source:'event',fx:cue};assert.equal(isFx(resource),true);assert.equal(isFx({...resource,source:'local'}),false);
});
test('Decoded frame monitoring ignores seeking and obsolete playback, and retries a cue skipped while the transport is busy',()=>{
 const callbacks=new Map(),handlers={},sent=[];let sequence=0,state={resource:{id:'fx',type:'video',category:'fx',source:'event',fx:{timecode:'00:01',fps:10,seconds:.1}},status:'playing',fxPlayback:{id:'one',consumed:false}},busy=true;
 const media={dataset:{resourceId:'fx',fxPlaybackId:'one'},paused:false,seeking:false,ended:false,addEventListener:(n,f)=>handlers[n]=f,requestVideoFrameCallback:fn=>{const id=++sequence;callbacks.set(id,fn);return id;},cancelVideoFrameCallback:id=>callbacks.delete(id)};
 const monitor=createCueMonitor({media,getPlayback:()=>state,onCue:p=>{if(busy)return false;sent.push(p);return true;}});monitor.refresh();const frame=[...callbacks.values()][0];callbacks.clear();frame(0,{mediaTime:.2});assert.equal(sent.length,0);busy=false;const next=[...callbacks.values()][0];callbacks.clear();next(0,{mediaTime:.2});assert.equal(sent.length,1);monitor.observe(.3);assert.equal(sent.length,1);state={...state,fxPlayback:{id:'two',consumed:false}};media.dataset.fxPlaybackId='two';media.seeking=true;monitor.observe(.3);assert.equal(sent.length,1);media.seeking=false;monitor.observe(.3);assert.equal(sent.length,2);monitor.stop();assert.equal(callbacks.size,0);
});
