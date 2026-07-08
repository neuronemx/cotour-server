# Interactions v1

## Overview

Interactions is the generic module for live audience activities in Immersa. The current visible feature is live polls, but the technical model should remain interaction-based instead of poll-specific.

Future interaction types may include quizzes, exams, timed decision exercises, per-attendee results, and final scoring. Naming in code, data, sockets, and documentation should keep using generic interaction language so these future types can fit without renaming the foundation.

## Roles

- Home prepares interactions for a deck.
- Speaker launches an interaction, reveals or hides results on Screen, and closes the active interaction.
- Audience responds once per active interaction.
- Screen only shows results after Speaker reveals them.
- Stage observes live results.

## Data Flow

Home writes deck interactions through backend endpoints. Saved interactions are stored as `/decks/{deckId}/interactions.json` for the deck, using the backend as the write path.

Speaker reads deck interactions for the active deck. If no real interactions exist, Speaker may use the fallback demo interaction so the feature remains testable. Home must never show that fallback demo as saved deck content.

Audience response locking is keyed by `session_id + interaction_id + audience_id`. A user who already responded should stay locked after refresh, after opening another tab in the same browser, and after Speaker hides Screen results.

Screen does not calculate results. Result counts and percentages are calculated server-side and sent to Screen only when results are revealed.

## Backend Endpoints

### `GET /api/decks/:deckId/interactions`

Returns real deck interactions only.

If no `interactions.json` file exists for the deck, the response is:

```json
{
  "deck_id": "<deckId>",
  "interactions": []
}
```

This endpoint must not return the Speaker fallback demo.

### `PUT /api/decks/:deckId/interactions`

Writes real deck interactions for the deck.

For converted decks, the file is saved to:

```text
DATA_DECKS_DIR/{deckId}/interactions.json
```

Speaker fallback behavior is separate from the Home API. The fallback demo is not persisted by this endpoint and should not appear in Home as saved content.

## Socket Behavior

Main interaction events:

- `interaction:launch`
- `interaction:active`
- `interaction:state`
- `interaction:submit_response`
- `interaction:response_accepted`
- `interaction:response_rejected`
- `interaction:results_updated`
- `interaction:close`
- `interaction:closed`
- `interaction:reveal_results`
- `interaction:show_results`
- `interaction:hide_results`

Speaker and Stage receive live result updates.

Audience does not receive results. Audience receives the active interaction and response acceptance or rejection state.

Screen receives results only after Speaker reveals them. While results are revealed, new responses should update Screen with the latest server-calculated totals. When results are hidden, Screen should clear the results overlay and must not show new updates until Speaker reveals again.

When results are hidden, Audience state must not reset. A user who already responded must keep the fixed response and disabled controls.

Closing an interaction is different from hiding results. Closing cleans Audience and Screen.

## Manual Test Checklist

### A. Home Editor

- [ ] Create a poll.
- [ ] Refresh Home and confirm it persists.
- [ ] Edit the poll.
- [ ] Delete the poll.
- [ ] Confirm Speaker falls back to demo when all interactions are deleted.

### B. Speaker Launch

- [ ] Speaker lists deck interactions.
- [ ] Speaker launches selected interaction.
- [ ] Audience receives selected interaction.
- [ ] Launching Pregunta 1 and Pregunta 2 must not fall back to demo when real interactions exist.

### C. Audience Response Lock

- [ ] Audience votes once.
- [ ] Refresh Audience.
- [ ] Open same Audience in another tab.
- [ ] Confirm vote remains locked.
- [ ] Hide results and confirm vote remains locked.

### D. Screen Reveal/Hide

- [ ] Screen stays clean before reveal.
- [ ] Reveal shows results.
- [ ] New responses update Screen while revealed.
- [ ] Hide clears Screen without closing the poll.
- [ ] Reveal again shows latest results.
- [ ] Close clears Audience and Screen.

### E. Regression Checks

- [ ] Slide sync still works.
- [ ] Drawing still works.
- [ ] Reactions still works.
- [ ] Home editor still works.
- [ ] No duplicate voting.

## Known Design Rules

- Close is not the same as hide.
- Hide affects Screen only.
- Home prepares; Speaker operates.
- One active interaction per session for v1.
- Fallback demo is only for Speaker/testability when no real interactions exist.
- Do not merge temporary deck fixtures from Railway environments.

## Future Roadmap

- Slide assignment
- Timers
- Correct answers
- Scoring
- Per-attendee results
- Database persistence
- CSV/export
- Exams/quizzes
