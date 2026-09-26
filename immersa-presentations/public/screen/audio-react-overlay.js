(function () {
  "use strict";

  const DEFAULT_LOGO = "https://media.immersalive.com/logo.png";
  const REACTION_COUNT = 10;
  let state = { enabled: false, reaction: 0 };
  let root = null, canvas = null, context2d = null, audio = null;
  let audioContext = null, source = null, analyser = null, frequencyData = null, timeData = null;
  let raf = 0, failed = false, logoUrl = DEFAULT_LOGO, logoImage = null;
  let particles = [], cloud = [], hue = 196, mounted = false;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function energy(from, to) {
    if (!frequencyData) return 0;
    let total = 0, count = 0;
    for (let index = from; index < Math.min(to, frequencyData.length); index += 1) { total += frequencyData[index]; count += 1; }
    return count ? total / count / 255 : 0;
  }
  function resize() {
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, root?.clientWidth || window.innerWidth);
    const height = Math.max(1, root?.clientHeight || window.innerHeight);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    canvas.style.width = width + "px"; canvas.style.height = height + "px";
    context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
    cloud = Array.from({ length: 96 }, (_, index) => ({ angle: Math.random() * Math.PI * 2, radius: 50 + Math.random() * Math.min(width, height) * .28, speed: (Math.random() - .5) * .015, bin: 2 + (index * 7) % 112, size: .7 + Math.random() * 1.6 }));
    particles = [];
  }
  function ensureCanvas() {
    if (canvas || !root) return;
    canvas = document.createElement("canvas");
    canvas.className = "audio-react-overlay";
    canvas.setAttribute("aria-hidden", "true");
    context2d = canvas.getContext("2d", { alpha: true });
    root.appendChild(canvas);
    resize();
  }
  function loadLogo(url) {
    logoUrl = url || DEFAULT_LOGO;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { logoImage = image; };
    image.onerror = () => { if (url !== DEFAULT_LOGO) loadLogo(DEFAULT_LOGO); };
    image.src = logoUrl;
  }
  function readAudio() {
    if (!analyser || !frequencyData || !timeData) return;
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeData);
  }
  function attachAnalyser() {
    if (failed || source || !audio) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const attach = () => {
        if (!audioContext || audioContext.state !== "running" || source || !audio) return;
        source = audioContext.createMediaElementSource(audio);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = .82;
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        timeData = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
        source.connect(audioContext.destination);
      };
      const unlock = () => {
        if (!audioContext) return;
        audioContext.resume().then(attach).catch(() => {});
      };
      ["pointerdown", "keydown", "touchstart"].forEach((eventName) => document.addEventListener(eventName, unlock, { passive: true, once: true }));
      audio.addEventListener("play", unlock, { passive: true });
      if (audioContext.state === "running") attach();
    } catch (error) {
      failed = true;
      console.warn("Audio React unavailable; audiovisual playback remains unchanged.", error);
      stopDrawing();
    }
  }
  function clear(width, height) { context2d.clearRect(0, 0, width, height); }
  function stroke(color, width) { context2d.strokeStyle = color; context2d.lineWidth = width; context2d.lineCap = "round"; context2d.lineJoin = "round"; }
  function drawLines(width, height, bass) {
    const rows = 4, step = width / Math.max(1, frequencyData.length - 1);
    for (let row = 0; row < rows; row += 1) {
      context2d.beginPath();
      const y = height * (row + 1) / (rows + 1);
      for (let index = 0; index < frequencyData.length; index += 1) {
        const value = frequencyData[index] / 255;
        const pointY = y - value * (35 + row * 12) * (row % 2 ? -.7 : 1);
        if (!index) context2d.moveTo(index * step, pointY); else context2d.lineTo(index * step, pointY);
      }
      stroke("hsla(" + (188 + row * 24) + ",90%,72%," + (.26 + bass * .45) + ")", 1.5);
      context2d.stroke();
    }
  }
  function drawBars(width, height) {
    const count = 54, barWidth = width / count;
    for (let index = 0; index < count; index += 1) {
      const value = frequencyData[Math.floor(index * frequencyData.length / count * .55)] / 255;
      const barHeight = value * height * .38;
      context2d.fillStyle = "hsla(" + (184 + index * 2.2) + ",92%,66%," + (.22 + value * .7) + ")";
      context2d.fillRect(index * barWidth + 1, height / 2 - barHeight, Math.max(1, barWidth - 2), barHeight * 2);
    }
  }
  function drawRadial(width, height, bass) {
    const cx = width / 2, cy = height / 2, base = Math.min(width, height) * .16;
    context2d.beginPath();
    for (let index = 0; index < timeData.length; index += 1) {
      const angle = index / timeData.length * Math.PI * 2;
      const value = (timeData[index] - 128) / 128;
      const radius = base + value * base * 1.2 + bass * 42;
      const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
      if (!index) context2d.moveTo(x, y); else context2d.lineTo(x, y);
    }
    context2d.closePath(); stroke("rgba(113,224,225,.85)", 2); context2d.stroke();
  }
  function drawCloud(width, height, bass) {
    const cx = width / 2, cy = height / 2;
    cloud.forEach((point) => {
      point.angle += point.speed + bass * .02;
      const value = frequencyData[point.bin % frequencyData.length] / 255;
      const radius = point.radius + value * 118;
      const x = cx + Math.cos(point.angle) * radius, y = cy + Math.sin(point.angle) * radius;
      context2d.fillStyle = "hsla(" + (186 + value * 100) + ",96%,72%," + (.14 + value * .7) + ")";
      context2d.beginPath(); context2d.arc(x, y, point.size + value * 2.8, 0, Math.PI * 2); context2d.fill();
    });
  }
  function drawGrid(width, height, mid) {
    const rows = 7, columns = 32;
    for (let row = 0; row < rows; row += 1) {
      context2d.beginPath();
      for (let column = 0; column <= columns; column += 1) {
        const value = frequencyData[Math.floor(column / columns * frequencyData.length * .55)] / 255;
        const x = column * width / columns;
        const y = height * .32 + row * height * .1 - value * (34 + (rows - row) * 8) - Math.sin(performance.now() / 700 + column * .4) * mid * 9;
        if (!column) context2d.moveTo(x, y); else context2d.lineTo(x, y);
      }
      stroke("hsla(" + (178 + row * 11) + ",88%,68%," + (.18 + (rows - row) * .045) + ")", 1); context2d.stroke();
    }
  }
  function drawSand(width, height, bass) {
    const y = height * .72 - bass * 18;
    context2d.beginPath(); context2d.moveTo(0, y); context2d.lineTo(width, y); stroke("rgba(80,220,255,.4)", 1.5); context2d.stroke();
    const count = Math.min(170, Math.floor(width / 7));
    for (let index = 0; index < count; index += 1) {
      const value = frequencyData[Math.floor(index / count * frequencyData.length * .52)] / 255;
      if (Math.random() > value * value * .18) continue;
      const x = index / count * width + (Math.random() - .5) * 9;
      const rise = value * (22 + Math.random() * 120);
      context2d.fillStyle = "rgba(62,215,255," + (.22 + value * .72) + ")";
      context2d.beginPath(); context2d.arc(x, y - rise, 1 + value * 2.4, 0, Math.PI * 2); context2d.fill();
    }
  }
  function drawBurst(width, height, bass) {
    const beat = bass > .22 && Math.random() < bass * .22;
    if (beat) for (let index = 0; index < 12; index += 1) {
      const angle = Math.random() * Math.PI * 2, speed = 1.5 + Math.random() * 4;
      particles.push({ x: width / 2, y: height / 2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1 });
    }
    particles = particles.filter((particle) => (particle.life -= .017) > 0).slice(-360);
    particles.forEach((particle) => {
      particle.x += particle.vx; particle.y += particle.vy; particle.vx *= .985; particle.vy *= .985;
      context2d.fillStyle = "rgba(209,120,255," + particle.life * .7 + ")";
      context2d.beginPath(); context2d.arc(particle.x, particle.y, 1.5 + bass * 3, 0, Math.PI * 2); context2d.fill();
    });
  }
  function drawKaleido(width, height, treble) {
    const cx = width / 2, cy = height / 2, segments = 10; hue = (hue + .7 + treble * 3) % 360;
    for (let segment = 0; segment < segments; segment += 1) {
      context2d.save(); context2d.translate(cx, cy); context2d.rotate(segment * Math.PI * 2 / segments);
      for (let index = 0; index < 10; index += 1) {
        const value = frequencyData[Math.floor(index * frequencyData.length / 24)] / 255;
        context2d.beginPath(); context2d.moveTo(0, 0); context2d.lineTo(35 + value * Math.min(width, height) * .3, index * 7);
        stroke("hsla(" + (hue + index * 11) + ",95%,68%," + (.22 + value * .58) + ")", 1.2 + value * 2); context2d.stroke();
      }
      context2d.restore();
    }
  }
  function drawBlobs(width, height, bass, treble) {
    const time = performance.now() / 1000;
    for (let index = 0; index < 5; index += 1) {
      const value = frequencyData[(index + 1) * 15] / 255;
      const x = width / 2 + Math.sin(time * (.24 + index * .06) + index) * width * .28;
      const y = height / 2 + Math.cos(time * (.21 + index * .07) + index) * height * .28;
      const radius = 46 + value * 135 + bass * 70;
      const gradient = context2d.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "hsla(" + (190 + index * 46 + treble * 80) + ",96%,65%," + (.18 + value * .38) + ")");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context2d.fillStyle = gradient; context2d.beginPath(); context2d.arc(x, y, radius, 0, Math.PI * 2); context2d.fill();
    }
  }
  function drawLogo(width, height, bass, mid, treble) {
    if (!logoImage?.complete || !logoImage.naturalWidth) return;
    const pulse = 1 + (bass * .7 + mid * .45 + treble * .28) * .22;
    const size = Math.min(width, height) * .34 * pulse;
    context2d.save(); context2d.globalAlpha = .86; context2d.translate(width / 2, height / 2); context2d.rotate(Math.sin(performance.now() / 4200) * .04);
    context2d.drawImage(logoImage, -size / 2, -size / 2, size, size); context2d.restore();
  }
  function draw() {
    if (!state.enabled || !canvas || failed) { raf = 0; return; }
    const width = root?.clientWidth || window.innerWidth, height = root?.clientHeight || window.innerHeight;
    readAudio(); clear(width, height);
    const bass = energy(0, 10), mid = energy(10, 62), treble = energy(62, 180);
    switch (clamp(Number(state.reaction) || 0, 0, REACTION_COUNT - 1)) {
      case 0: drawLines(width, height, bass); break; case 1: drawBars(width, height); break;
      case 2: drawRadial(width, height, bass); break; case 3: drawCloud(width, height, bass); break;
      case 4: drawGrid(width, height, mid); break; case 5: drawSand(width, height, bass); break;
      case 6: drawBurst(width, height, bass); break; case 7: drawKaleido(width, height, treble); break;
      case 8: drawBlobs(width, height, bass, treble); break; default: drawLogo(width, height, bass, mid, treble);
    }
    raf = requestAnimationFrame(draw);
  }
  function startDrawing() {
    if (raf || !state.enabled || failed) return;
    ensureCanvas(); if (!canvas) return;
    canvas.classList.add("is-active"); attachAnalyser(); raf = requestAnimationFrame(draw);
  }
  function stopDrawing() {
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (canvas) { canvas.classList.remove("is-active"); context2d?.clearRect(0, 0, canvas.width, canvas.height); }
  }
  window.ImmersaAudioReact = {
    init(options) {
      root = options?.root || document.body;
      if (!mounted) { mounted = true; window.addEventListener("resize", resize, { passive: true }); loadLogo(DEFAULT_LOGO); }
    },
    setAudioElement(element) { audio = element || null; if (state.enabled) attachAnalyser(); },
    setLocalLogo(url) { loadLogo(url || DEFAULT_LOGO); },
    setState(next) {
      state = { ...state, ...(next || {}), reaction: clamp(Number(next?.reaction ?? state.reaction) || 0, 0, REACTION_COUNT - 1) };
      if (state.enabled) startDrawing(); else stopDrawing();
    }
  };
})();