const http = require("node:http");
const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");
const app = require("./app");
const User = require("./models/user");
const Subscription = require("./models/subscription");
const RefreshSession = require("./models/refresh-session");
const { migrateLegacySubscriptions, startScheduler } = require("./services/scheduler");

async function start() {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    autoIndex: config.NODE_ENV !== "production",
  });
  logger.info("MongoDB connected");
  await Promise.all([User.init(), Subscription.init(), RefreshSession.init()]);
  logger.info("MongoDB indexes ready");
  await migrateLegacySubscriptions();

  const stopScheduler = startScheduler();
  const server = http.createServer(app);
  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "Good Morning AI server listening");
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");
    stopScheduler();
    const timeout = setTimeout(() => server.closeAllConnections(), 10000);
    timeout.unref();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    logger.info("Graceful shutdown complete");
  }

  process.once("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
  process.once("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));
  process.once("uncaughtException", (error) => {
    logger.fatal({ error: error.message }, "Uncaught exception");
    shutdown("uncaughtException").finally(() => process.exit(1));
  });
  process.once("unhandledRejection", (error) => {
    logger.fatal({ error: error instanceof Error ? error.message : String(error) }, "Unhandled rejection");
    shutdown("unhandledRejection").finally(() => process.exit(1));
  });
}

start().catch((error) => {
  logger.fatal({ error: error.message }, "Server startup failed");
  process.exitCode = 1;
});
