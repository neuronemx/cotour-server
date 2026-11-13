const test = require("node:test");
const assert = require("node:assert/strict");
const { createGuestSlideReader } = require("../live-guest-slides");

function setup() {
  const session = { liveSlideIndex: 1, presenterSlideIndex: 2, transmissionPaused: true, operationalLocale: "es" };
  const manifest = { locales: { en: { active: true } }, slides: [0, 1, 2].map(index => ({
    src: `slides/${index}.jpg?v=1`, title: `Slide ${index}`, prompter: "private notes"
  })), privateRoleToken: "secret" };
  let english = { slides: manifest.slides.map(slide => ({ ...slide, title: "English" })) };
  const read = createGuestSlideReader({
    getSession: (sessionId, deckId) => { assert.equal(sessionId, "session"); assert.equal(deckId, "deck"); return session; },
    readManifest: async () => manifest,
    readEnglishManifest: async () => { if (!english) throw new Error("missing"); return english; }
  });
  return { read: snapshot => read({ sessionId: "session", deckId: "deck" }, snapshot), session, manifest, english: value => { english = value; } };
}

test("guests see the public live slide while the presenter navigates privately during a pause", async () => {
  const { read, session } = setup();
  assert.deepEqual(await read(), { index: 1, locale: "es", src: "/decks/deck/slides/1.jpg?v=1", title: "Slide 1" });
  session.presenterSlideIndex = 0;
  assert.equal((await read()).index, 1);
  session.liveSlideIndex = session.presenterSlideIndex;
  assert.equal((await read()).index, 0);
  assert.equal((await read({ liveSlideIndex: 2, operationalLocale: "es" })).index, 2);
});

test("guest slides follow the operational language with the same English fallback as Screen", async () => {
  const app = setup();
  app.session.operationalLocale = "en";
  assert.deepEqual(await app.read(), { index: 1, locale: "en", src: "/decks/deck/locales/en/slides/1.jpg?v=1", title: "English" });
  app.english({ slides: [] });
  assert.equal((await app.read()).locale, "es");
  app.english(null);
  assert.equal((await app.read()).locale, "es");
});

test("only the current relative slide is exposed, without private manifest data or arbitrary paths", async () => {
  const app = setup();
  for (const source of ["../notes.txt", "slides/../notes.txt", "slides/%2e%2e/notes.txt", "https://foreign.test/x.jpg", "slides/..%5cnotes.txt", "slides/%00.jpg", "slides/%bad.jpg"]) {
    app.manifest.slides[1].src = source;
    assert.equal(await app.read(), null, source);
  }
  app.session.liveSlideIndex = -1;
  assert.equal(await app.read(), null);
  app.session.liveSlideIndex = 10;
  assert.equal(await app.read(), null);
});
