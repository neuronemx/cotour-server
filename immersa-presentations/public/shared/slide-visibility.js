(function(root){
  let attempts=0;
  function boot(){
    const path=root.location?.pathname||'';
    const role=/^\/(?:speaker|presenter)(?:\/|$)/.test(path)?'presenter':/^\/stage(?:\/|$)/.test(path)?'stage':'';
    if(!role)return;
    const live=typeof socket!=='undefined'?socket:root.socket;
    if(!live||!document.getElementById(role==='presenter'?'prev':'prevSlide')){
      if(attempts++<80)return root.setTimeout(boot,100);
      return;
    }
    const params=new URLSearchParams(root.location.search);
    const ctx=root.IMMERSA_ROLE_OPEN||{};
    const deckId=params.get('deck')||ctx.deck||ctx.deckId||'demo';
    let manifest=null,interactions=[],videos=[],hiddenIds=new Set(),state=null,saving=false;
    const ids=role==='presenter'?{prev:'prev',next:'next'}:{prev:'prevSlide',next:'nextSlide'};
    const currentEl=document.getElementById('current');
    const totalEl=document.getElementById('total');
    const thumbs=document.getElementById('thumbs');

    function slideId(index){
      return String(manifest?.slides?.[index]?.id||'slide-'+String(index+1).padStart(3,'0'));
    }
    function hiddenIndex(index){return hiddenIds.has(slideId(index));}
    function ensureCss(){
      if(document.querySelector('link[data-slide-visibility]'))return;
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='/shared/slide-visibility.css?v=100';
      link.dataset.slideVisibility='1';
      document.head.appendChild(link);
    }
    function visible(){
      const count=manifest?.slides?.length||0;
      return Array.from({length:count},(_,index)=>index).filter(index=>!hiddenIndex(index));
    }
    function currentIndex(){
      return Number(role==='presenter'?(state?.presenterSlideIndex??state?.slideIndex??0):(state?.liveSlideIndex??state?.slideIndex??0))||0;
    }
    function targetFrom(index,delta){
      const list=visible();
      if(!list.length)return 0;
      const position=list.indexOf(index);
      if(position>=0)return list[Math.max(0,Math.min(list.length-1,position+delta))];
      if(delta>=0)return list.find(item=>item>index)??list.at(-1);
      return [...list].reverse().find(item=>item<index)??list[0];
    }
    function updateCount(){
      const list=visible();
      const index=currentIndex();
      const position=list.indexOf(index);
      if(totalEl)totalEl.textContent=String(list.length);
      if(currentEl)currentEl.textContent=String(position>=0?position+1:0);
      const prev=document.getElementById(ids.prev);
      const next=document.getElementById(ids.next);
      if(prev)prev.disabled=!list.length||position<=0;
      if(next)next.disabled=!list.length||position<0||position>=list.length-1;
    }
    function ensureThumbShell(node,index){
      let shell=node.parentElement?.classList.contains('thumb-visibility-wrap')?node.parentElement:null;
      if(!shell){
        shell=document.createElement('div');
        shell.className='thumb-visibility-wrap';
        node.before(shell);
        shell.appendChild(node);
      }
      node.querySelector(':scope > .thumb-visibility-toggle')?.remove();
      let control=shell.querySelector(':scope > .thumb-visibility-toggle');
      if(!control){
        control=document.createElement('button');
        control.type='button';
        control.className='thumb-visibility-toggle';
        control.addEventListener('pointerdown',event=>event.stopPropagation());
        shell.appendChild(control);
      }
      control.dataset.slideIndex=String(index);
      control.setAttribute('data-slide-id',slideId(index));
      return {shell,control};
    }
    function syncThumbs(){
      if(thumbs){
        const nodes=Array.from(thumbs.querySelectorAll('.thumb'));
        nodes.forEach((node,index)=>{
          node.dataset.slideIndex=String(index);
          node.setAttribute('data-slide-id',slideId(index));
          const off=hiddenIndex(index);
          const {shell,control}=ensureThumbShell(node,index);
          node.classList.toggle('is-hidden-slide',off);
          shell.classList.toggle('is-hidden-slide',off);
          node.setAttribute('aria-disabled',String(off));
          control.textContent=off?'✓':'×';
          control.title=off?'Restaurar slide':'Ocultar slide';
          control.setAttribute('aria-label',control.title);
        });
      }
      updateCount();
    }
    async function loadSettings(){
      const response=await fetch('/api/decks/'+encodeURIComponent(deckId)+'/interactions',{cache:'no-store'});
      const data=response.ok?await response.json():{};
      interactions=Array.isArray(data.interactions)?data.interactions:[];
      videos=Array.isArray(data.videos)?data.videos:[];
      const idsFromApi=Array.isArray(data.hidden_slide_ids)?data.hidden_slide_ids:[];
      hiddenIds=new Set(idsFromApi.length?idsFromApi:(data.hidden_slide_indexes||[]).map(Number).map(slideId));
      syncThumbs();
    }
    async function save(){
      if(saving)return;
      saving=true;
      try{
        const response=await fetch('/api/decks/'+encodeURIComponent(deckId)+'/interactions',{
          method:'PUT',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({interactions,videos,hidden_slide_ids:[...hiddenIds]})
        });
        if(!response.ok)throw new Error('Unable to save slide visibility');
        const data=await response.json();
        hiddenIds=new Set(data.hidden_slide_ids||[]);
      }catch(error){
        console.warn(error);
        await loadSettings();
      }finally{
        saving=false;
        syncThumbs();
      }
    }
    async function toggle(index){
      const list=visible();
      const id=slideId(index);
      const wasHidden=hiddenIds.has(id);
      if(!wasHidden&&list.length<=1){
        const node=thumbs?.querySelector('.thumb[data-slide-index="'+index+'"]');
        node?.classList.add('is-visibility-blocked');
        setTimeout(()=>node?.classList.remove('is-visibility-blocked'),700);
        return;
      }
      if(wasHidden)hiddenIds.delete(id);else hiddenIds.add(id);
      syncThumbs();
      if(!wasHidden&&index===currentIndex())live.emit('slide_go',{slideIndex:targetFrom(index,1)});
      await save();
    }
    function bindThumbs(){
      if(!thumbs)return;
      thumbs.addEventListener('click',event=>{
        const control=event.target.closest?.('.thumb-visibility-toggle');
        if(control&&thumbs.contains(control)){
          event.preventDefault();
          event.stopImmediatePropagation();
          toggle(Number(control.dataset.slideIndex));
          return;
        }
        const thumb=event.target.closest?.('.thumb');
        if(thumb&&hiddenIds.has(String(thumb.dataset.slideId))){
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },true);
      thumbs.addEventListener('keydown',event=>{
        const control=event.target.closest?.('.thumb-visibility-toggle');
        if(!control||!['Enter',' '].includes(event.key))return;
        event.preventDefault();
        event.stopPropagation();
        toggle(Number(control.dataset.slideIndex));
      },true);
      new MutationObserver(syncThumbs).observe(thumbs,{childList:true});
    }
    function bindNav(id,delta){
      document.getElementById(id)?.addEventListener('click',event=>{
        event.preventDefault();
        event.stopImmediatePropagation();
        const target=targetFrom(currentIndex(),delta);
        if(target!==currentIndex())live.emit('slide_go',{slideIndex:target});
      },true);
    }
    async function init(){
      ensureCss();
      const response=await fetch('/decks/'+encodeURIComponent(deckId)+'/manifest.json',{cache:'no-store'});
      manifest=await response.json();
      bindThumbs();
      bindNav(ids.prev,-1);
      bindNav(ids.next,1);
      await loadSettings();
      syncThumbs();
    }
    live.on('presentation_state',next=>{state=next;syncThumbs()});
    init().catch(error=>console.warn('Slide visibility unavailable',error));
  }
  boot();
})(window);
