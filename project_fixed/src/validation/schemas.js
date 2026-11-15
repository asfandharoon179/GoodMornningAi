const { z } = require("zod");

const LANGUAGES = ["English", "Urdu", "Arabic", "Hindi", "Chinese", "Spanish", "French"];
const TONES = ["Motivational", "Islamic", "Funny", "Romantic", "Professional", "Poetic"];
const CARD_STYLES = ["sunrise", "minimal", "floral"];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(8).max(128);
const languageSchema = z.enum(LANGUAGES);
const toneSchema = z.enum(TONES);

function isTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
}).strict();

const forgotPasswordSchema = z.object({ email: emailSchema }).strict();
const resetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  password: passwordSchema,
}).strict();

const generateSchema = z.object({
  language: languageSchema,
  tone: toneSchema,
}).strict();

const generateImageSchema = z.object({
  greeting: z.string().trim().min(1).max(2000),
  tone: toneSchema.default("Motivational"),
  style: z.enum(CARD_STYLES).default("sunrise"),
}).strict();

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(20).max(256),
    auth: z.string().min(8).max(128),
  }).strict(),
}).strict();

const subscribeSchema = z.object({
  pushSubscription: pushSubscriptionSchema,
  time: z.string().regex(timePattern),
  timezone: z.string().min(1).max(100).refine(isTimezone, "Invalid IANA timezone"),
  language: languageSchema,
  tone: toneSchema,
  enabled: z.boolean().default(true),
}).strict();

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048).optional(),
}).strict();

const saveSchema = z.object({
  language: languageSchema,
  tone: toneSchema,
  defaultCardStyle: z.enum(CARD_STYLES).default("sunrise"),
}).strict();

const emptySchema = z.object({}).strict();

module.exports = {
  CARD_STYLES,
  LANGUAGES,
  TONES,
  emailSchema,
  emptySchema,
  forgotPasswordSchema,
  generateImageSchema,
  generateSchema,
  isTimezone,
  loginSchema,
  resetPasswordSchema,
  saveSchema,
  signupSchema,
  subscribeSchema,
  unsubscribeSchema,
};
