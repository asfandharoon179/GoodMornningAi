# Good Morning AI

A mobile-first greeting-card app with a vanilla HTML/CSS/JavaScript client and a Node.js/Express API. Users can register, generate streamed multilingual greetings, render and share cards, save preferences, and schedule timezone-aware browser push notifications.

## Requirements

- Node.js 20.19 or newer
- MongoDB (local or Atlas)
- Google Gemini API key
- Cloudinary account
- VAPID keys for push notifications
- Optional Unsplash key for photo backgrounds (Picsum and a generated gradient are fallbacks)
- Optional SMTP credentials for password-reset email

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env`. Set the MongoDB URI, Gemini key, Cloudinary credentials, VAPID values, and two independent secrets. Generate secrets with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Use a separate generated value for `JWT_SECRET` and `REFRESH_SECRET`. Never commit `.env`.

3. Generate VAPID keys:

   ```sh
   npx web-push generate-vapid-keys
   ```

   Put the printed public/private values into `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; set `VAPID_SUBJECT` to a `mailto:` address or an HTTPS contact URL. Push requires HTTPS in production; localhost is supported for development.

4. Start the server:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5000`. Use `npm start` for a normal production process and `npm test` for the focused test suite.

## Environment

See [.env.example](./.env.example). `MONGODB_URI` is the current setting; `MONGODB_URL` and `CORS_ORIGIN` remain accepted as compatibility aliases. Set `ALLOWED_ORIGIN` to a comma-separated list of exact frontend origins if the browser client is hosted separately. `DAILY_LIMIT` defaults to 10 greetings per user per UTC day.

The password-reset endpoints require `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. If these are not configured, password-reset email delivery returns an explicit configuration error rather than claiming that an email was sent.

## Fonts

The repository includes the required font files in `fonts/`. For fresh installs, download Noto Sans Devanagari and Noto Sans SC from [Google Fonts](https://fonts.google.com/) and obtain Noto Nastaliq Urdu/Jameel Nastaleeq from a source whose license permits redistribution. Keep each file's license with your distribution. The server requires the three bundled files named in `src/services/cards.js`.

## App structure

```text
index.js
src/
  app.js
  config.js
  logger.js
  middleware/
  models/
  services/
  validation/
public/
  index.html
  sw.js
  manifest.json
  icon.png
  icon-512.png
  legal pages
fonts/
tests/
scripts/
Dockerfile
.env.example
```

`index.js` starts the app in `src/server.js`. The static client restores local theme, preferences, last page, and message history. Access tokens remain in page memory; refresh tokens are rotated in an HttpOnly cookie. MongoDB stores account data, usage, preferences, refresh sessions, and notification subscriptions.

Existing accounts in the `userprofiles` collection are retained. The app upgrades legacy password fields to bcrypt on successful login and migrates legacy notification subscriptions at startup.

## API

- Public: `POST /signup`, `POST /login`, `POST /refresh`, `POST /logout`, `POST /forgot-password`, `POST /reset-password`, `GET /vapid-public-key`, `GET /home-images`, `GET /health`
- Authenticated: `POST /generate` (SSE stream), `POST /generate-image`, `GET /cloudinary-history`, `POST /save`, `POST /subscribe`, `POST /unsubscribe`, `DELETE /account`

All JSON request bodies are strict-schema validated. The API uses per-route rate limits, explicit CORS, Helmet CSP, 15-minute JWT access tokens, bcrypt password hashes, and rotating hashed refresh sessions.

## Scheduled notifications

The scheduler runs once per minute, checks each enabled subscription in its IANA timezone, and atomically claims each local date before sending. It processes subscriptions in batches, removes expired push endpoints (404/410), and disables endpoints after repeated failures. Set `BASE_URL` to the public HTTPS app URL in production so notification links open the correct origin.

## Docker

```sh
docker build -t good-morning-ai .
docker run --env-file .env -p 5000:5000 good-morning-ai
```

## Old-card cleanup

The cleanup tool defaults to a dry run and only considers images under the `good-morning-ai` Cloudinary folder:

```sh
node scripts/cleanup-cloudinary.js --days=365
node scripts/cleanup-cloudinary.js --days=365 --confirm
```

Review the candidate count before using `--confirm`.
