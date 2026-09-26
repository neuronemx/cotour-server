(function () {
  "use strict";

  const DEFAULT_LOGO = "https://media.immersalive.com/logo.png";
  const REACTION_COUNT = 10;
  let state = { enabled: false, reaction: 0 };
  let root = null, canvas = null, c = null, logo = null, audioEl = null;
  let W = innerWidth, H = innerHeight, mounted = false, raf = 0, failed = false;
  let audioCtx = null, analyser = null, srcNode = null, bufferLength = 256;
  let freqData = new Uint8Array(bufferLength).fill(20);
  let timeData = new Uint8Array(bufferLength).fill(128);

  function resize() {
    if (!canvas || !root || !c) return;
    W = Math.max(1, root.clientWidth || innerWidth);
    H = Math.max(1, root.clientHeight || innerHeight);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    buildGrid(); buildKaleidoPts(); buildSand();
  }

  function ensureLayer() {
    if (!root) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "audio-react-overlay";
      canvas.setAttribute("aria-hidden", "true");
      c = canvas.getContext("2d", { alpha: true });
      root.appendChild(canvas);
    }
    if (!logo) {
      logo = document.createElement("img");
      logo.className = "audio-react-logo";
      logo.alt = "";
      logo.setAttribute("aria-hidden", "true");
      root.appendChild(logo);
    }
    resize();
  }

  function setLogo(url) {
    if (!logo) ensureLayer();
    if (logo) logo.src = url || DEFAULT_LOGO;
  }

  function attachAnalyser() {
    if (failed || srcNode || !audioEl) return;
    const sourceUrl = audioEl.currentSrc || audioEl.src || "";
    if (!sourceUrl.startsWith("blob:") && audioEl.crossOrigin !== "anonymous") return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const attach = () => {
        if (!audioCtx || audioCtx.state !== "running" || srcNode || !audioEl) return;
        srcNode = audioCtx.createMediaElementSource(audioEl);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = .8;
        bufferLength = analyser.frequencyBinCount;
        freqData = new Uint8Array(bufferLength);
        timeData = new Uint8Array(bufferLength);
        srcNode.connect(analyser);
        srcNode.connect(audioCtx.destination);
      };
      const unlock = () => audioCtx?.resume().then(attach).catch(() => {});
      ["pointerdown", "keydown", "touchstart"].forEach((eventName) => document.addEventListener(eventName, unlock, { passive: true, once: true }));
      audioEl.addEventListener("play", unlock, { passive: true });
      if (audioCtx.state === "running") attach();
    } catch (error) {
      failed = true;
      console.warn("Audio React unavailable; audiovisual playback remains unchanged.", error);
      stopDrawing();
    }
  }
  // ---- energy helpers ----
  function bandEnergy(from,to){
    let s=0,n=0;
    for(let i=from;i<to && i<bufferLength;i++){ s+=freqData[i]; n++; }
    return n? s/n/255 : 0;
  }
  let bass=0, mid=0, treble=0, overall=0;
  let beatPulse=0, beatCooldown=0, prevBass=0;
  // detector por "flujo" (subida de graves frame a frame) en vez de nivel absoluto:
  // así detecta cada ataque/kick aunque el bajo se mantenga alto todo el tiempo
  const fluxHistory = new Array(30).fill(0.02);
  let fhIdx=0;
  function updateEnergies(){
    bass = bandEnergy(0,10); mid = bandEnergy(10,60); treble = bandEnergy(60,Math.min(180,bufferLength));
    overall = bandEnergy(0,bufferLength);
    const flux = Math.max(0, bass - prevBass);
    prevBass = bass;
    fluxHistory[fhIdx]=flux; fhIdx=(fhIdx+1)%fluxHistory.length;
    let s=0; for(let i=0;i<fluxHistory.length;i++) s+=fluxHistory[i];
    const avgFlux = s/fluxHistory.length;
    beatPulse *= 0.88;
    if(beatCooldown>0) beatCooldown--;
    if(flux > avgFlux*1.8 + 0.02 && bass>0.1 && beatCooldown<=0){ beatPulse=1; beatCooldown=8; }
  }

  let hue=200;
  function fade(alpha){ c.save(); c.globalCompositeOperation="destination-out"; c.fillStyle=`rgba(0,0,0,${Math.min(.92, alpha)})`; c.fillRect(0,0,W,H); c.restore(); }

  // ================= MODE 1: líneas =================
  function drawLines(){
    fade(0.25);
    const rows=5, step=W/(bufferLength-1);
    for(let r=0;r<rows;r++){
      const y0=H*(r+1)/(rows+1);
      c.beginPath();
      for(let i=0;i<bufferLength;i++){
        const v=freqData[i]/255, x=i*step;
        const y=y0 - v*(60+r*10)*(r%2===0?1:-0.8);
        i===0?c.moveTo(x,y):c.lineTo(x,y);
      }
      c.strokeStyle=`hsla(${190+r*30},90%,70%,${0.55-r*0.07})`;
      c.lineWidth=2; c.stroke();
    }
  }

  // ================= MODE 2: barras =================
  function drawBars(){
    fade(0.35);
    const n=64, bw=W/n;
    for(let i=0;i<n;i++){
      const idx=Math.floor(i*bufferLength/n/2);
      const v=freqData[idx]/255;
      const bh=v*H*0.45;
      const hueB=200+i*2;
      c.fillStyle=`hsla(${hueB},85%,60%,0.85)`;
      c.fillRect(i*bw+1, H/2-bh, bw-2, bh);
      c.fillRect(i*bw+1, H/2, bw-2, bh*0.6);
    }
  }

  // ================= MODE 3: onda circular =================
  function drawRadial(){
    fade(0.3);
    const cx=W/2, cy=H/2, base=Math.min(W,H)*0.18;
    c.beginPath();
    for(let i=0;i<bufferLength;i++){
      const ang=(i/bufferLength)*Math.PI*2;
      const v=(timeData[i]-128)/128;
      const r=base + v*base*1.4 + bass*40;
      const x=cx+Math.cos(ang)*r, y=cy+Math.sin(ang)*r;
      i===0?c.moveTo(x,y):c.lineTo(x,y);
    }
    c.closePath();
    c.strokeStyle=`hsla(${200+treble*120},90%,70%,0.8)`;
    c.lineWidth=2; c.stroke();
    c.beginPath(); c.arc(cx,cy,base*0.5+bass*30,0,Math.PI*2);
    c.strokeStyle='rgba(125,211,252,0.4)'; c.stroke();
  }

  // ================= MODE 4: nube de puntos =================
  let cloudPts=[];
  function initCloud(){
    cloudPts=[];
    for(let i=0;i<120;i++){
      cloudPts.push({angle:Math.random()*Math.PI*2, baseR:Math.random()*Math.min(W,H)*0.32+40,
        speed:(Math.random()-0.5)*0.002, bin:Math.floor(Math.random()*80)+2, size:Math.random()*1.5+1});
    }
  }
  function drawCloud(){
    fade(0.28);
    const cx=W/2, cy=H/2;
    cloudPts.forEach(p=>{
      p.angle += p.speed + bass*0.01;
      const v=freqData[p.bin]/255;
      const r=p.baseR + v*130;
      const x=cx+Math.cos(p.angle)*r, y=cy+Math.sin(p.angle)*r;
      const s=p.size*0.6+v*1.8+bass*1.2;
      const g=c.createRadialGradient(x,y,0,x,y,s*2.2);
      g.addColorStop(0,`rgba(125,211,252,${0.6+v*0.4})`); g.addColorStop(1,'rgba(244,114,182,0)');
      c.fillStyle=g; c.beginPath(); c.arc(x,y,s,0,Math.PI*2); c.fill();
    });
    c.beginPath(); c.arc(cx,cy,20+bass*70,0,Math.PI*2);
    c.strokeStyle=`rgba(125,211,252,${0.3+bass*0.5})`; c.lineWidth=2; c.stroke();
  }

  // ================= MODE 5: malla / terreno =================
  let gridCols=28, gridPhase=0;
  function buildGrid(){ gridCols = Math.max(16, Math.floor(W/40)); }
  function drawGrid(){
    fade(0.35);
    gridPhase += 0.02 + bass*0.03;
    const rows=6;
    for(let r=0;r<rows;r++){
      const depth=r/rows;
      const y0=H*0.35 + depth*H*0.6;
      const amp=(1-depth)*70*(0.3+mid);
      c.beginPath();
      for(let i=0;i<=gridCols;i++){
        const x=i*W/gridCols;
        const bin=Math.floor(i/gridCols*bufferLength*0.5);
        const v=freqData[bin]/255;
        const y=y0 - v*amp - Math.sin(gridPhase+i*0.4+r)*8*(1-depth);
        i===0?c.moveTo(x,y):c.lineTo(x,y);
      }
      c.strokeStyle=`hsla(${180+depth*100},80%,65%,${0.7-depth*0.4})`;
      c.lineWidth=1.5-depth; c.stroke();
    }
  }

  // ================= MODE 6: arena en la bocina =================
  let sand=[];
  function buildSand(){
    sand=[];
    const n = Math.max(120, Math.floor(W/6));
    for(let i=0;i<n;i++){
      sand.push({
        x: (i/n)*W + (Math.random()-0.5)*4,
        baseX: (i/n)*W,
        y:0, vy:0,
        bin: Math.floor((i/n)*bufferLength*0.55)+2,
        size: 1+Math.random()*1.8, cooldown:0
      });
    }
  }
  function drawSand(){
    fade(0.3);
    const coneY = H*0.72 - bass*18; // el "cono" respira con los graves
    const ceiling = 0; // techo en el borde real de la pantalla
    // línea de la bocina
    c.beginPath(); c.moveTo(0,coneY); c.lineTo(W,coneY);
    c.strokeStyle=`rgba(80,220,255,${0.35+bass*0.4})`; c.lineWidth=2; c.stroke();
    sand.forEach(p=>{
      const v = freqData[p.bin]/255;
      // cooldown por partícula + sensibilidad más baja (v al cuadrado) para que no se acumule el caos
      if(p.cooldown>0){ p.cooldown--; }
      else if(Math.random() < v*v*0.10){
        p.vy = -(1.6 + v*13 + Math.random()*2.5);
        p.x = p.baseX + (Math.random()-0.5)*10*v;
        p.cooldown = 8 + Math.floor(Math.random()*10);
      }
      p.vy += 0.95; // gravedad más fuerte: bajan más rápido
      p.y += p.vy;
      if(p.y>0){ p.y=0; p.vy=0; }
      if(coneY+p.y < ceiling){ p.y = ceiling-coneY; p.vy = Math.max(p.vy,0); }
      const grainY = coneY + p.y;
      const alpha = 0.55 + v*0.4;
      c.fillStyle = `rgba(56,${200+Math.floor(v*40)},255,${alpha})`;
      c.beginPath(); c.arc(p.x, grainY, p.size, 0, Math.PI*2); c.fill();
    });
  }

  // ================= MODE 7: partículas + beat =================
  let burst=[];
  function drawBurst(){
    fade(0.18);
    const cx=W/2, cy=H/2;
    if(beatPulse>0.85){
      for(let i=0;i<14;i++){
        const a=Math.random()*Math.PI*2, sp=2+Math.random()*5;
        burst.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1});
      }
    }
    burst.forEach(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vx*=0.985; p.vy*=0.985; p.life-=0.012;
      p.vx += (cx-p.x)*0.0005; p.vy += (cy-p.y)*0.0005;
    });
    burst = burst.filter(p=>p.life>0);
    burst.forEach(p=>{
      c.fillStyle=`rgba(244,114,182,${p.life})`;
      c.beginPath(); c.arc(p.x,p.y,2.5+treble*3,0,Math.PI*2); c.fill();
    });
    c.beginPath(); c.arc(cx,cy,15+beatPulse*60,0,Math.PI*2);
    c.strokeStyle=`rgba(125,211,252,${0.3+beatPulse*0.6})`; c.lineWidth=2; c.stroke();
  }

  // ================= MODE 8: kaleidoscopio =================
  let kaleidoPts=[];
  function buildKaleidoPts(){
    kaleidoPts=[];
    for(let i=0;i<18;i++) kaleidoPts.push({bin:Math.floor(i*bufferLength/18/2), a:Math.random()*Math.PI/4});
  }
  function drawKaleido(){
    fade(0.12);
    const cx=W/2, cy=H/2, segments=10;
    hue = (hue + 0.6 + treble*3) % 360;
    for(let s=0;s<segments;s++){
      c.save();
      c.translate(cx,cy);
      c.rotate(s*(Math.PI*2/segments));
      if(s%2===1) c.scale(1,-1);
      kaleidoPts.forEach((p,i)=>{
        const v=freqData[p.bin]/255;
        const len=40+v*Math.min(W,H)*0.35;
        const ang=p.a + i*0.05;
        const x=Math.cos(ang)*len, y=Math.sin(ang)*len;
        c.beginPath(); c.moveTo(0,0); c.lineTo(x,y);
        c.strokeStyle=`hsla(${hue+i*8},95%,65%,${0.35+v*0.5})`;
        c.lineWidth=1.5+v*2; c.stroke();
        c.beginPath(); c.arc(x,y,2+v*4,0,Math.PI*2);
        c.fillStyle=`hsla(${hue+i*8},95%,70%,0.8)`; c.fill();
      });
      c.restore();
    }
  }

  // ================= MODE 9: blobs psicodélicos =================
  let blobs=[];
  function initBlobs(){
    blobs=[];
    for(let i=0;i<6;i++) blobs.push({ox:Math.random()*Math.PI*2, oy:Math.random()*Math.PI*2,
      fx:0.3+Math.random()*0.4, fy:0.3+Math.random()*0.4, bin:i*15+5});
  }
  function drawBlobs(){
    fade(0.07);
    hue = (hue + 1 + bass*4) % 360;
    const t=performance.now()/1000;
    c.globalCompositeOperation='lighter';
    blobs.forEach((b,i)=>{
      const v=freqData[b.bin]/255;
      const cx=W/2 + Math.sin(t*b.fx+b.ox)*W*0.28;
      const cy=H/2 + Math.cos(t*b.fy+b.oy)*H*0.28;
      const r=60+v*180+bass*60;
      const g=c.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,`hsla(${hue+i*40},95%,65%,0.5)`);
      g.addColorStop(1,'hsla(0,0%,0%,0)');
      c.fillStyle=g; c.beginPath(); c.arc(cx,cy,r,0,Math.PI*2); c.fill();
    });
    c.globalCompositeOperation='source-over';
  }


  function drawLogoPulse() {
    if (!logo) return;
    const scale = 1 + (bass * .7 + mid * .5 + treble * .35) * .22 + beatPulse * .12;
    const rotate = Math.sin(performance.now() / 4200) * 3;
    logo.style.transform = "translate(-50%, -50%) scale(" + scale + ") rotate(" + rotate + "deg)";
  }

  const MODES = [drawLines, drawBars, drawRadial, drawCloud, drawGrid, drawSand, drawBurst, drawKaleido, drawBlobs];

  function draw() {
    if (!state.enabled || !canvas || failed) { raf = 0; return; }
    if (analyser) { analyser.getByteFrequencyData(freqData); analyser.getByteTimeDomainData(timeData); }
    updateEnergies();
    const reaction = Math.max(0, Math.min(REACTION_COUNT - 1, Number(state.reaction) || 0));
    const isLogo = reaction === 9;
    logo?.classList.toggle("is-active", isLogo);
    if (isLogo) {
      c.clearRect(0, 0, W, H);
      drawLogoPulse();
    } else {
      logo?.classList.remove("is-active");
      MODES[reaction]();
    }
    raf = requestAnimationFrame(draw);
  }

  function startDrawing() {
    ensureLayer();
    if (!canvas || raf || !state.enabled || failed) return;
    canvas.classList.add("is-active");
    attachAnalyser();
    raf = requestAnimationFrame(draw);
  }

  function stopDrawing() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    canvas?.classList.remove("is-active");
    logo?.classList.remove("is-active");
    if (c && canvas) c.clearRect(0, 0, canvas.width, canvas.height);
  }

  window.ImmersaAudioReact = {
    init(options) {
      root = options?.root || document.body;
      if (!mounted) {
        mounted = true;
        window.addEventListener("resize", resize, { passive: true });
      }
      ensureLayer();
      setLogo(DEFAULT_LOGO);
    },
    setAudioElement(element) { audioEl = element || null; if (state.enabled) attachAnalyser(); },
    setLocalLogo(url) { setLogo(url || DEFAULT_LOGO); },
    setState(next) {
      state = { ...state, ...(next || {}), reaction: Math.max(0, Math.min(REACTION_COUNT - 1, Number(next?.reaction ?? state.reaction) || 0)) };
      if (state.enabled) startDrawing(); else stopDrawing();
    }
  };
})();
