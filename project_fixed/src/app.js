const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const User = require("./models/user");
const Subscription = require("./models/subscription");
const RefreshSession = require("./models/refresh-session");
const createAuthMiddleware = require("./middleware/auth");
const validateBody = require("./middleware/validate-body");
const {
  emptySchema,
  forgotPasswordSchema,
  generateImageSchema,
  generateSchema,
  loginSchema,
  resetPasswordSchema,
  saveSchema,
  signupSchema,
  subscribeSchema,
  unsubscribeSchema,
} = require("./validation/schemas");
const {
  REFRESH_COOKIE,
  hashToken,
  issueSession,
  revokeRefreshSession,
  rotateRefreshSession,
  verifyAndUpgradePassword,
} = require("./services/auth");
const { generateGreeting, getFallbackMessage, streamGreeting } = require("./services/ai");
const { renderGreetingCard } = require("./services/cards");
const { deleteUserCards, listUserCards, uploadCard } = require("./services/cloudinary");
const { sendPasswordResetEmail } = require("./services/email");
const { consumeDailyGeneration } = require("./services/usage");
const { refreshCookieOptions } = require("./services/auth");
const path = require("node:path");

const app = express();
const auth = createAuthMiddleware(config.JWT_SECRET, User);
const homeImageCache = new Map();
const HOME_CACHE_TTL_MS = 60 * 60 * 1000;

app.disable("x-powered-by");
if (config.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: [
        "'self'", "data:", "blob:", "https://res.cloudinary.com",
        "https://images.unsplash.com", "https://picsum.photos", "https://fastly.picsum.photos",
      ],
      connectSrc: ["'self'", "https://res.cloudinary.com"],
      workerSrc: ["'self'", "blob:"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "16kb", strict: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    }, "HTTP request");
  });
  next();
});

function createLimiter(max, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: "Too many requests. Please try again later." }),
  });
}

const signupLimiter = createLimiter(5);
const loginLimiter = createLimiter(5);
const forgotLimiter = createLimiter(3);
const generateLimiter = createLimiter(20);
const imageLimiter = createLimiter(10);
const homeLimiter = createLimiter(30);
const subscriptionLimiter = createLimiter(10);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sendEvent(res, event, data) {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function localToday() {
  return new Date().toISOString().slice(0, 10);
}

function cacheGet(key) {
  const cached = homeImageCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    homeImageCache.delete(key);
    return null;
  }
  return cached.value;
}

function cacheSet(key, value) {
  if (homeImageCache.size >= 24) {
    const oldestKey = homeImageCache.keys().next().value;
    homeImageCache.delete(oldestKey);
  }
  homeImageCache.set(key, { value, expiresAt: Date.now() + HOME_CACHE_TTL_MS });
}

app.get("/health", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "unavailable",
    database: ready ? "connected" : "disconnected",
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

app.post("/signup", signupLimiter, validateBody(signupSchema), asyncRoute(async (req, res) => {
  const { name, email, password } = req.validatedBody;
  const passwordHash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await User.create({ name, email, passwordHash });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with this email already exists." });
    throw error;
  }
  return res.status(201).json(await issueSession(user, res));
}));

app.post("/login", loginLimiter, validateBody(loginSchema), asyncRoute(async (req, res) => {
  const { email, password } = req.validatedBody;
  const user = await User.findOne({ email }).select("+passwordHash +password");
  if (!user || !(await verifyAndUpgradePassword(user, password))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  return res.json(await issueSession(user, res));
}));

app.post("/refresh", validateBody(emptySchema), asyncRoute(async (req, res) => {
  const session = await rotateRefreshSession(req.cookies[REFRESH_COOKIE], res);
  if (!session) {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  return res.json(session);
}));

app.post("/logout", validateBody(emptySchema), asyncRoute(async (req, res) => {
  await revokeRefreshSession(req.cookies[REFRESH_COOKIE], res);
  return res.json({ success: true });
}));

app.post("/forgot-password", forgotLimiter, validateBody(forgotPasswordSchema), asyncRoute(async (req, res) => {
  if (!config.smtpEnabled) {
    return res.status(503).json({ error: "Password reset email delivery is not configured." });
  }

  const { email } = req.validatedBody;
  const user = await User.findOne({ email });
  if (user) {
    const token = crypto.randomBytes(32).toString("base64url");
    user.resetTokenHash = hashToken(token);
    user.resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (error) {
      user.resetTokenHash = undefined;
      user.resetTokenExpiresAt = undefined;
      await user.save();
      logger.error({ error: error.message }, "Password reset email could not be sent");
      return res.status(502).json({ error: "Could not send password reset email. Please try again later." });
    }
  }
  return res.status(202).json({ message: "If the account exists, a password reset link has been sent." });
}));

app.post("/reset-password", forgotLimiter, validateBody(resetPasswordSchema), asyncRoute(async (req, res) => {
  const { token, password } = req.validatedBody;
  const user = await User.findOne({
    resetTokenHash: hashToken(token),
    resetTokenExpiresAt: { $gt: new Date() },
  }).select("+resetTokenHash +resetTokenExpiresAt +passwordHash");
  if (!user) return res.status(400).json({ error: "Reset link is invalid or expired." });

  user.passwordHash = await bcrypt.hash(password, 12);
  user.password = undefined;
  user.resetTokenHash = undefined;
  user.resetTokenExpiresAt = undefined;
  await user.save();
  await RefreshSession.deleteMany({ userId: user._id });
  return res.json(await issueSession(user, res));
}));

app.get("/vapid-public-key", (_req, res) => res.json({ publicKey: config.VAPID_PUBLIC_KEY }));
app.get("/vapidPublicKey", (_req, res) => res.json({ publicKey: config.VAPID_PUBLIC_KEY }));

app.post("/generate", generateLimiter, auth, validateBody(generateSchema), asyncRoute(async (req, res) => {
  const { language, tone } = req.validatedBody;
  const allowed = await consumeDailyGeneration(req.user.id, localToday(), config.DAILY_LIMIT);
  if (!allowed) {
    return res.status(429).json({ error: `Daily generation limit reached (${config.DAILY_LIMIT}).` });
  }

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  try {
    await streamGreeting({
      language,
      tone,
      onChunk: (text) => sendEvent(res, "chunk", { text }),
      onReset: () => sendEvent(res, "reset", {}),
      onReplace: (text) => sendEvent(res, "replace", { text }),
    });
    sendEvent(res, "done", {});
    res.end();
  } catch (error) {
    logger.error({ error: error.message }, "Greeting stream failed");
    sendEvent(res, "replace", { text: getFallbackMessage(language) });
    sendEvent(res, "done", {});
    res.end();
  }
}));

app.post("/generate-image", imageLimiter, auth, validateBody(generateImageSchema), asyncRoute(async (req, res) => {
  const { greeting, tone, style } = req.validatedBody;
  const user = await User.findById(req.user.id).select("name preferences");
  if (!user) return res.status(401).json({ error: "Account is no longer available." });

  const image = await renderGreetingCard({ greeting, tone, style, userName: user.name });
  let card;
  try {
    card = await uploadCard(image, user._id);
  } catch (error) {
    logger.error({ userId: String(user._id), error: error.message }, "Card upload failed");
    return res.status(502).json({ error: "Could not save your card. Please try again." });
  }
  return res.status(201).json({
    image,
    cloudinaryUrl: card.secure_url,
    cloudinaryPublicId: card.public_id,
  });
}));

app.get("/home-images", homeLimiter, asyncRoute(async (req, res) => {
  const languages = new Set(["English", "Urdu", "Arabic", "Hindi", "Chinese", "Spanish", "French"]);
  const tones = new Set(["Motivational", "Islamic", "Funny", "Romantic", "Professional", "Poetic"]);
  const language = languages.has(req.query.language) ? req.query.language : "English";
  const tone = tones.has(req.query.tone) ? req.query.tone : "Motivational";
  const key = `${language}:${tone}`;
  const cached = cacheGet(key);
  if (cached) return res.json(cached);

  const messages = await Promise.all(Array.from({ length: 3 }, () =>
    generateGreeting({ language, tone, onChunk: () => {}, onReset: () => {}, onReplace: () => {} }),
  ));
  const images = await Promise.all(messages.map((greeting) =>
    renderGreetingCard({ greeting, tone, style: "sunrise" }),
  ));
  const result = { images, messages };
  cacheSet(key, result);
  return res.json(result);
}));

app.get("/cloudinary-history", auth, asyncRoute(async (req, res) => {
  try {
    const images = await listUserCards(req.user.id);
    return res.json({ images });
  } catch (error) {
    logger.error({ userId: req.user.id, error: error.message }, "Cloudinary history fetch failed");
    return res.status(502).json({ error: "Could not load saved cards right now." });
  }
}));

app.post("/save", auth, validateBody(saveSchema), asyncRoute(async (req, res) => {
  const { language, tone, defaultCardStyle } = req.validatedBody;
  await User.updateOne(
    { _id: req.user.id },
    { $set: { preferences: { language, tone, defaultCardStyle } } },
  );
  await Subscription.updateMany(
    { userId: req.user.id, enabled: true },
    { $set: { language, tone } },
  );
  return res.json({ success: true, preferences: { language, tone, defaultCardStyle } });
}));

app.post("/subscribe", subscriptionLimiter, auth, validateBody(subscribeSchema), asyncRoute(async (req, res) => {
  const { pushSubscription, time, timezone, language, tone, enabled } = req.validatedBody;
  await Subscription.findOneAndUpdate(
    { "pushSubscription.endpoint": pushSubscription.endpoint },
    {
      $set: {
        userId: req.user.id,
        pushSubscription,
        time,
        timezone,
        language,
        tone,
        enabled,
        failureCount: 0,
      },
      $setOnInsert: { lastSentDate: "", claimedForDate: "", claimedAt: null },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return res.json({ success: true });
}));

app.post("/unsubscribe", subscriptionLimiter, auth, validateBody(unsubscribeSchema), asyncRoute(async (req, res) => {
  const filter = { userId: req.user.id };
  if (req.validatedBody.endpoint) filter["pushSubscription.endpoint"] = req.validatedBody.endpoint;
  await Subscription.deleteMany(filter);
  return res.json({ success: true });
}));

app.delete("/account", auth, validateBody(emptySchema), asyncRoute(async (req, res) => {
  try {
    await deleteUserCards(req.user.id);
  } catch (error) {
    logger.error({ userId: req.user.id, error: error.message }, "Account card cleanup failed");
    return res.status(502).json({ error: "Could not delete saved cards. Please retry account deletion." });
  }
  await Promise.all([
    Subscription.deleteMany({ userId: req.user.id }),
    RefreshSession.deleteMany({ userId: req.user.id }),
    User.deleteOne({ _id: req.user.id }),
  ]);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  return res.json({ success: true });
}));

app.use(express.static(path.join(__dirname, "..", "public"), {
  maxAge: "1d",
  setHeaders(res, filePath) {
    const filename = path.basename(filePath);
    if (["index.html", "sw.js", "manifest.json"].includes(filename)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
  },
}));

app.use((error, req, res, _next) => {
  if (res.headersSent) return res.end();
  logger.error({ error: error.message, path: req.path }, "Unhandled request error");
  if (error.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "Origin is not allowed." });
  }
  return res.status(500).json({ error: "An unexpected server error occurred." });
});

module.exports = app;
