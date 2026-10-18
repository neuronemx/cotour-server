(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventInteractionImages=factory();})(typeof window==='object'?window:this,function(){
 'use strict';const cache=new WeakMap();
 const uuid='[a-f0-9-]{36}',safe=new RegExp('^/api/events-v2/live/'+uuid+'/'+uuid+'/'+uuid+'/interaction-images/(knowledge|raffle)/('+uuid+'|catalog)/'+uuid+'$');
 function valid(image){return image&&typeof image.url==='string'&&safe.test(image.url)&&['width','height'].every(k=>Number.isSafeInteger(image[k])&&image[k]>0&&image[k]<=4096);}
 function scoped(image,context,liveId,kind,runId){
  if(!valid(image)||!context||!new RegExp('^'+uuid+'$').test(runId)&&runId!=='catalog')return null;
  const prefix='/api/events-v2/live/'+context.eventId+'/'+liveId+'/'+context.grantId+'/interaction-images/'+kind+'/'+runId+'/';
  if(!image.url.startsWith(prefix)||!new RegExp('^'+uuid+'$').test(image.url.slice(prefix.length)))return null;
  return Object.freeze({url:image.url,width:image.width,height:image.height});
 }
 function append(document,parent,image){if(!valid(image))return null;const img=document.createElement('img');img.src=image.url;img.alt='';img.width=image.width;img.height=image.height;img.decoding='async';img.referrerPolicy='no-referrer';img.className='interaction-image';parent.append(img);return img;}
 function render(document,parent,image){
  if(!valid(image)){parent.replaceChildren();parent.hidden=true;cache.delete(parent);return;}
  if(cache.get(parent)?.url===image.url){parent.hidden=false;return;}
  parent.replaceChildren();const img=append(document,parent,image);parent.hidden=false;cache.set(parent,{url:image.url,img});
  img.addEventListener('error',()=>{if(cache.get(parent)?.img===img){parent.replaceChildren();parent.hidden=true;cache.delete(parent);}});
 }
 return Object.freeze({valid,scoped,append,render});
});
