# Project notes: Will AI Beat Us? (HackComs Fall 2026)

Self-reference notes for future sessions (Claude Code and teammates). Keep this short and current:
update **Progress log** and **Decisions** whenever something meaningful changes.

## What this is

A multiplayer browser poker game (No-Limit Texas Hold'em). Up to 4 humans play against AI
players powered by **Google Gemini**. Each round a human may whisper one private message to each
other player (AI or human) and make one announcement to the whole table. AIs report how much a
message swayed them, have moods and feelings, and remember each human between games. Knock out
N AIs to win. Plays over Tailscale with `npm run dev:tailnet`.

## Team preferences (read these)

- **Gemini only for now.** Don't add other AI providers until asked (a Claude server existed
  briefly: commit `0fda495`).
- **Free-tier key: keep calls low.** Never loop real API calls while testing. Test with
  `GEMINI_API_KEY=` (offline) or with the daily cap already reached; render prompts locally with
  tsx. See `docs/SECURITY.md`.
- **No em dashes or AI-sounding filler in anything on the front end**, including model output
  (prompts forbid it; `plainText()` in `server/ai.ts` strips dashes).
- **No AI is forced into the lineup.** Every game shuffles the whole cast.
- Write docs as you go, update this file, and commit at milestones on a feature branch.

## Stack

- **Frontend:** Angular 21 (standalone, signals, zoneless). A thin client: `GameClient` holds the
  `ClientState` pushed by the server over SSE and POSTs actions.
- **Backend:** Node + `tsx` (`server/*.ts`, no framework). Runs every table (`Room`), calls
  Gemini (`@google/genai`), and imports the same engine/game code as the browser.
- **Tests:** Vitest (`npm test`): engine, history/compaction, a shove-every-hand simulation.

## Commands

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `npm run dev`         | Game server (3001) + Angular dev server (4200)             |
| `npm run dev:tailnet` | Same, web server bound to this machine's Tailscale IP only |
| `npm run server`      | Game server only (`server:watch` to auto-restart)          |
| `npm test`            | Unit tests                                                 |
| `npm run typecheck`   | tsc for the app and the server                             |
| `npm run build`       | Production build                                           |

Install with npm 11 (`npx npm@11 install`); npm 10 crashes on this lockfile ("edgesOut").
Gotcha: `pgrep -f`/`pkill -f` with a pattern also matches the shell running it. Kill by port:
`kill $(lsof -t -i:3001 -sTCP:LISTEN)`. Killing `npx` can orphan its child; run
`node_modules/.bin/tsx` directly for background servers.

## Layout

See `docs/ARCHITECTURE.md`. Quick map:

- `server/`: `main.ts` (routes, SSE), `rooms.ts`, `room.ts` (the game loop), `ai.ts` (caps and
  fallbacks), `prompts.ts`, `gemini.mjs`, `usage.mjs`, `history-store.ts`, `env.mjs`.
- `src/app/poker/`: engine. `src/app/game/`: bot views, `PlayerHistory`, config, `GameClient`.
- `src/app/shared/`: `personas.ts` (the whole cast, one file), `protocol.ts` (server/browser types).
- `src/app/components/`: start screen, lobby, table, seat, card, action bar (with announcements),
  chat panel (whispers), log, round result / game over.

## Conventions

- The engine is the source of truth for legal moves; model replies go through `toLegalAction`.
- Each player's view is sanitized on the server (deck removed, other hole cards rank 0).
- Keep component CSS under the 4 kB budget warning; shared styles in `src/styles.css`.
- Default model `gemini-3.5-flash-lite`, low thinking, 1024 max output tokens.

## Decisions

- "Round" = one hand. 1 whisper per sender per recipient per round; 1 announcement per human
  per round (`game.config.ts`).
- AI moves use Gemini only in rounds where someone whispered to that AI or announced
  (`aiDecisions: 'after-message'`). One announcement = one Gemini call for all reactions.
- After every round all hole cards are revealed to the bots' memory (not to humans).
- Compaction: decayed stats, 20 raise samples, 3 notes + counters + feeling per bot/human.
- Moods from chip swings (tilted / shaken / on a heater); feelings from lies caught and whisper
  replies ("warmer"/"colder"). Saved per name in `.data/history.json`.
- Busted AIs are replaced from the shuffled cast; blinds rise every 8 rounds.
- Whispers between humans never reach the AIs and cost no Gemini calls.
- Inclusivity: AIs speak each player's chosen language and use their pronouns; banter never
  targets identity (`RESPECT_RULE` in `server/prompts.ts`). UI text stays English for now.

## Progress log

- 2026-11-07 (`feature/poker-game`): engine + tests, single-player Angular UI, Gemini server with
  usage caps, security hardening, Tailscale mode, bots that read the player (range-aware odds,
  memory, reveal after each round). Live Gemini testing used 5 calls (4 errors, 1 success).
- 2026-11-07 (`feature/multiplayer`): moved the game to the server (rooms, SSE, tokens, turn
  timer, ready-up). 13-character cast incl. Hatsune Miku, Ritchie the Tiger (RIT) and Pepsi Man,
  base Gemini mode, rotating seats, rising blinds, knockout goal, final scoreboard. Whisper sway
  %, influence % in thoughts, table announcements with one-call reactions, moods and feelings,
  human-to-human whispers. Verified with a 23-check server smoke test and a two-browser
  Playwright run (offline, 0 Gemini calls).

- 2026-11-07: Inclusivity pass. Per-player language (20, `src/app/shared/languages.ts`) for
  whispers and reactions; table language when all humans share one. Optional pronouns used in
  prompts and shown in the lobby. Respect rule in every prompt. Four-color deck + larger text
  (`DisplaySettings`, saved per browser). "How to play" dialog with hand rankings.

## Ideas / next steps

- Translate the UI itself (only the AI conversation is localized today).
- Live-test whisper and announcement prompts with a few real Gemini calls.
