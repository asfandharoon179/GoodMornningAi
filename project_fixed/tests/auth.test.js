const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const createAuthMiddleware = require("../src/middleware/auth");

const secret = "test-secret-value-that-is-long-enough-for-hmac";

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("JWT middleware accepts a valid token and attaches the user identity", async () => {
  const token = jwt.sign({ email: "sam@example.com", name: "Sam" }, secret, {
    algorithm: "HS256",
    subject: "user-1",
    expiresIn: "15m",
  });
  const req = {
    get: () => `Bearer ${token}`,
  };
  const res = createResponse();
  let nextCalled = false;
  const middleware = createAuthMiddleware(secret, { exists: async () => ({ _id: "user-1" }) });

  await middleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { id: "user-1", email: "sam@example.com", name: "Sam" });
});

test("JWT middleware rejects expired tokens and deleted accounts", async () => {
  const expired = jwt.sign({ email: "sam@example.com" }, secret, {
    algorithm: "HS256",
    subject: "user-1",
    expiresIn: -1,
  });
  const middleware = createAuthMiddleware(secret, { exists: async () => null });
  const expiredResponse = createResponse();
  await middleware({ get: () => `Bearer ${expired}` }, expiredResponse, () => {});
  assert.equal(expiredResponse.statusCode, 401);

  const valid = jwt.sign({ email: "sam@example.com" }, secret, {
    algorithm: "HS256",
    subject: "deleted-user",
    expiresIn: "15m",
  });
  const deletedResponse = createResponse();
  await middleware({ get: () => `Bearer ${valid}` }, deletedResponse, () => {});
  assert.equal(deletedResponse.statusCode, 401);
});
