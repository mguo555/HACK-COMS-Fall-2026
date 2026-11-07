# Will AI Beat Us?

A browser poker game for HackComs Fall 2026. You play No-Limit Texas Hold'em against four AI
characters run by Google Gemini. The twist: every round you can send each of them **one private
message** to talk them into folding, or bait them into raising. Each character falls for
different things, and after every round you can read what they were thinking.

## Quick start

You need Node.js 20.19+ or 22.12+ and a Gemini API key from
[Google AI Studio](https://aistudio.google.com/) (the free tier is enough).

```bash
npx npm@11 install                     # npm 10 crashes on this lockfile; npm 11 works
cp .env.example .env && chmod 600 .env # then paste your key after GEMINI_API_KEY=
npm run dev                            # API server on :3001 + game on :4200
```

Open <http://localhost:4200>. The page and the server log both say whether Gemini is connected.

No key? The game still runs in **offline mode**: the bots use simple built-in poker logic and
canned chat replies.

## Play from your other devices (Tailscale)

```bash
npm run dev:tailnet
```

It prints the addresses to open from any device on your tailnet, for example
`http://<machine>.<tailnet>.ts.net:4200`. In this mode the game listens only on the machine's
Tailscale address: other devices on the local Wi-Fi can't reach it, and the API server (with the
key) still only accepts connections from the same machine. Everyone on your tailnet who plays
uses your Gemini quota, within the same caps.

## How to play

- Everyone starts with 1000 chips. Blinds are 10/20. Last player with chips wins.
- On your turn: Fold, Check/Call, or Raise (presets for min, half pot, pot, all-in, or the slider).
- In the **Table talk** panel, pick a player and send one message (up to 280 characters) per
  round. Only that player sees it. Their reply comes back in character.
- When the round ends, **What they were thinking** shows each bot's reasoning, including whether
  your message changed their mind.

## The AI players

| Player                      | Plays                  | Weak spot                                                         |
| --------------------------- | ---------------------- | ----------------------------------------------------------------- |
| Viktor "The Iceberg" Petrov | Tight and aggressive   | Ignores emotion. Only a sharp argument about the cards moves him. |
| Rosie Delgado               | Loose, likes to call   | Soft-hearted. Kindness works; rudeness makes her stubborn.        |
| "Big Tony" Benedetto        | Loose, bluffs a lot    | All ego. Dare him and he raises; tell him to fold and he won't.   |
| Nate Kim                    | Tight, folds too often | Easily spooked. Intimidation makes him fold.                      |

Their personalities live in `server/personas.mjs` (prompt text) and `src/app/ai/personas.ts`
(names, colors, hints). Keep the `id`s in sync if you add or rename one.

## Using as little of the free tier as possible

The Gemini key is free tier, so the game makes few calls:

- Chat replies always use Gemini. A bot's **moves** use Gemini only in rounds where you messaged
  that bot; otherwise the built-in logic plays (set `aiDecisions: 'always'` in
  `src/app/game/game.config.ts` to change this).
- The server caps Gemini at 8 calls a minute and 200 a day by default. The count survives
  restarts. It backs off for 30 seconds when Google is busy, and stops if the key is rejected.
- A typical call is about 900 tokens in and 70 out, and returns in about a second.

Details: [`docs/SECURITY.md`](docs/SECURITY.md).

## Settings

In `.env` (see `.env.example`):

| Variable                  | Default                 | What it does                                |
| ------------------------- | ----------------------- | ------------------------------------------- |
| `GEMINI_API_KEY`          | (none)                  | Your key. Required for AI play.             |
| `POKER_GEMINI_MODEL`      | `gemini-3.5-flash-lite` | Gemini model to use.                        |
| `POKER_GEMINI_PER_MINUTE` | `8`                     | Max Gemini calls per minute (0 = no limit). |
| `POKER_GEMINI_PER_DAY`    | `200`                   | Max Gemini calls per day (0 = no limit).    |
| `POKER_GEMINI_TIMEOUT_MS` | `45000`                 | Give up on a Gemini call after this long.   |
| `PORT` / `HOST`           | `3001` / `127.0.0.1`    | Where the API server listens.               |

In `src/app/game/game.config.ts`: stacks, blinds, the message rule (`messageLimit`: once per
round or once per betting street), message length, bot pacing and `aiDecisions`.

## Scripts

| Command               | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `npm run dev`         | API server + Angular dev server together                                |
| `npm run dev:tailnet` | Same, but reachable from your Tailscale devices (see above)             |
| `npm run server`      | API server only                                                         |
| `npm start`           | Angular dev server only (offline mode unless the API server is running) |
| `npm test`            | Poker engine unit tests (Vitest)                                        |
| `npm run build`       | Production build into `dist/`                                           |

## Project layout

```
src/app/poker/       Poker engine (plain TypeScript): cards, hand evaluator, win odds, table rules
src/app/ai/          Character data, API client, offline fallback bot
src/app/game/        GameService: turns, chat rule, bot views; game.config.ts
src/app/components/  Table, seats, cards, action bar, chat, log, result panel, start screen
server/              Node API server: Gemini calls, prompts, usage caps, .env loading
docs/                Architecture and security notes
```

How the pieces fit together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Troubleshooting

- **"Offline mode" with a reason on the start screen.** The reason says what's wrong: no key in
  `.env`, the key was rejected, the model isn't available to your key, or the API server isn't
  running (use `npm run dev`, not `npm start`).
- **A yellow note during play** ("Gemini hit its limit..."). A usage cap was reached. Bots keep
  playing with the built-in logic. The per-minute cap clears within a minute; the daily one
  resets at midnight.
- **`npm install` fails with "Cannot read properties of null (reading 'edgesOut')".** That's an
  npm 10 bug. Use `npx npm@11 install`.
