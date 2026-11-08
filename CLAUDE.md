# Project notes: TheDailyStalk (HackComs Fall 2026)

Self-reference notes for future sessions (Claude Code and teammates). Keep this short and current:
update **Progress log** and **Decisions** whenever something meaningful changes.

## What this is

A plant-themed photo board for RIT students. One theme a day, one photo per person per day.
Still images only: no videos, no captions, no text posts. Likes, a daily theme list, and a
profile plant that grows with your posting streak. Sign-in is a code emailed to an RIT address.
("Stalk" is an inside joke; the plant theme runs with it.)

The previous project, "Will AI Beat Us?" (Gemini poker), is archived on branch
`archive/will-ai-beat-us`, tag `will-ai-beat-us-final`, and in `../will-ai-beat-us-backup.bundle`.

## Team preferences (read these)

- **No em dashes or AI-sounding filler anywhere on the front end** (UI copy, server error
  messages, emails, themes). Plain, natural, a little casual. A test checks the theme list.
- Keep it simple: one photo, no captions, no text features unless asked.
- Write docs as you go, update this file, and commit at milestones on a feature branch.

## Stack

- **Frontend:** Angular 21 (standalone, signals, zoneless), plain `fetch` (`src/app/api.ts`).
- **Backend:** Node 22 + `tsx`, no framework (`server/`). SQLite via built-in `node:sqlite`.
  `sharp` re-encodes photos; `nodemailer` sends codes.
- **Tests:** Vitest (`npm test`): shared code plus end-to-end API tests on a real server.

## Commands

| Command                            | What it does                                              |
| ---------------------------------- | --------------------------------------------------------- |
| `npm run dev`                      | API server (3001) + Angular dev server (4200)             |
| `npm run dev:tailnet`              | Same, web server on this machine's Tailscale IP only      |
| `npm run server`                   | API only; also serves `dist/daily-stalk/browser` if built |
| `npm test`                         | Unit + API tests (offline, temp data dir)                 |
| `npm run typecheck`                | tsc for the app and the server                            |
| `npm run build`                    | Production build                                          |
| `npm run deploy -- user@host 5001` | Docker deploy over SSH (`scripts/deploy.sh`)              |

Install with npm 11 (`npx npm@11 install`); npm 10 crashes on this lockfile ("edgesOut").
Without `EMAILER_URL` or SMTP in `.env`, sign-in codes print to the server console.
Gotcha: kill servers by port, `kill $(lsof -t -i:3001 -sTCP:LISTEN)`; `pkill -f` matches its own
shell. Run `node_modules/.bin/tsx` directly for background servers.

## Layout

See `docs/ARCHITECTURE.md` (and `docs/SECURITY.md`). Quick map:

- `server/`: `main.ts`, `app.ts` (all routes), `store.ts` (schema + queries), `auth.ts`,
  `images.ts`, `mail.ts`, `http.ts`, `config.ts`, `app.spec.ts`.
- `src/app/shared/`: `protocol.ts` (API types), `days.ts`, `themes.ts` (the theme list),
  `rules.ts` (email + handle rules).
- `src/app/pages/`: board (today and past days), sign-in, themes, profile, mod, not-found.
- `src/app/ui/`: post grid (masonry), photo of the day, calendar, lightbox, uploader, theme tag,
  like button, plant, vines, flower, countdown, logo, `format.ts` (avatar colors, "3h ago").

## Conventions

- Server error messages are shown to users as is: write them as plain sentences.
- Component CSS under the 4 kB budget warning; tokens and shared classes in `src/styles.css`.
- Colors are tokens with light and dark values; test both.

## Decisions

- Day = midnight to midnight America/New_York. A day's theme is saved when the day starts.
- One photo per day via `UNIQUE(user_id, day)`. Deleting doesn't free the day.
- Sign-in codes (not magic links) because Outlook Safe Links would consume one-time links.
- Accounts keyed by `accountEmail()`: g.rit.edu -> rit.edu, +tags dropped. Usernames must look
  like `abc1234` to stop alias accounts (configurable).
- Members only by default (`MEMBERS_ONLY`): photos need sign-in. Theme is visible to everyone.
- Can't like your own photo. 3 reports hide a photo until a mod decides; "keep" marks it reviewed.
- Uploads re-encoded to WebP (2048px + 720px thumb), EXIF stripped, animated images refused.
- Handles: 3 to 20 of `a-z0-9_`, changeable up to 3 times a day.
- Photo of the day = the day's most liked photo (needs at least 1 like; earliest wins a tie).
  Worked out in the browser from the board, so it updates as people like.
- Profile calendar: posted days show that day's photo. Deleted and mod-removed days are only
  sent to the owner (`calendar` in the profile response).
- Feed is masonry: photos keep their shape, clamped between 3:4 and 4:3. Vines fill the side
  margins only on screens wider than 1220px.
- Sign-in emails go through the team's emailer (`EMAILER_URL=https://emailer.aceiq.ca/send-email`,
  `server/mail.ts`). It writes each extra JSON field as a "name: value" line under "Refer Page:".
- Public at https://stalk.photo through a Cloudflare Tunnel (container `stalk-tunnel` on the
  homelab, token in `~/thedailystalk/tunnel.env`), not DDNS: the home IP changes daily and the
  tunnel needs no open ports. Server `.env` has `PUBLIC_URL=https://stalk.photo`, `TRUST_PROXY=true`.

## Progress log

- 2026-11-07 (`feature/daily-stalk`): Pivoted from the poker game. Built the server (auth,
  posts, likes, reports, mods, themes), the Angular site (board, sign-in, themes, profiles with
  the streak plant, mod queue, lightbox), docs. 28 tests pass; a headless Chrome walkthrough
  (desktop light + phone dark, 8 accounts) passed every check.
- 2026-11-07: Photo of the day next to the theme, masonry feed with avatars and times, side
  vines, profile calendar (posted/deleted days), Past themes box on the Themes page. Checked in
  headless Chrome against a seeded six-day test server.
- 2026-11-07: Dockerfile + `scripts/deploy.sh`. Deployed to the homelab (saksham@100.91.45.86,
  Ubuntu 24.04) on port 5001; data in `~/thedailystalk/data` there. Then a Cloudflare Tunnel
  for stalk.photo; rate limits read `CF-Connecting-IP`. Codes now emailed via emailer.aceiq.ca.

## Ideas / next steps

- Pick admins. Ask the emailer's owner to require a key (`EMAILER_KEY`).
- Account deletion (delete all my photos and my email).
- Client-side downscaling before upload for slow connections; HEIC support on desktop.
- Maybe notifications or a reminder email when a new theme drops.
