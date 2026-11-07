# Project notes: Will AI Beat Us? (HackComs Fall 2026)

Self-reference notes for future sessions (Claude Code and teammates). Keep this short and current:
update **Progress log** and **Decisions** whenever something meaningful changes.

## What this is

A browser poker game (No-Limit Texas Hold'em). One human plays against four AI characters
powered by **Google Gemini**. The twist: each round, the human may send **one private chat
message to each AI player** to talk them into folding or raising. Each character reacts to
persuasion differently.

## Team preferences (read these)

- **Gemini only for now.** The team only has a Gemini key. Don't add other AI providers until
  asked. (A Claude version of the server existed briefly; see commit `0fda495` if it's ever needed.)
- **Free-tier key: keep calls low.** Never loop or batch real API calls while testing. Prefer
  testing prompts offline (see `describeSituation` in `server/prompts.mjs`). See `docs/SECURITY.md`.
- **No em dashes or AI-sounding filler in anything shown on the front end**, including model
  output (the prompts forbid it and `plainText()` in `server/index.mjs` strips dashes).
- Write docs as you go, update this file, and commit at milestones on a feature branch.

## Stack

- **Frontend:** Angular 21 (standalone components, signals, zoneless: no zone.js). `src/app/`
- **Backend:** tiny Node server (`server/`, plain ESM JS, no framework) that holds the API key and
  calls Gemini through `@google/genai`. The Angular dev server proxies `/api` to it.
- **Tests:** Vitest for the pure-TypeScript poker engine (`npm test`).

## Commands

| Command          | What it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `npm run dev`    | API server (port 3001) + Angular dev server (port 4200)       |
| `npm run server` | API server only                                               |
| `npm start`      | Angular dev server only (bots use offline logic if no server) |
| `npm test`       | Engine unit tests (Vitest)                                    |
| `npm run build`  | Production build to `dist/`                                   |

Install note: npm 10 crashes on this lockfile ("Cannot read properties of null (reading
'edgesOut')"). Use npm 11 (`npx npm@11 install ...`), which `package.json` already declares.

## Layout

See `docs/ARCHITECTURE.md` for the full picture. Quick map:

- `src/app/poker/`: engine. Cards, hand evaluator, equity simulation, table state machine. No Angular.
- `src/app/ai/`: persona display data, request types, HTTP client, offline fallback bot.
- `src/app/game/`: `GameService` runs the table, bot turns, chat and message limits (signals).
- `src/app/components/`: UI pieces (table, seat, card, action bar, chat panel, log, result panel).
- `server/`: `index.mjs` (HTTP + routes), `gemini.mjs` (API calls, cooldown), `usage.mjs` (caps),
  `prompts.mjs` + `personas.mjs` (prompt text), `env.mjs` (loads `.env`).

## Conventions

- Persona `id`s must match between `src/app/ai/personas.ts` (UI + offline style) and
  `server/personas.mjs` (prompt text).
- The engine is the source of truth for legal moves. Model replies are clamped to legal actions
  client-side (`toLegalAction`), so a bad reply can never break the game.
- Keep component CSS under the 4 kB budget warning in `angular.json`; shared styles live in
  `src/styles.css`.
- Default model `gemini-3.5-flash-lite`, low thinking, 1024 max output tokens.
  `gemini-2.5-flash` is closed to new keys and `gemini-3.8-flash` returned 503 "high demand" on
  the free tier (2026-11-07). Override with `POKER_GEMINI_MODEL`.

## Secrets and usage

- The key lives only in `.env` (git-ignored, `chmod 600`), read only by `server/env.mjs`. Never in
  `src/` (ships to the browser). Details and contributor rules: `docs/SECURITY.md`.
- Server binds to `127.0.0.1` and rejects non-JSON POSTs, so the network and other websites
  can't use the quota.
- Caps: 8 calls/min, 200/day (persisted in `.data/ai-usage.json`), 30 s cooldown after a Google
  429/503, permanent stop after a rejected key/model, SDK retries off.

## Decisions

- "Round" = one hand. The human gets 1 message per AI per hand (`messageLimit.resetEach` in
  `src/app/game/game.config.ts` can switch the reset to every betting street).
- Messages are private 1:1 (each bot only sees its own conversation), max 280 characters.
- To save quota, a bot's moves use Gemini only in rounds where the human messaged it; otherwise
  the built-in logic plays (`aiDecisions` in `game.config.ts`). Chat replies always use Gemini.
- Bots' private "thoughts" are revealed after each hand so the player can see if persuasion worked.
- No key or AI unavailable: the game still works. Bots use a heuristic (win chance vs pot odds)
  and canned replies.

## Progress log

- 2026-11-07: Branch `feature/poker-game`.
  - Dev tooling, this file. Engine + 34 Vitest tests (hand ranks, side pots, short all-ins,
    200-hand chip-conservation run).
  - API server with security hardening (loopback bind, JSON-only POST, `.env` permission check).
  - Switched the AI from Claude to Gemini at the team's request, with usage caps, cooldown and a
    hard stop on rejected key/model. Live testing used 5 Gemini calls in total (2x 404 on
    gemini-2.5-flash, 1 timeout + 1 503 on gemini-3.8-flash, 1 success on 3.5-flash-lite).
  - Full UI: start screen, table, action bar, chat panel, log, result panel with bot thoughts.
    Checked in headless Chrome at 1440px and 390px, offline and against the real server with the
    cap reached (0 Gemini calls).
  - Docs: README (setup, play, settings), docs/ARCHITECTURE.md, docs/SECURITY.md.

## Ideas / next steps

- Live-test a few real rounds with Gemini (chat path not yet exercised live; decide path is).
- Blind increases so games end; a "fast forward" when the human has folded.
- Optional: move the engine server-side so card data isn't visible in dev tools.
