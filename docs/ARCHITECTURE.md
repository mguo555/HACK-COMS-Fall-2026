# Architecture

```
browser (Angular 21)  ──fetch──▶  Node server (server/)  ──▶  SQLite (.data/stalk.db)
                                                          └─▶  photos (.data/images/*.webp)
```

In development, `ng serve` (4200) serves the app and forwards `/api` to the Node server (3001)
through `proxy.conf.json`. In production the Node server serves both the built app and the API.

## Folders

| Path                 | What's there                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `server/main.ts`     | Entry point: loads `.env`, builds the app, listens                      |
| `server/app.ts`      | Every API route, access rules and response shapes                       |
| `server/store.ts`    | SQLite schema and every query                                           |
| `server/auth.ts`     | Sign-in codes, sessions, the session cookie                             |
| `server/images.ts`   | Checks and re-encodes uploads with sharp                                |
| `server/mail.ts`     | Sends codes over SMTP, or prints them when SMTP isn't set up            |
| `server/http.ts`     | Errors, body reading, cookies, rate limiter, static files, CSP          |
| `server/config.ts`   | All settings from the environment (documented in `.env.example`)        |
| `server/app.spec.ts` | End-to-end API tests on a real server with real images                  |
| `src/app/shared/`    | Code both sides use: API types, day math, the theme list, sign-up rules |
| `src/app/pages/`     | One component per route: board, sign in, themes, profile, mod, 404      |
| `src/app/ui/`        | Pieces: photo grid, lightbox, uploader, theme tag, like button, plant   |
| `src/app/session.ts` | Who's signed in and today's theme, toast messages, optimistic likes     |
| `src/app/api.ts`     | `fetch` wrappers for every route                                        |

## Data

```
users        id, email (account form, see below), handle, created_at, banned
login_codes  email, salted hash of the code, sent_at, expires_at, attempts
sessions     sha256(token), user_id, expires_at
days         date, theme            (saved the first time a day is seen)
posts        id, user_id, day, width, height, status, reviewed   UNIQUE(user_id, day)
likes        post_id, user_id
reports      post_id, user_id
```

- **One photo a day** is the `UNIQUE (user_id, day)` key. The upload route checks it before
  reading the file, and the insert enforces it if two uploads race. Deleting a post only changes
  its status, so the row (and the day) stays used.
- **Post status:** `live` (on the board), `hidden` (enough reports, waiting for a mod),
  `deleted` (by its owner), `removed` (by a mod or a ban). `reviewed` is set when a mod keeps a
  post, so more reports won't hide it again. Image files are deleted for `deleted` and `removed`.
- **Accounts:** `abc1234+anything@g.rit.edu` and `abc1234@rit.edu` reach the same inbox, so
  `accountEmail()` maps both to `abc1234@rit.edu`. The username check (`abc1234` style) also
  rules out aliases like `first.last@rit.edu`, so one student gets one account.
- **Themes:** `themeFor(date)` walks `THEMES` from `THEME_START`, with `PINNED` dates first.
  When a day starts, its theme is written to `days`, so editing the list later never changes a
  past day.

## Days

A day is a `YYYY-MM-DD` string in `TIME_ZONE` (America/New_York). `src/app/shared/days.ts` does
the conversions, including the exact instant the next day starts (`startOfDay`), which the
browser uses for its "New theme in 4h 12m" countdown. The browser asks the server for a fresh
session once that time passes, and the board reloads with the new theme.

Uploads send an `X-Day` header with the day the page thinks it is. If midnight passed while
someone was choosing a photo, the server refuses it instead of quietly posting it under the new
theme.

## Photos

`processImage()` in `server/images.ts`:

1. Reads metadata. Anything sharp can't read, or that isn't JPEG, PNG, WebP, GIF, AVIF, HEIF or
   TIFF, is refused. Anything with more than one frame (animated GIF/WebP/AVIF) is refused.
2. Rotates to match the camera's orientation tag, then writes a 2048px WebP and a 720px WebP
   thumbnail. Metadata, including GPS, is not copied.

At most 3 uploads are processed at once. iPhone HEIC files usually can't be decoded by the
prebuilt sharp, but iOS Safari converts photos to JPEG when you pick them, so this mostly matters
for desktop uploads.

## Front end

Standalone Angular components, signals, no zone.js. A few pieces worth knowing:

- **Feed** (`ui/post-grid`): masonry. Each photo goes into the shortest column, so the first row
  still reads left to right. Columns: 4 at 1000px and up, 3 at 700px, else 2.
- **Photo of the day** (`ui/top-photo`): the board page picks the most liked photo from the
  posts it already has, so it changes live as people like things.
- **Calendar** (`ui/post-calendar`): month grids from the profile's `calendar` list, newest month
  first, back to when the account was made (at most 12).
- **Vines** (`ui/vines`): an SVG pattern tile that repeats down both side margins.

The server's JSON is the state; pages load
what they need and update locally after actions (likes update instantly and roll back on error).
Shared styles and color tokens (light and dark) are in `src/styles.css`; each component keeps its
own CSS under the 4 kB budget.
