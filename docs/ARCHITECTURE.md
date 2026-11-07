# Architecture

```
 Browser (Angular)                       Game server (Node + tsx, port 3001)
 ┌──────────────────────────┐            ┌────────────────────────────────────────────────┐
 │ Components               │  POST      │ main.ts      HTTP routes, SSE                   │
 │   read GameClient        │ ─────────► │ rooms.ts     open tables by code                │
 │   signals                │            │ room.ts      one table: engine, turns, chat,    │
 │ GameClient ◄─────────────┼─ SSE ───── │              moods, timers, knockouts           │
 │   (your view only)       │            │ ai.ts        caps + fallbacks around Gemini ────┼──► Gemini
 └──────────────────────────┘            │ prompts.ts   prompt text and JSON schemas       │
        shared code ─────────────────────│ gemini.mjs   SDK calls, cooldown, usage caps    │
 src/app/poker  src/app/game             │ history-store.ts  memories saved per name       │
 src/app/shared src/app/ai               └────────────────────────────────────────────────┘
```

The **server runs every table**. Browsers get their own view of the table over Server-Sent
Events (one stream per player) and send actions with POST. This lets several people share a
table, keeps each player's cards private (other hands are blanked before sending), and keeps the
Gemini key on the server. The Angular dev server proxies `/api` to the game server.

The server is TypeScript run by `tsx`. It imports the same engine and game code as the browser
(`src/app/poker`, `src/app/game`, `src/app/shared`, `src/app/ai`), so the rules can't drift apart.

## Poker engine (`src/app/poker/`)

Plain TypeScript, covered by `npm test`.

- `cards.ts`: cards, deck, shuffle, a seeded RNG for tests.
- `evaluator.ts`: best 5 of 7 cards as a single comparable score, plus a readable description.
- `equity.ts`: Monte Carlo win chance. `estimateWinChanceVsRanges` samples opponents from the top
  X% of starting hands (ranked by Chen score), so a bot can judge a hand against how a specific
  player bets.
- `engine.ts`: `PokerEngine` enforces the rules: blinds (heads-up too), minimum raises, short
  all-ins, uncalled bets, side and split pots, running out the board, busting. Between rounds,
  `replaceSeat` and `setBlinds` support the rotating cast and rising blinds.

## A table (`server/room.ts`)

- **Lobby:** the host creates a room (4-letter code); up to 4 humans join. Each gets a random
  token used for every request. The host starts the game; humans are spread around the table and
  AI seats fill the rest (6 seats max).
- **Turns:** after every change, the room either runs bot turns (`runBots`) or starts the human's
  turn timer (45 s, 5 s if they've disconnected). Timeouts check, or fold if they can't.
- **Bot turns:** wait for any whisper reply or announcement reaction still on its way, build the
  bot's context (`contextFor`: its view of the table, its whispers with each human, recent
  announcements, its mood), then ask `ai.decide`. The answer is clamped to a legal move
  (`toLegalAction`) so a bad reply can't break the game.
- **Whispers** (`sendMessage`): one per human per AI per round. One Gemini call returns the reply,
  a sway percentage, what the AI now leans toward, and whether the message warmed or cooled its
  feelings about the sender.
- **Announcements** (`announce`): one per human per round. One Gemini call voices every AI still
  in the hand (`reactionPrompt`), each with a sway reading.
- **End of round** (`endRound`): a one-line summary for the bots, every hand revealed to their
  memory (`PlayerHistory.endRound`), each human's memory saved by name, moods updated, busted AIs
  counted as knockouts and replaced, and the win check. With two or more humans the next round
  starts when everyone is ready or after 15 s.
- **Views** (`stateFor`): each subscriber gets a `ClientState` with the deck removed and other
  players' cards blanked (rank 0) unless they were shown at showdown. Thoughts are only included
  once the round is over. Broadcasts are coalesced per tick.

## What the AIs remember (`src/app/game/player-history.ts`)

Compaction keeps every prompt small, with no extra AI calls:

- Betting stats per player (played, raised, shoved, weak raises) decay by 5% a round.
- The starting hands behind each player's raises are kept as percentiles (last 20). A player who
  raises junk gets a wide range, so the bots call them down.
- Per AI and human: whisper counts, big-hand claims checked against the revealed cards (true or
  bluff), up to 3 one-line notes, and a feeling from -1 to 1.
- `profileFor` turns that into a few lines per human for the prompt. `exportPlayer` and
  `importPlayer` save and restore one human between games (`server/history-store.ts`,
  `.data/history.json`).

Moods (`updateMoods` in `room.ts`) come from each AI's chip swing in the last round: lose 40% and
it's tilted, lose 15% and it's shaken, win 50% and it's on a heater. Moods fade after a few rounds.
Tilt also loosens the built-in logic (`moodStyle` in `ai.ts`).

## Gemini calls (`server/ai.ts`, `server/gemini.mjs`)

Every call goes through `attempt()`: is Gemini configured and working, is it cooling down after a
busy error, is a usage cap reached. If not, the built-in logic answers and the players see a
short note. Calls use structured output (JSON schemas in `prompts.ts`); `plainText()` strips em
dashes and stray quotes from anything shown on screen.

## API

All POST bodies are JSON (capped at 64 kB) and carry the player token in `X-Player-Token`.

| Route                                   | Body                 | Returns                                                            |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `GET /api/health`                       |                      | `{ ok, ai: { enabled, model, reason, usedToday, perDay } }`        |
| `POST /api/rooms`                       | `{ name, settings }` | `{ code, token }`                                                  |
| `POST /api/rooms/:code/join`            | `{ name }`           | `{ code, token }`                                                  |
| `GET /api/rooms/:code/events?token=`    |                      | SSE: a `ClientState` on every change                               |
| `POST /api/rooms/:code/start`           |                      | host only                                                          |
| `POST /api/rooms/:code/act`             | `{ action }`         | `{ type: 'fold' \| 'check' \| 'call' }` or `{ type: 'raise', to }` |
| `POST /api/rooms/:code/message`         | `{ botId, text }`    | resolves after the reply                                           |
| `POST /api/rooms/:code/announce`        | `{ text }`           | resolves after the reactions                                       |
| `POST /api/rooms/:code/ready` / `leave` |                      |                                                                    |
| `GET /api/history?name=`                |                      | `{ rounds }` remembered for that name                              |
| `POST /api/history/forget`              | `{ name }`           | forget that name                                                   |

Errors come back as `{ error }` with 400 (bad input), 401 (bad token), 403 (not the host),
404 (no such table), 409 (not now: wrong turn, limit used), 415 (not JSON) or 5xx. Types for all
of this: `src/app/shared/protocol.ts`.

## Adding a character

Add an entry to `CHARACTERS` in `src/app/shared/personas.ts`: name, colors, the hint shown to
players (`weakSpot`), the prompt text (`bio`, `voice`, `style`, `persuasion`) and the built-in
style for offline play. Give it one clear lever and one thing that backfires.

## Known limitations

- Tables live in memory: restarting the server ends every game (memories of players are saved).
- One server process. Fine for a hackathon; a bigger deployment would need shared room storage.
- The daily usage count resets at the server's local midnight; Google's free tier resets on
  Pacific time.
