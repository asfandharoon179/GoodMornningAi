const jwt = require("jsonwebtoken");

function createAuthMiddleware(secret, userModel) {
  return async (req, res, next) => {
    const authorization = req.get("authorization") || "";
    const match = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(authorization);
    if (!match) return res.status(401).json({ error: "Authentication required." });

    let payload;
    try {
      payload = jwt.verify(match[1], secret, { algorithms: ["HS256"] });
    } catch {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }
    if (!payload.sub || !payload.email) {
      return res.status(401).json({ error: "Invalid or expired access token." });
    }
    if (userModel && !(await userModel.exists({ _id: payload.sub }))) {
      return res.status(401).json({ error: "Account is no longer available." });
    }
    req.user = { id: payload.sub, email: payload.email, name: payload.name || "" };
    return next();
  };
}

module.exports = createAuthMiddleware;
