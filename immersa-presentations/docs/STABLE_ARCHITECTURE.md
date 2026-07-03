# Immersa Stable Architecture Checkpoint

Validated after PR #45, #46, #47 and #48.

## Stable routes

- Speaker: `/speaker/:access_token`
- Screen: `/screen/:access_token`
- Stage: `/stage/:access_token`
- Publico / Immersa Live: `/p_...`

## Core concepts

- `session_id` identifies the presentation.
- `access_token` authorizes role access.
- `role` defines the experience.
- `public_id` / `public_url` is the only public link format for Publico / Immersa Live.
- Publico must never receive or expose `access_token`.
- `session_id` + `deck` must never authorize direct access.
- Do not use `code`.

## Stable behavior

- Speaker, Screen and Stage tokens do not overwrite each other.
- Role cookies are scoped by role.
- Speaker, Screen and Stage open and refresh correctly.
- Publico / Immersa Live loads through `/p_...` and keeps a clean public URL.
- Public QR uses `/p_...`.
- Stage opens with reactions ON.
- Stage QR overlay renders over the slide.
- Text messages render in Screen, Stage and Publico / Immersa Live.
- Mobile Audience reconnects after sleep.
- "Conexion pausada" is only a fallback notice while reconnecting or if reconnection fails.
- Invalid public links return controlled 404.

## Do not modify without explicit reason

Do not modify these stable areas unless the task explicitly requires it:

- role-token authorization flow
- role-scoped cookies
- legacy route guard
- public URL masking
- `public_id` / `public_url` generation and reuse
- public QR generation
- Stage QR overlay
- Audience mobile reconnect
- Live text message rendering

## Regression checks before future releases

Before merging future PRs that touch role access, live state, QR, overlays or Audience:

- `/speaker/:token` opens and refreshes.
- `/screen/:token` opens and refreshes.
- `/stage/:token` opens and refreshes.
- `/p_...` opens Immersa Live and keeps the URL clean.
- Stage starts with reactions ON.
- Stage QR ON shows QR over the slide.
- Stage QR OFF hides QR.
- Text messages appear in Screen, Stage and Publico.
- Mobile Audience reconnects after sleep.
- `/presenter/?session=...&deck=...` direct access remains blocked.
- `/stage/?session=...&deck=...` direct access remains blocked.
- `/p_1234567890` returns controlled 404.
