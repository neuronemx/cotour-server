const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../public/live-guests/event-audio");

test("Screen return keeps one output track, replaces inputs safely and excludes the guest voice", async t => {
  const oldMediaStream = global.MediaStream;
  global.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } };
  t.after(() => { global.MediaStream = oldMediaStream; });
  const track = () => ({ readyState: "live", stop() { this.readyState = "ended"; } });
  const stream = () => { const tracks = [track()]; return { getAudioTracks: () => tracks, getTracks: () => tracks }; };
  const output = stream();
  let fail = false, lost = 0, guestCaptures = 0, captures = 0;
  const inputs = [];
  const sources = [];
  const node = () => ({ connect() { return this; }, disconnect() { this.disconnected = true; } });
  const mixer = create({
    context: {
      createMediaStreamDestination: () => ({ stream: output }),
      createMediaStreamSource(value) { const n = { ...node(), value }; sources.push(n); return n; },
      createGain: () => ({ ...node(), gain: { value: 0 } })
    },
    document: { querySelectorAll: () => [
      { paused: false, muted: false, volume: .6, closest: () => null, captureStream() { captures++; return stream(); } },
      { paused: false, muted: false, volume: 1, closest: () => ({}), captureStream() { guestCaptures++; return stream(); } }
    ] },
    mediaDevices: { async getUserMedia() { if (fail) throw Error("device missing"); const next = stream(); inputs.push(next); return next; } },
    onLost: () => lost++
  });
  t.after(() => mixer.stop());
  await mixer.setInput("mic");
  const stable = mixer.stream.getAudioTracks()[0];
  fail = true;
  await assert.rejects(mixer.setInput("missing"));
  assert.equal(inputs[0].getAudioTracks()[0].readyState, "live");
  fail = false;
  await mixer.setInput("console");
  assert.equal(inputs[0].getAudioTracks()[0].readyState, "ended");
  assert.equal(mixer.stream.getAudioTracks()[0], stable);
  mixer.setIncludeMedia(true);
  assert.equal(captures, 1);
  assert.equal(guestCaptures, 0);
  sources.at(-1).value.getAudioTracks()[0].stop();
  mixer.setIncludeMedia(true);
  assert.equal(captures, 2);
  mixer.setIncludeMedia(false);
  assert.ok(sources.at(-1).disconnected);
  inputs[1].getAudioTracks()[0].onended();
  assert.equal(lost, 1);
});
