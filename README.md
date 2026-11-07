# Will AI Beat Us?

A multiplayer poker game for HackComs Fall 2026. You and up to three friends play No-Limit Texas
Hold'em against a table of AI players run by Google Gemini. Every round you can **whisper one
message to each AI** and **make one announcement to the whole table** to talk them into folding
or bait them into raising. Each AI falls for different things, shows you how much your words
swayed it, and remembers how you treated it. Knock out enough AIs and the humans win.

## Quick start

You need Node.js 20.19+ or 22.12+ and a Gemini API key from
[Google AI Studio](https://aistudio.google.com/) (the free tier is enough).

```bash
npx npm@11 install                     # npm 10 crashes on this lockfile; npm 11 works
cp .env.example .env && chmod 600 .env # then paste your key after GEMINI_API_KEY=
npm run dev                            # game server on :3001 + web app on :4200
```

Open <http://localhost:4200>, pick a name and **Create table**. No key? The game still runs in
**offline mode**: the AIs use built-in poker logic and canned replies.

### Playing with friends (Tailscale)

```bash
npm run dev:tailnet
```

It prints the address to share, like `http://<machine>.<tailnet>.ts.net:4200`. Create a table,
then send friends the invite link from the lobby (or the 4-letter code). The game is reachable
from your tailnet only, not the local Wi-Fi. Everyone who plays uses your Gemini quota, within
the caps below.

## How a game works

- **Setup:** the host picks **Characters** (a cast with personalities) or **Base Gemini** (plain
  Gemini players, no act), the number of AI seats (2 to 5, at most 6 seats in total), and how
  many AIs the humans must knock out to win.
- **Each round:** Fold, Check/Call or Raise as usual. You also get:
  - one **whisper** per player (Whisper panel). AIs reply with how much it **swayed** them, e.g.
    "Swayed 70%, leaning fold". You can whisper to other humans too; no AI sees those.
  - one **announcement** to the whole table. Right after your move the box lights up. Every AI
    still in the hand reacts out loud, with its own sway reading.
- **After each round:** see who won and **what each AI was thinking**, including how much your
  words influenced each move. The AIs see everyone's cards, yours included, so they learn how
  you play.
- **The AIs have a soul:** each one gets **moods** (tilted after a bad beat, shaken, on a heater)
  and **feelings** about each human (catch them lying and they hold a grudge; kindness warms
  them up). Both show on the table and in the Whisper panel, and both change how they play.
- **Game loop:** when an AI runs out of chips, a new one sits down. Blinds rise every 8 rounds.
  The humans win by knocking out the target number of AIs; the AIs win if every human busts.
- **Multiplayer:** each player only sees their own cards and their own whispers. Turns time out
  after 45 seconds. Between rounds everyone clicks Next round, or it starts by itself after 15
  seconds.

## The cast

Each game seats a random lineup, and new AIs rotate in as seats open up:

| Player                           | Weak spot                                                           |
| -------------------------------- | ------------------------------------------------------------------- |
| Hatsune Miku                     | Speaks in music. Rhyme or sing at her.                              |
| Ritchie the Tiger (RIT's mascot) | Pure school spirit. Rally his Tiger pride.                          |
| Pepsi Man                        | Lives to refresh. Tell him the table is thirsty.                    |
| Viktor "The Iceberg" Petrov      | Ignores emotion. Only a sharp argument about the cards moves him.   |
| Rosie Delgado                    | Soft-hearted. Kindness works; rudeness or lies make her stubborn.   |
| "Big Tony" Benedetto             | All ego. Dare him and he raises; tell him to fold and he won't.     |
| Nate Kim                         | Easily spooked. Intimidation makes him fold.                        |
| "Lucky" Lou Marino               | Superstitious. Omens and curses work, math doesn't.                 |
| Priya "The Closer" Shah          | Thinks in deals. Offer her an angle; lowball her and she walks.     |
| Jordan "Snipe" Vega              | Plays for the clip. Pitch a legendary play.                         |
| Dale Hutchins                    | Believes the opposite of whatever you say.                          |
| Duchess Celestine Beaumont       | Vain. Flatter her and she obliges; slight her and she punishes you. |
| Marisol Reyes                    | Lives for drama. Tell her a story.                                  |

All characters live in one file, `src/app/shared/personas.ts`, used by both the server and the
browser. Add one there and it joins the rotation.

## Keeping the free tier free

- Whispers and announcements always use Gemini. An AI's **moves** use Gemini only in rounds where
  someone whispered to it or announced to the table; otherwise the built-in logic plays
  (`aiDecisions` in `src/app/game/game.config.ts`).
- One announcement is one Gemini call, however many AIs react.
- The server caps Gemini at 8 calls a minute and 200 a day. The daily count survives restarts. It
  backs off for 30 seconds when Google is busy and stops if the key is rejected.
- A typical call is about 1,000 tokens in and 70 out. The AIs' memory of you is compacted to a
  few lines, so prompts don't grow as the game goes on.

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
| `PORT` / `HOST`           | `3001` / `127.0.0.1`    | Where the game server listens.              |

In `src/app/game/game.config.ts`: starting stack, blind levels, seats, whisper and announcement
limits, turn timer, `aiDecisions` and more.

## Scripts

| Command               | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Game server + Angular dev server                         |
| `npm run dev:tailnet` | Same, reachable from your Tailscale devices              |
| `npm run server`      | Game server only (`server:watch` restarts it on changes) |
| `npm start`           | Angular dev server only                                  |
| `npm test`            | Unit tests (Vitest)                                      |
| `npm run typecheck`   | Type-check the web app and the server                    |
| `npm run build`       | Production build into `dist/`                            |

## Project layout

```
server/              Game server: rooms, Gemini calls, prompts, usage caps, saved memories
src/app/poker/       Poker engine (plain TypeScript): cards, hand evaluator, odds, table rules
src/app/game/        Shared game logic: bot views, player memory, config; GameClient (browser)
src/app/shared/      The cast, and the messages the server and browser exchange
src/app/ai/          Bot types and the built-in fallback logic
src/app/components/  Start screen, lobby, table, seats, cards, actions, whispers, log, results
docs/                Architecture and security notes
```

How the pieces fit together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Troubleshooting

- **"Offline mode" on the start screen.** The reason says what's wrong: no key in `.env`, the key
  was rejected, the model isn't available to your key, or the game server isn't running (use
  `npm run dev`, not `npm start`).
- **A yellow note during play** ("Gemini hit its limit..."). A usage cap was reached. The AIs keep
  playing with built-in logic. The per-minute cap clears within a minute; the daily one resets at
  midnight.
- **"Lost that table."** The server restarted or the table closed (tables live in memory and close
  after 30 idle minutes). Create a new one. What the AIs remember about you is saved.
- **`npm install` fails with "Cannot read properties of null (reading 'edgesOut')".** That's an
  npm 10 bug. Use `npx npm@11 install`.
