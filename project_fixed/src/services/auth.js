const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const config = require("../config");
const RefreshSession = require("../models/refresh-session");
const User = require("../models/user");

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_DAYS = 30;
const REFRESH_COOKIE = "gm_refresh";

function hashToken(token) {
  return crypto.createHmac("sha256", config.REFRESH_SECRET).update(token).digest("hex");
}

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    preferences: user.preferences,
  };
}

function signAccessToken(user) {
  return jwt.sign(
    { email: user.email, name: user.name },
    config.JWT_SECRET,
    { algorithm: "HS256", subject: String(user._id), expiresIn: ACCESS_TOKEN_SECONDS },
  );
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
  };
}

async function issueSession(user, res) {
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  await RefreshSession.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
  });
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

async function rotateRefreshSession(refreshToken, res) {
  if (!refreshToken || typeof refreshToken !== "string") return null;
  const oldHash = hashToken(refreshToken);
  const session = await RefreshSession.findOne({
    tokenHash: oldHash,
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const user = await User.findById(session.userId);
  if (!user) {
    await RefreshSession.deleteOne({ _id: session._id });
    return null;
  }

  const nextToken = crypto.randomBytes(48).toString("base64url");
  const nextHash = hashToken(nextToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  const rotated = await RefreshSession.findOneAndUpdate(
    { _id: session._id, tokenHash: oldHash, expiresAt: { $gt: new Date() } },
    { $set: { tokenHash: nextHash, expiresAt } },
    { new: true },
  );
  if (!rotated) return null;

  res.cookie(REFRESH_COOKIE, nextToken, refreshCookieOptions());
  return { accessToken: signAccessToken(user), user: publicUser(user) };
}

async function revokeRefreshSession(refreshToken, res) {
  if (refreshToken) {
    await RefreshSession.deleteOne({ tokenHash: hashToken(refreshToken) });
  }
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

async function verifyAndUpgradePassword(user, password) {
  if (user.passwordHash) return bcrypt.compare(password, user.passwordHash);
  if (!user.password) return false;

  const isLegacyBcrypt = /^\$2[aby]\$/.test(user.password);
  const isMatch = isLegacyBcrypt
    ? await bcrypt.compare(password, user.password)
    : password === user.password;
  if (isMatch) {
    user.passwordHash = await bcrypt.hash(password, 12);
    user.password = undefined;
    await user.save();
  }
  return isMatch;
}

module.exports = {
  ACCESS_TOKEN_SECONDS,
  REFRESH_COOKIE,
  hashToken,
  issueSession,
  publicUser,
  refreshCookieOptions,
  revokeRefreshSession,
  rotateRefreshSession,
  signAccessToken,
  verifyAndUpgradePassword,
};
