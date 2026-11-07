const { randomUUID } = require("node:crypto");
const { isFx } = require("./public/shared/audiovisual-fx");

function createAudiovisualFxRuntime({ getChannel, navigate, publish, createId = randomUUID }) {
  function begin(resource, session) {
    return isFx(resource) ? {
      id: createId(), slideIndex: session.presenterSlideIndex,
      revision: session.navigationRevision || 0, consumed: false
    } : null;
  }

  async function advance(context, payload = {}) {
    if (context?.role !== "screen" || !context.session) return false;
    const session = context.session;
    const channel = getChannel(session);
    const playback = channel?.fxPlayback;
    if (!isFx(channel?.resource) || channel.status !== "playing" || !playback || playback.consumed
      || payload.playbackId !== playback.id || String(payload.resourceId) !== String(channel.resource.id)
      || !Number.isFinite(payload.mediaTime) || payload.mediaTime < channel.resource.fx.seconds) return false;
    // Claim synchronously before navigation awaits I/O: multiple Screens cannot double-step.
    playback.consumed = true;
    const stillCurrent = () => {
      const latest = getChannel(session);
      return latest?.fxPlayback?.id === playback.id && (latest.status === "playing" || (latest.status === "stopped" && latest.lastAction === "ended"))
        && !session.transmissionPaused && session.presenterSlideIndex === playback.slideIndex
        && (session.navigationRevision || 0) === playback.revision;
    };
    let advanced = false;
    if (stillCurrent()) advanced = await navigate(context, session, playback.slideIndex + 1, stillCurrent);
    publish(context, session);
    return advanced === true;
  }
  return { begin, advance };
}

module.exports = { createAudiovisualFxRuntime };
