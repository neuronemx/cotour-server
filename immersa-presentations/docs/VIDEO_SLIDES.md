# Video slides v1

Immersa can treat a local MP4 or a YouTube link as one slide in the normal presentation sequence.

## Manifest entry

```json
{
  "id": "slide-007-video",
  "type": "video",
  "src": "slides/slide-007.mp4",
  "poster": "slides/slide-007-poster.jpg",
  "thumb": "thumbs/slide-007.jpg",
  "title": "Video",
  "autoplay": true,
  "loop": false,
  "muted": false
}
```

`type: "video"` is preferred. A slide is also recognized as video when `src` ends in `.mp4`.

## Role behavior

- **Screen:** loads and plays the MP4 inside the presentation frame.
- **Speaker:** displays the poster and a centered floating controller with current position, remaining time, timeline seek, Restart, ±10 seconds, Play/Pause and Mute.
- **Stage:** displays the poster and the same synchronized backup controller.
- **Audience:** displays the poster only. The MP4 and its audio are not downloaded or played on audience devices.

Screen is authoritative for playback telemetry because only Screen owns the real local or YouTube player. It sends ephemeral position, duration, playing and mute snapshots to Speaker and Stage; these values are not written to presentation History.

## Audio permission

When the browser blocks autoplay with sound, Screen reuses the single global **Activar sonido** control. Screen reports the forced-muted playback state to Speaker and Stage so either controller can send one explicit unmute command.

## Deck configuration

From **Deck → Video**, choose the slide and one source:

- **Archivo MP4:** the file stays local and Screen validates it before presenting.
- **Link de YouTube:** accepts standard watch, `youtu.be`, Shorts, Live and Embed URLs. The normalized video ID and optional start time are stored; arbitrary embeds are rejected.

Speaker and Stage use the same synchronized controls for both sources. YouTube requires internet access and the source video must allow embedding.
