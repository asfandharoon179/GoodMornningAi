const cron = require("node-cron");
const webpush = require("web-push");
const config = require("../config");
const logger = require("../logger");
const Subscription = require("../models/subscription");
const User = require("../models/user");
const { generateGreeting } = require("./ai");
const { renderGreetingCard } = require("./cards");
const { uploadCard } = require("./cloudinary");
const { claimDueSubscription, getLocalDateTime, isDue } = require("./notification-utils");

const BATCH_SIZE = 20;
const MAX_FAILURES = 5;

webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);

async function recordFailure(subscription, error) {
  const update = await Subscription.findByIdAndUpdate(
    subscription._id,
    {
      $inc: { failureCount: 1 },
      $set: { claimedForDate: "", claimedAt: null },
    },
    { new: true },
  );
  if (update && update.failureCount >= MAX_FAILURES) {
    await Subscription.updateOne({ _id: update._id }, { $set: { enabled: false } });
  }
  logger.error({ subscriptionId: String(subscription._id), error: error.message }, "Scheduled notification failed");
}

async function sendForSubscription(subscription, now = new Date()) {
  let localDate;
  try {
    localDate = isDue(subscription, now);
  } catch (error) {
    logger.error({ subscriptionId: String(subscription._id), error: error.message }, "Invalid subscription timezone");
    await Subscription.updateOne({ _id: subscription._id }, { $set: { enabled: false } });
    return false;
  }
  if (!localDate) return false;

  const claimed = await claimDueSubscription(Subscription, subscription._id, localDate, now);
  if (!claimed) return false;

  try {
    const user = await User.findById(claimed.userId);
    if (!user || !claimed.pushSubscription?.endpoint) {
      await Subscription.deleteOne({ _id: claimed._id });
      return false;
    }

    const greeting = await generateGreeting({
      language: claimed.language,
      tone: claimed.tone,
      onChunk: () => {},
      onReset: () => {},
      onReplace: () => {},
    });
    const image = await renderGreetingCard({
      greeting,
      tone: claimed.tone,
      style: user.preferences?.defaultCardStyle || "sunrise",
      userName: user.name,
    });
    const card = await uploadCard(image, user._id);
    const appUrl = new URL("/", config.BASE_URL);
    appUrl.searchParams.set("card", card.public_id);
    appUrl.searchParams.set("msg", greeting);
    appUrl.searchParams.set("image", card.secure_url);

    await webpush.sendNotification(claimed.pushSubscription, JSON.stringify({
      title: "Good Morning!",
      body: greeting,
      image: card.secure_url,
      url: appUrl.toString(),
    }));

    await Subscription.updateOne(
      { _id: claimed._id, claimedForDate: localDate },
      {
        $set: { lastSentDate: localDate, failureCount: 0, claimedForDate: "", claimedAt: null },
      },
    );
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      await Subscription.deleteOne({ _id: claimed._id });
      logger.info({ subscriptionId: String(claimed._id) }, "Removed expired push subscription");
      return false;
    }
    await recordFailure(claimed, error);
    return false;
  }
}

async function processInBatches(now = new Date()) {
  const cursor = Subscription.find({ enabled: true }).cursor();
  let batch = [];
  for await (const subscription of cursor) {
    batch.push(subscription);
    if (batch.length >= BATCH_SIZE) {
      await Promise.all(batch.map((item) => sendForSubscription(item, now)));
      batch = [];
    }
  }
  if (batch.length) await Promise.all(batch.map((item) => sendForSubscription(item, now)));
}

function startScheduler() {
  let running = false;
  const task = cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await processInBatches();
    } catch (error) {
      logger.error({ error: error.message }, "Notification scheduler run failed");
    } finally {
      running = false;
    }
  });
  return () => task.stop();
}

async function migrateLegacySubscriptions() {
  const cursor = Subscription.find({
    userId: { $exists: false },
    userEmail: { $exists: true, $ne: "" },
    "subscription.endpoint": { $exists: true },
  }).select("+subscription +userEmail +userName").cursor();

  for await (const oldSubscription of cursor) {
    const user = await User.findOne({ email: oldSubscription.userEmail });
    if (!user) continue;
    await Subscription.updateOne(
      { _id: oldSubscription._id, userId: { $exists: false } },
      {
        $set: {
          userId: user._id,
          pushSubscription: oldSubscription.subscription,
          enabled: true,
          timezone: oldSubscription.timezone || "Asia/Karachi",
          language: oldSubscription.language || user.preferences?.language || "English",
          tone: oldSubscription.tone || user.preferences?.tone || "Motivational",
        },
      },
    );
  }
}

module.exports = {
  claimDueSubscription,
  getLocalDateTime,
  isDue,
  migrateLegacySubscriptions,
  processInBatches,
  sendForSubscription,
  startScheduler,
};
