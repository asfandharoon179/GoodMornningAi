const dotenv = require("dotenv");
const { z } = require("zod");

dotenv.config();

const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL;
const allowedOrigin = process.env.ALLOWED_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:5000";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  BASE_URL: z.string().url().default("http://localhost:5000"),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  REFRESH_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(1),
  UNSPLASH_ACCESS_KEY: z.string().optional().default(""),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().min(1),
  DAILY_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  ALLOWED_ORIGIN: z.string().min(1),
  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default(""),
});

const parsed = envSchema.safeParse({
  ...process.env,
  MONGODB_URI: mongoUri,
  ALLOWED_ORIGIN: allowedOrigin,
});

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration: ${missing}`);
}

const config = parsed.data;
const smtpValues = [config.SMTP_HOST, config.SMTP_USER, config.SMTP_PASS, config.SMTP_FROM];
if (smtpValues.some(Boolean) && !smtpValues.every(Boolean)) {
  throw new Error("SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM must be configured together.");
}

config.allowedOrigins = config.ALLOWED_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
config.smtpEnabled = smtpValues.every(Boolean);
config.secureCookies = config.NODE_ENV === "production" &&
  !(new URL(config.BASE_URL).hostname === "localhost" || new URL(config.BASE_URL).hostname === "127.0.0.1");

module.exports = Object.freeze(config);
