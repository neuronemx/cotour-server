# Selfie — Beta v1

Speaker → Interacciones → Selfie → Lanzar Selfie. Each connected audience member receives a stable image from the Deck collection. Closing the controls panel keeps the round active, allowing the speaker to open Audiovisual, play the PING camera FX, and use a separate camera/device for the actual photograph. The optional second photograph uses the same assigned images. Cerrar Selfie ends the round.

Home → Deck → Selfie supports replacing or appending multiple PNG/JPG/WebP images, deleting individual images, and restoring the default collection. Up to 20 images, 5 MB each, dimensions up to 4096 × 4096; suggested portrait size 1080 × 1920. The bundled 10 SVG faces are explicitly temporary demo artwork, pending Arturo's PING assets.

## Runtime and persistence

- A registered `activity:selfie` uses the shared session lock and active-interaction coordinator. Start uses existing polls permission; close remains available to controllers.
- Only presenter/stage sockets can start/close. The current feature exposes controls in Speaker; Stage UI integration belongs to the Events follow-up.
- A shuffled cycle balances assignments. The round snapshots its collection and keeps audience-ID assignments through reconnects. Late arrivals get an image from that same snapshot.
- `selfie.json` and immutable `selfie-assets` live with each Deck. Collection changes use a revision check and atomic rename, independently of `interactions.json`.
- Replacing/deleting a collection entry retains its immutable asset, so an active round cannot lose its image. Assets are removed with the Deck; repeated edits can retain unused files until then.
- Collection routes require account ownership; writes additionally validate the same origin. Existing binary image validation rejects unsupported or disguised uploads.
- Session lifecycle reset, finish, and inactivity shutdown clear Selfie. A server restart ends the in-memory round; persisted Deck collections survive.
- No camera access, uploads of attendee photographs, automatic photo capture, automatic flash, or automatic second phase. PING video playback remains an independent Audiovisual action.

## Validation

810 Node tests pass locally, including collection HTTP authorization/origin checks, binary validation, revision conflicts, persistence, balanced distribution, late arrival, reconnect, competing interactions, and cross-room isolation. Updated existing structural/cache-version assertions to include the new Speaker renderer.

A browser smoke attempt could not run because the Chromium download was unavailable in the execution environment. Real iPhone/Android and venue visual checks remain required: launch, full viewport image, refresh/reconnect, opening Audiovisual during a round, replaying FX, closing Selfie, and representative screen/photo visibility. No live Beta deployment is claimed by local checks.

## Events 2.0 follow-up

Reuse the same runtime and audience rendering. Add event-owned collection management to Centro de Producción, explicit Deck/event collection precedence, Stage controls, and event/room isolation verification against the current Events architecture. These event-level features are not part of this Beta PR.

## Global PING collection

Home → Deck → Selfie includes an administrator-only “Administrar colección PING · IMMERSA” section. The global collection uses `/api/admin/selfie/ping`, with existing account/admin authorization and same-origin checks. Assets and revisioned configuration persist under `IMMERSA_DATA_DIR/selfie-ping`; assets have immutable public URLs. Start with any number of images up to 20 and append or delete individual images.

Decks without custom images inherit the latest global collection. Uploading a first custom image automatically switches that Deck to its own collection; subsequent uploads append. Deleting all custom images restores inheritance. No selection between global/custom is needed. Active rounds keep their snapshot and assigned images until closed.

The shared editor no longer exposes a replace/append selector. The global editor stays hidden for ordinary accounts and the server independently enforces administrator permissions. Validation includes seven-image inheritance, updates, custom Deck independence, reload persistence, admin/origin denial and upload limits. Full suite: 812 tests pass.

Portrait artwork at 1080 × 1920 remains displayed with `object-fit: contain`. Taller phone viewports can leave black bars; this update preserves complete artwork rather than cropping it.
