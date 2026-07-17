const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '..', 'public', 'shared', 'presentation-runtime.js');
const source = fs.readFileSync(runtimePath, 'utf8');

test('Speaker wake recovery keeps presentation runtime syntactically valid', () => {
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /installSpeakerWakeRecovery/);
});

test('Trazo vivo reaffirms the presenter room before emitting a stroke', () => {
  const drawingGuard = source.indexOf('if (eventName === "drawing_stroke") ensureMainJoin();');
  const mainEmit = source.indexOf('return nativeMainEmit(eventName, ...args);', drawingGuard);
  assert.ok(drawingGuard >= 0);
  assert.ok(mainEmit > drawingGuard);
  assert.match(source, /mainSocket\.on\("disconnect", \(\) => \{ mainJoinedSocketId = ""; \}\)/);
  assert.match(source, /mainSocket\.on\("connect"/);
});

test('video and overlay commands rejoin the auxiliary Stage room after reconnect', () => {
  const overlayGuard = source.indexOf('if (eventName === "overlay_update")');
  const ensureJoin = source.indexOf('ensureControlJoin();', overlayGuard);
  const controlEmit = source.indexOf('return nativeControlEmit(eventName, ...args);', ensureJoin);
  assert.ok(overlayGuard >= 0);
  assert.ok(ensureJoin > overlayGuard);
  assert.ok(controlEmit > ensureJoin);
  assert.match(source, /controlSocket\.on\("disconnect", \(\) => \{ controlJoinedSocketId = ""; \}\)/);
  assert.match(source, /controlSocket\.on\("connect"/);
});

test('mobile visibility recovery retries both sockets without reloading Speaker', () => {
  assert.match(source, /visibilitychange/);
  assert.match(source, /pageshow/);
  assert.match(source, /\[0, 300, 1200\]/);
  assert.match(source, /if \(controlWasUsed\) ensureControlJoin\(\)/);
});
