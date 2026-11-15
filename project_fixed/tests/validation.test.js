const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateImageSchema,
  signupSchema,
  subscribeSchema,
} = require("../src/validation/schemas");

test("signup validation normalizes email and enforces password length", () => {
  const parsed = signupSchema.parse({
    name: "  Sam  ",
    email: "SAM@example.com",
    password: "Morning-123",
  });
  assert.equal(parsed.name, "Sam");
  assert.equal(parsed.email, "sam@example.com");
  assert.equal(signupSchema.safeParse({ ...parsed, password: "short" }).success, false);
});

test("strict request schemas reject unexpected fields and oversized greetings", () => {
  assert.equal(signupSchema.safeParse({
    name: "Sam",
    email: "sam@example.com",
    password: "Morning-123",
    isAdmin: true,
  }).success, false);
  assert.equal(generateImageSchema.safeParse({
    greeting: "a".repeat(2001),
    tone: "Motivational",
    style: "sunrise",
  }).success, false);
});

test("push subscriptions reject invalid IANA timezones", () => {
  const result = subscribeSchema.safeParse({
    pushSubscription: {
      endpoint: "https://push.example.com/subscription/1",
      keys: { p256dh: "p".repeat(32), auth: "a".repeat(16) },
    },
    time: "07:30",
    timezone: "Not/A_Timezone",
    language: "English",
    tone: "Motivational",
  });
  assert.equal(result.success, false);
});
