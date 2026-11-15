const CLAIM_LEASE_MS = 10 * 60 * 1000;

function getLocalDateTime(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function isDue(subscription, now = new Date()) {
  if (!subscription.enabled) return null;
  const local = getLocalDateTime(now, subscription.timezone || "UTC");
  if (local.time !== subscription.time || local.date === subscription.lastSentDate) return null;
  return local.date;
}

async function claimDueSubscription(model, subscriptionId, localDate, now = new Date()) {
  const staleBefore = new Date(now.getTime() - CLAIM_LEASE_MS);
  return model.findOneAndUpdate(
    {
      _id: subscriptionId,
      enabled: true,
      lastSentDate: { $ne: localDate },
      $or: [
        { claimedForDate: { $ne: localDate } },
        { claimedAt: null },
        { claimedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { claimedForDate: localDate, claimedAt: now } },
    { new: true },
  );
}

module.exports = { claimDueSubscription, getLocalDateTime, isDue };
