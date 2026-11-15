const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../public/live-guests/slide-zoom");

function mount() {
  function target() {
    const handlers = new Map();
    return { handlers, addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); } };
  }
  const held = new Set(), classes = new Set(), properties = new Map();
  const surface = Object.assign(target(), {
    classList: { contains: name => classes.has(name) },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }),
    setPointerCapture: id => held.add(id), hasPointerCapture: id => held.has(id), releasePointerCapture: id => held.delete(id)
  });
  const image = Object.assign(target(), { hidden: false, naturalWidth: 1600, naturalHeight: 900,
    getAttribute: () => "/slide.jpg", style: { setProperty: (key, value) => properties.set(key, value) } });
  const view = target();
  const zoom = create({ surface, image, view });
  function send(type, input = {}, node = surface) {
    const event = { type, pointerId: 1, button: 0, target: image, clientX: 300, clientY: 150, timeStamp: 0,
      preventDefault() { this.prevented = true; }, stopPropagation() {}, ...input };
    node.handlers.get(type)?.(event);
    return event;
  }
  return { image, surface, view, held, classes, zoom, send, scale: () => Number(properties.get("--guest-zoom") || 1), x: () => parseFloat(properties.get("--guest-pan-x") || 0) };
}

test("guest slide pinches around its midpoint and clamps scale and drag to the fitted image", () => {
  const app = mount();
  app.send("pointerdown", { pointerId: 1, clientX: 200 });
  app.send("pointerdown", { pointerId: 2, clientX: 400 });
  app.send("pointermove", { pointerId: 1, clientX: 100 });
  app.send("pointermove", { pointerId: 2, clientX: 500 });
  assert.equal(app.scale(), 2);
  assert.equal(app.x(), 0);
  app.send("pointermove", { pointerId: 2, clientX: 2200 });
  assert.equal(app.scale(), 4);
  app.send("pointerup", { pointerId: 2, clientX: 2200 });
  app.send("pointermove", { pointerId: 1, clientX: 10000 });
  assert.ok(app.x() <= (1600 / 3 * 4 - 600) / 2 + .001);
  app.zoom.reset();
  assert.equal(app.scale(), 1);
  assert.equal(app.x(), 0);
  assert.equal(app.held.size, 0);
});

test("double tap zooms and restores, wheel and keyboard stay local to the visible slide", () => {
  const app = mount();
  function tap(time) { app.send("pointerdown", { timeStamp: time }); app.send("pointerup", { timeStamp: time + 10 }); }
  tap(100); tap(220);
  assert.equal(app.scale(), 2);
  tap(1000); tap(1120);
  assert.equal(app.scale(), 1);
  const wheel = app.send("wheel", { deltaY: -Math.log(2) / .002, deltaMode: 0 });
  assert.ok(Math.abs(app.scale() - 2) < .00001);
  assert.equal(wheel.prevented, true);
  app.send("keydown", { key: "0" }, app.image);
  assert.equal(app.scale(), 1);
  app.classes.add("has-public-content");
  assert.equal(app.send("wheel", { deltaY: -300 }).prevented, undefined);
  app.send("pointerdown");
  assert.equal(app.held.size, 0);
  assert.equal(app.scale(), 1);
  app.classes.clear();
  app.image.hidden = true;
  app.send("wheel", { deltaY: -300 });
  assert.equal(app.scale(), 1);
});

test("cancel, resize and destruction clean up captures and preserve a usable next gesture", () => {
  const app = mount();
  app.send("pointerdown"); app.send("pointercancel");
  assert.equal(app.held.size, 0);
  app.send("keydown", { key: "+" }, app.image);
  assert.equal(app.scale(), 1.25);
  app.view.handlers.get("resize")();
  assert.equal(app.scale(), 1);
  app.send("pointerdown");
  app.zoom.destroy();
  assert.equal(app.held.size, 0);
  assert.equal(app.surface.handlers.size, 0);
  assert.equal(app.image.handlers.size, 0);
  assert.equal(app.view.handlers.size, 0);
});
