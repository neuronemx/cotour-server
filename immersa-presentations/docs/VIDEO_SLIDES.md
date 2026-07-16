# Video slides v1

Immersa can treat an MP4 as one slide in the normal presentation sequence.

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
- **Speaker:** displays the poster and provides Play/Pause, Restart and Mute controls.
- **Stage:** displays the poster and provides the same backup controls.
- **Audience:** displays the poster only. The MP4 and its audio are not downloaded or played on audience devices.

## Audio permission

When the browser blocks autoplay with sound, Screen displays **Activar sonido y multimedia**. The operator taps it once to authorize video audio.

## Current installation flow

Video slides are currently manifest-driven:

1. Place the MP4 and poster inside the deck folder.
2. Replace or insert the corresponding slide object in `manifest.json`.
3. Keep its position in the `slides` array; that array position is its presentation number.

Uploading and assigning MP4 files from Home is planned as the next layer and is not part of v1.
