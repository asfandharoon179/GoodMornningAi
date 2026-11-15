# Good Morning AI - Project Flow

## Application overview

```mermaid
flowchart TD
    Visitor[Visitor / browser] --> Express[Express server - index.js]
    Express -->|Serves| Frontend[public/index.html]
    Express -->|Static assets| Assets[Fonts, icons, legal pages, manifest, sw.js]
    Frontend --> Pages[Home / Generate / Today / History / Settings]
    Pages -->|Theme, settings, page, local history| BrowserStore[localStorage]
    Frontend -->|Refresh session| Cookie[HttpOnly refresh cookie]
    Frontend -->|Register service worker| SW[public/sw.js]

    Pages -->|API requests| Middleware[Rate limits / CORS / CSP / body validation]
    Middleware --> Auth{Authenticated endpoint?}
    Auth -->|Yes| JWT[Verify in-memory access JWT]
    Auth -->|No| PublicAPI[Public endpoints]
    JWT --> Routes[API route handlers]
    PublicAPI --> Routes

    Routes -->|Users, usage, preferences, sessions, subscriptions| MongoDB[(MongoDB)]
    Routes -->|Generate streamed text| Gemini[Google Gemini]
    Gemini -->|Failure / timeout| Fallback[Localized fallback]
    Routes -->|Render 1080 x 1350 cards| Canvas[Canvas + bundled fonts]
    Canvas -->|Background fallback chain| Images[Unsplash / Picsum / gradient]
    Routes -->|Save and list user cards| Cloudinary[(Cloudinary)]

    Scheduler[Guarded cron job - every minute] -->|Timezone check / atomic claim| MongoDB
    Scheduler --> Routes
    Scheduler -->|Web Push| Push[Browser Push API]
    Push --> SW
    SW -->|Display / open notification| Visitor
```

## Main user flows

```mermaid
flowchart TD
    Start([Open app]) --> Serve[Express serves app and static assets]
    Serve --> Restore[Restore theme, settings, page, and local history]
    Restore --> Refresh[POST /refresh using HttpOnly cookie]
    Refresh -->|Valid| MemoryToken[Keep short-lived access JWT in memory]
    Refresh -->|Unavailable| Guest[Continue as signed-out visitor]
    MemoryToken --> Page{Choose page or action}
    Guest --> Page

    Page -->|Sign up / login| Account[POST /signup or /login]
    Account --> MongoUser[(MongoDB user profile)]
    MongoUser --> Session[Return access JWT and set refresh cookie]
    Session --> Page

    Page -->|Generate greeting| Generate[POST /generate with language and tone]
    Generate --> Verify[Verify JWT and atomically check daily limit]
    Verify -->|Allowed| Gemini[Stream greeting from Gemini]
    Gemini -->|Failure / deadline| Fallback[Localized fallback greeting]
    Gemini -->|Chunks| Today[Render with textContent, save local history]
    Fallback --> Today
    Today -->|Create card| Render[POST /generate-image]
    Render --> Canvas[Render card with Canvas and fonts]
    Canvas --> Upload[Upload to Cloudinary]
    Upload --> Return[Return image and saved-card reference]
    Return --> History[Share / download / view in History]

    Page -->|Browse sample cards| Home[GET /home-images]
    Home --> Samples[Gemini greetings or fallbacks, rendered as cards]
    Samples --> Page
    Page -->|Load saved cards| CloudHistory[GET /cloudinary-history]
    CloudHistory --> History

    Page -->|Save settings| Preferences[POST /save]
    Preferences --> MongoPrefs[(MongoDB preferences)]
    Page -->|Enable notifications| Permission[Fetch VAPID key / register service worker / ask permission]
    Permission -->|Granted| Subscribe[Subscribe browser and POST /subscribe]
    Subscribe --> Schedule[(MongoDB timezone-aware schedule)]
    Permission -->|Denied| Explain[Show clear disabled state]
```

## Scheduled notification flow

```mermaid
flowchart TD
    Cron[Every minute: guarded node-cron job] --> Batch[Read enabled subscriptions in small batches]
    Batch --> LocalTime[Convert current time to each IANA timezone]
    LocalTime --> Due{Saved local time and date not sent?}
    Due -->|No| Next[Continue to next subscription]
    Due -->|Yes| Claim[Atomically claim this subscription and local date]
    Claim -->|Already claimed| Next
    Claim -->|Claim acquired| Greeting[Generate greeting or localized fallback]
    Greeting --> Card[Render card and upload to Cloudinary]
    Card --> WebPush[Send Web Push with greeting and card link]
    WebPush -->|Success| Mark[Set lastSentDate and clear claim]
    WebPush -->|404 / 410| Remove[Delete expired subscription]
    WebPush -->|Other failure| Count[Increment failures; disable after threshold]
    Mark --> Next
    Remove --> Next
    Count --> Next
    Next --> Batch
    WebPush --> ServiceWorker[Service worker displays notification]
    ServiceWorker -->|Tap| App[Open the app / card]
```

## Key components

- `index.js` and `src/server.js`: validated startup, MongoDB, indexes, scheduler, and graceful shutdown.
- `src/app.js`: Express API, authentication endpoints, validation, rate limiting, CORS/CSP, and static serving.
- `src/models/` and `src/services/`: MongoDB data, session/auth, Gemini, card rendering, Cloudinary, email, and scheduling.
- `public/index.html`: single-page interface and browser-side API/state logic.
- `public/sw.js`: app-shell cache, push display, and notification navigation.
- `fonts/`: bundled Urdu, Devanagari, and Chinese fonts used by the card renderer.
- `tests/`: timezone/duplicate-claim, JWT middleware, and request-validation tests.
