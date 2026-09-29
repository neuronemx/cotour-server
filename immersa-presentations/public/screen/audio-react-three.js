/* Particle systems from the supplied "Partículas Audio-Reactivas (three.js).html".
 * Shaders, colors, geometry and audio response are preserved. IMMERSA supplies
 * the existing analyser's frequency bins and owns the playback element.
 */
(function () {
  "use strict";
  let root=null, threeCanvas=null, W=1, H=1;
  let bufferLength=256;
  let freqData=new Uint8Array(bufferLength).fill(20);
  let bass=0, mid=0, treble=0, beatPulse=0, beatCooldown=0, prevBass=0;
  const fluxHistory = new Array(30).fill(0.02);
  let fhIdx=0;
  let dependencyPromise=null, unavailable=false;
  const THREE_URL="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const GSAP_URL="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js";
  function loadDependency(globalName, url){
    if(window[globalName]) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const tag=document.createElement("script");
      tag.src=url; tag.async=true;
      tag.onload=()=>window[globalName] ? resolve() : reject(new Error(globalName+" unavailable"));
      tag.onerror=()=>{ tag.remove(); reject(new Error(globalName+" did not load")); };
      document.head.appendChild(tag);
    });
  }
  function ensureDependencies(){
    if(window.THREE && window.gsap) return true;
    if(!dependencyPromise && !unavailable){
      dependencyPromise=Promise.all([
        loadDependency("THREE", THREE_URL),
        loadDependency("gsap", GSAP_URL)
      ]).catch(error=>{
        unavailable=true;
        console.warn("Audio React Three unavailable; media and other reactions continue.", error);
      });
    }
    return false;
  }
  function resize(){
    if(!root) return;
    W=Math.max(1,root.clientWidth || innerWidth);
    H=Math.max(1,root.clientHeight || innerHeight);
    if(threeRenderer){
      threeRenderer.setSize(W,H);
      threeCamera.aspect=W/H;
      threeCamera.updateProjectionMatrix();
    }
  }
  function bandEnergy(from,to){
    let s=0,n=0;
    for(let i=from;i<to && i<bufferLength;i++){ s+=freqData[i]; n++; }
    return n? s/n/255 : 0;
  }
  function updateEnergies(){
    bass = bandEnergy(0,10); mid = bandEnergy(10,60); treble = bandEnergy(60,Math.min(180,bufferLength));
    const flux = Math.max(0, bass-prevBass); prevBass = bass;
    fluxHistory[fhIdx]=flux; fhIdx=(fhIdx+1)%fluxHistory.length;
    let s=0; for(let i=0;i<fluxHistory.length;i++) s+=fluxHistory[i];
    const avgFlux = s/fluxHistory.length;
    beatPulse *= 0.88;
    if(beatCooldown>0) beatCooldown--;
    if(flux > avgFlux*1.8 + 0.02 && bass>0.1 && beatCooldown<=0){ beatPulse=1; beatCooldown=8; }
  }
  // ================= three.js: réplica del tutorial Codrops (curl noise particles) =================
  let threeRenderer, threeScene, threeCamera, threeInited=false, threeClock=0;
  let particleSystems={};
  function initThree(){
    threeInited=true;
    threeScene = new THREE.Scene();
    threeCamera = new THREE.PerspectiveCamera(70, W/H, 0.1, 10000);
    threeCamera.position.z = 12;
    threeRenderer = new THREE.WebGLRenderer({canvas:threeCanvas, antialias:true, alpha:true});
    threeRenderer.setClearColor(0x05060a, 0);
    threeRenderer.setSize(W,H);

    const vShader = `
      varying float vDistance;
      uniform float time, offsetSize, size, offsetGain, amplitude, frequency, maxDistance;
      vec3 mod289(vec3 x){ return x-floor(x*(1./289.))*289.; }
      vec2 mod289(vec2 x){ return x-floor(x*(1./289.))*289.; }
      vec3 permute(vec3 x){ return mod289(((x*34.)+1.)*x); }
      float snoise(vec2 v){
        const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
        vec2 i=floor(v+dot(v,C.yy));
        vec2 x0=v-i+dot(i,C.xx);
        vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
        vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
        i=mod289(i);
        vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
        vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
        m=m*m; m=m*m;
        vec3 x=2.*fract(p*C.www)-1.;
        vec3 h=abs(x)-.5; vec3 ox=floor(x+.5); vec3 a0=x-ox;
        m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
        vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
        return 130.*dot(m,g);
      }
      vec3 curl(float x,float y,float z){
        float eps=1., eps2=2.*eps, n1,n2,a,b;
        x+=time*.05; y+=time*.05; z+=time*.05;
        vec3 c=vec3(0.);
        n1=snoise(vec2(x,y+eps)); n2=snoise(vec2(x,y-eps)); a=(n1-n2)/eps2;
        n1=snoise(vec2(x,z+eps)); n2=snoise(vec2(x,z-eps)); b=(n1-n2)/eps2;
        c.x=a-b;
        n1=snoise(vec2(y,z+eps)); n2=snoise(vec2(y,z-eps)); a=(n1-n2)/eps2;
        n1=snoise(vec2(x+eps,z)); n2=snoise(vec2(x+eps,z)); b=(n1-n2)/eps2;
        c.y=a-b;
        n1=snoise(vec2(x+eps,y)); n2=snoise(vec2(x-eps,y)); a=(n1-n2)/eps2;
        n1=snoise(vec2(y+eps,z)); n2=snoise(vec2(y-eps,z)); b=(n1-n2)/eps2;
        c.z=a-b;
        return c;
      }
      void main(){
        vec3 newpos = position;
        vec3 target = position + (normal*.1) + curl(newpos.x*frequency, newpos.y*frequency, newpos.z*frequency)*amplitude;
        float d = clamp(length(newpos-target)/maxDistance, 0., 1.);
        newpos = mix(position, target, pow(d,4.));
        newpos.z += sin(time)*(.1*offsetGain);
        vec4 mvPosition = modelViewMatrix*vec4(newpos,1.);
        gl_PointSize = size + (pow(d,3.)*offsetSize)*(1./-mvPosition.z);
        gl_Position = projectionMatrix*mvPosition;
        vDistance = d;
      }`;
    const fShader = `
      varying float vDistance;
      uniform vec3 startColor, endColor;
      float circle(in vec2 st, in float r){
        vec2 dist = st-vec2(.5);
        return 1.-smoothstep(r-(r*.01), r+(r*.01), dot(dist,dist)*4.);
      }
      void main(){
        vec2 uv = vec2(gl_PointCoord.x, 1.-gl_PointCoord.y);
        vec3 circ = vec3(circle(uv,1.));
        vec3 color = mix(startColor, endColor, vDistance);
        gl_FragColor = vec4(color, circ.r*vDistance);
      }`;

    function makeSystem(geo, offsetSizeVal, sizeVal, cA, cB){
      const mat = new THREE.ShaderMaterial({
        transparent:true,
        uniforms:{ time:{value:0}, offsetSize:{value:offsetSizeVal}, size:{value:sizeVal},
          frequency:{value:1.4}, amplitude:{value:1}, offsetGain:{value:0}, maxDistance:{value:1.8},
          startColor:{value:new THREE.Color(cA)}, endColor:{value:new THREE.Color(cB)} },
        vertexShader:vShader, fragmentShader:fShader
      });
      const holder = new THREE.Object3D();
      const pts = new THREE.Points(geo, mat);
      holder.add(pts);
      holder.visible = false;
      threeScene.add(holder);
      return {points:pts, material:mat, holder};
    }
    const boxGeo = new THREE.BoxGeometry(1,1,1, THREE.MathUtils.randInt(5,20), THREE.MathUtils.randInt(10,40), THREE.MathUtils.randInt(5,80));
    particleSystems.box = makeSystem(boxGeo, THREE.MathUtils.randInt(30,60), 1.1, 0xff00ff, 0x00ffff);
    particleSystems.box.holder.rotation.x = Math.PI/2;

    const sphGeo = new THREE.SphereGeometry(1, 64, 48);
    particleSystems.sphere = makeSystem(sphGeo, 18, 1.3, 0x1e3a8a, 0x22d3ee); // quietas = azul rey oscuro, en movimiento = cyan
    particleSystems.sphere.material.uniforms.maxDistance.value = 0.6;
    particleSystems.sphere.ampScale = 0.45;

    particleSystems.box.targetZ = 10.25; // mitad entre la profundidad original y el acercamiento anterior
    particleSystems.sphere.targetZ = THREE.MathUtils.randInt(9,10);
    Object.values(particleSystems).forEach(sys=>{
      sys.holder.position.z = sys.targetZ;
      gsap.to(sys.holder.rotation, {duration:8, y:'+='+(Math.PI*2), ease:'none', repeat:-1});
    });
  }
  let lastActiveSys=null;
  function tumble(sys){
    gsap.to(sys.holder.rotation, {duration:3, x:Math.random()*Math.PI, z:Math.random()*Math.PI*2, ease:'power2.inOut'});
  }
  function drawParticleSystem(id){
    if(!threeInited) initThree();
    Object.keys(particleSystems).forEach(k=>{ particleSystems[k].holder.visible = (k===id); });
    if(lastActiveSys!==id){
      lastActiveSys=id;
      const sys=particleSystems[id];
      gsap.fromTo(sys.holder.position, {z:sys.targetZ-1}, {z:sys.targetZ, duration:0.6, ease:'elastic.out(0.8,0.5)'});
    }
    const sys = particleSystems[id];
    sys.material.uniforms.amplitude.value = (0.7 + treble*0.5) * (sys.ampScale ?? 1);
    sys.material.uniforms.offsetGain.value = mid*0.6;
    const t = Math.min(0.5, Math.max(0.2, 0.2+(bass-0.6)*0.75));
    threeClock += t;
    sys.material.uniforms.time.value = threeClock;
    if(beatPulse>0.95 && Math.random()<0.3) tumble(sys);
    threeRenderer.render(threeScene, threeCamera);
  }


  function releaseThree(){
    if(window.gsap){
      Object.values(particleSystems).forEach(sys=>{
        window.gsap.killTweensOf(sys.holder.rotation);
        window.gsap.killTweensOf(sys.holder.position);
      });
    }
    Object.values(particleSystems).forEach(sys=>{
      sys.points.geometry.dispose();
      sys.material.dispose();
    });
    particleSystems={}; lastActiveSys=null;
    if(threeRenderer){
      threeRenderer.dispose();
      threeRenderer.forceContextLoss();
      threeRenderer=null;
    }
    threeScene=null; threeCamera=null; threeInited=false; threeClock=0;
    threeCanvas?.remove(); threeCanvas=null; root=null;
  }
  window.ImmersaAudioReactThree={
    draw(host, id, bins){
      if(!ensureDependencies() || !host || !bins) return;
      try{
        if(root!==host){ releaseThree(); root=host; }
        if(!threeCanvas){
          threeCanvas=document.createElement("canvas");
          threeCanvas.className="audio-react-three-canvas";
          threeCanvas.setAttribute("aria-hidden","true");
          root.appendChild(threeCanvas);
          resize();
        }
        freqData=bins; bufferLength=bins.length;
        updateEnergies();
        drawParticleSystem(id);
      }catch(error){
        console.warn("Audio React Three unavailable; media and other reactions continue.", error);
        releaseThree();
        unavailable=true;
      }
    },
    resize(){ resize(); },
    stop(){ releaseThree(); }
  };
})();
