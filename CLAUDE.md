# Project notes — Will AI Beat Us? (HackComs Fall 2026)

Self-reference notes for future sessions (Claude Code and teammates). Keep this short and current:
update **Progress log** and **Decisions** whenever something meaningful changes.

## What this is

A browser poker game (No-Limit Texas Hold'em). One human plays against four AI characters
powered by Claude. The twist: each round, the human may send **one private chat message to each
AI player** to talk them into folding or raising. Each character reacts to persuasion differently.

## Stack

- **Frontend:** Angular 21 (standalone components, signals, zoneless — no zone.js). `src/app/`
- **Backend:** tiny Node server (`server/`, plain ESM JS, no framework) that holds the API key and
  calls Claude through `@anthropic-ai/sdk`. The Angular dev server proxies `/api` to it.
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

- `src/app/poker/` — engine: cards, hand evaluator, equity simulation, table state machine. No Angular.
- `src/app/ai/` — persona display data, request types, HTTP client, offline fallback bots.
- `src/app/game/` — `GameService`: runs the table, bot turns, chat, message limits (signals).
- `src/app/components/` — UI pieces (table, seat, card, action bar, chat panel, log, overlays).
- `server/` — `index.mjs` (HTTP + routes), `claude.mjs` (API calls), `prompts.mjs` + `personas.mjs`.

## Conventions

- Persona `id`s must match between `src/app/ai/personas.ts` (UI + offline style) and
  `server/personas.mjs` (prompt text).
- The engine is the source of truth for legal moves. Bot replies from Claude are clamped to legal
  actions client-side, so a bad model reply can never break the game.
- Keep component CSS under the 4 kB budget warning in `angular.json`; shared styles live in
  `src/styles.css`.
- Default model `claude-opus-5-5` at effort `low` (latency matters in a turn-based game);
  override with `POKER_AI_MODEL` / `POKER_AI_EFFORT` in `.env`. Server-side refusal fallbacks are on.

## Secrets

- API key lives only in `.env` (git-ignored, `chmod 600`), read only by `server/env.mjs`. Never in
  `src/` (ships to the browser). Details and contributor rules: `docs/SECURITY.md`.
- Server binds to `127.0.0.1` and rejects non-JSON POSTs, so the network and other websites
  can't spend credits.

## Decisions

- "Round" = one hand. The human gets 1 message per AI per hand (`MESSAGE_LIMIT` config in
  `src/app/game/game.config.ts` can switch the reset to every betting street).
- Messages are private 1:1 (each bot only sees its own conversation), max 280 characters.
- Bots' private "thoughts" are revealed after each hand so the player can see if persuasion worked.
- No API key → game still works: bots use a heuristic (win chance vs pot odds) and canned replies.

## Progress log

- 2026-11-07 — Branch `feature/poker-game`. Added deps (`@anthropic-ai/sdk`, `vitest`,
  `concurrently`), dev tooling, this file.
