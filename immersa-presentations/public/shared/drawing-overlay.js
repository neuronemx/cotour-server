(function () {
  const DEFAULT_COLOR = "#b20de9";
  const DEFAULT_WIDTH = 0.018;
  const DEFAULT_OPACITY = 0.65;
  const DEFAULT_TTL = 4200;
  const FADE_MS = 1000;

  function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }

  function normalizePoint(point) {
    return { x: clamp01(point?.x), y: clamp01(point?.y) };
  }

  function getSlideRect(root, slide) {
    const rootRect = root.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    const naturalWidth = slide.naturalWidth || slide.videoWidth || slideRect.width || rootRect.width;
    const naturalHeight = slide.naturalHeight || slide.videoHeight || slideRect.height || rootRect.height;
    const rootLeft = rootRect.left;
    const rootTop = rootRect.top;
    const rootWidth = rootRect.width || 1;
    const rootHeight = rootRect.height || 1;
    const slideWidth = slideRect.width || rootWidth;
    const slideHeight = slideRect.height || rootHeight;
    const naturalRatio = naturalWidth / Math.max(1, naturalHeight);
    const boxRatio = slideWidth / Math.max(1, slideHeight);
    let visibleWidth = slideWidth;
    let visibleHeight = slideHeight;
    if (boxRatio > naturalRatio) visibleWidth = slideHeight * naturalRatio;
    else visibleHeight = slideWidth / naturalRatio;
    return {
      left: slideRect.left - rootLeft + (slideWidth - visibleWidth) / 2,
      top: slideRect.top - rootTop + (slideHeight - visibleHeight) / 2,
      width: visibleWidth,
      height: visibleHeight,
      rootWidth,
      rootHeight
    };
  }

  function createDrawingOverlay(options) {
    const root = options.root;
    const slide = options.slide;
    const getSlideIndex = options.getSlideIndex || (() => 0);
    const emitStroke = options.emitStroke || (() => {});
    const color = options.color || DEFAULT_COLOR;
    const width = options.width || DEFAULT_WIDTH;
    const opacity = typeof options.opacity === "number" ? clamp01(options.opacity) : DEFAULT_OPACITY;
    const ttl = options.ttl || DEFAULT_TTL;
    const zIndex = options.zIndex || 2;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    const strokes = [];
    let interactive = false;
    let drawing = false;
    let currentPoints = [];
    let currentSlideIndex = 0;
    let frame = 0;
    let lastWidth = 0;
    let lastHeight = 0;

    canvas.className = "drawing-overlay";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.zIndex = String(zIndex);
    canvas.style.mixBlendMode = "multiply";
    canvas.style.pointerEvents = "none";
    canvas.style.touchAction = "none";
    canvas.style.userSelect = "none";
    root.appendChild(canvas);

    function resizeCanvas() {
      const rect = root.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const widthPx = Math.max(1, Math.round(rect.width * ratio));
      const heightPx = Math.max(1, Math.round(rect.height * ratio));
      if (widthPx === lastWidth && heightPx === lastHeight) return;
      lastWidth = widthPx;
      lastHeight = heightPx;
      canvas.width = widthPx;
      canvas.height = heightPx;
    }

    function pointFromEvent(event) {
      const rect = getSlideRect(root, slide);
      const point = {
        x: (event.clientX - root.getBoundingClientRect().left - rect.left) / Math.max(1, rect.width),
        y: (event.clientY - root.getBoundingClientRect().top - rect.top) / Math.max(1, rect.height)
      };
      if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
      return normalizePoint(point);
    }

    function addPoint(event) {
      const point = pointFromEvent(event);
      if (!point) return false;
      const previous = currentPoints[currentPoints.length - 1];
      if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.003) currentPoints.push(point);
      return true;
    }

    function begin(event) {
      if (!interactive) return;
      const point = pointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      drawing = true;
      currentSlideIndex = getSlideIndex();
      currentPoints = [point];
      canvas.setPointerCapture?.(event.pointerId);
    }

    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      if (addPoint(event)) draw();
    }

    function end(event) {
      if (!drawing) return;
      event.preventDefault();
      addPoint(event);
      drawing = false;
      canvas.releasePointerCapture?.(event.pointerId);
      if (currentPoints.length < 2) {
        currentPoints = [];
        draw();
        return;
      }
      const stroke = {
        slideIndex: currentSlideIndex,
        points: currentPoints.map(normalizePoint),
        color,
        width,
        createdAt: Date.now(),
        ttl
      };
      addStroke(stroke);
      emitStroke(stroke);
      currentPoints = [];
    }

    function addStroke(stroke) {
      const points = Array.isArray(stroke?.points) ? stroke.points.map(normalizePoint).slice(0, 240) : [];
      if (points.length < 2) return;
      strokes.push({
        slideIndex: Number(stroke.slideIndex),
        points,
        color: stroke.color || color,
        width: Number(stroke.width) || width,
        opacity: typeof stroke.opacity === "number" ? clamp01(stroke.opacity) : opacity,
        createdAt: Number(stroke.createdAt) || Date.now(),
        ttl: Math.max(1200, Math.min(8000, Number(stroke.ttl) || ttl))
      });
      if (!frame) frame = requestAnimationFrame(tick);
    }

    function clearExpired(now) {
      for (let index = strokes.length - 1; index >= 0; index -= 1) {
        const stroke = strokes[index];
        if (now - stroke.createdAt > stroke.ttl + FADE_MS) strokes.splice(index, 1);
      }
    }

    function drawPath(points, stroke, alpha) {
      if (points.length < 2) return;
      const rect = getSlideRect(root, slide);
      const ratio = window.devicePixelRatio || 1;
      context.save();
      context.globalAlpha = alpha * (typeof stroke.opacity === "number" ? stroke.opacity : opacity);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = stroke.color || color;
      context.lineWidth = Math.max(2, Math.min(rect.width, rect.height) * (stroke.width || width)) * ratio;
      context.shadowColor = "rgba(0, 0, 0, .20)";
      context.shadowBlur = 4 * ratio;
      context.beginPath();
      points.forEach((point, index) => {
        const x = (rect.left + point.x * rect.width) * ratio;
        const y = (rect.top + point.y * rect.height) * ratio;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.restore();
    }

    function draw() {
      resizeCanvas();
      context.clearRect(0, 0, canvas.width, canvas.height);
      const now = Date.now();
      const slideIndex = getSlideIndex();
      strokes.forEach((stroke) => {
        if (stroke.slideIndex !== slideIndex) return;
        const age = now - stroke.createdAt;
        const fadeStart = stroke.ttl - FADE_MS;
        const alpha = age <= fadeStart ? 1 : Math.max(0, 1 - (age - fadeStart) / FADE_MS);
        drawPath(stroke.points, stroke, alpha);
      });
      if (drawing && currentSlideIndex === slideIndex) drawPath(currentPoints, { color, width, opacity }, 1);
    }

    function tick() {
      frame = 0;
      clearExpired(Date.now());
      draw();
      if (strokes.length || drawing) frame = requestAnimationFrame(tick);
    }

    function setInteractive(value) {
      interactive = Boolean(value);
      canvas.style.pointerEvents = interactive ? "auto" : "none";
      canvas.style.cursor = interactive ? "crosshair" : "default";
      if (!interactive) {
        drawing = false;
        currentPoints = [];
        draw();
      }
    }

    function refresh() {
      draw();
      if (!frame && strokes.length) frame = requestAnimationFrame(tick);
    }

    canvas.addEventListener("pointerdown", begin);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    window.addEventListener("resize", refresh);
    slide.addEventListener("load", refresh);

    refresh();

    return { canvas, addStroke, setInteractive, refresh };
  }

  window.ImmersaDrawingOverlay = { create: createDrawingOverlay };
})();
