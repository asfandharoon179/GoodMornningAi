const test = require("node:test");
const assert = require("node:assert/strict");
const {
  claimDueSubscription,
  getLocalDateTime,
  isDue,
} = require("../src/services/notification-utils");

test("notification matching uses each IANA timezone and local calendar date", () => {
  const morningUtc = new Date("2024-01-15T12:00:00.000Z");
  assert.deepEqual(getLocalDateTime(morningUtc, "America/New_York"), {
    date: "2024-01-15",
    time: "07:00",
  });

  const previousLocalDay = new Date("2024-01-15T04:30:00.000Z");
  assert.deepEqual(getLocalDateTime(previousLocalDay, "America/Los_Angeles"), {
    date: "2024-01-14",
    time: "20:30",
  });

  const daylightSaving = new Date("2024-03-10T07:30:00.000Z");
  assert.equal(getLocalDateTime(daylightSaving, "America/New_York").time, "03:30");
});

test("a matching subscription is not due twice on its local date", () => {
  const now = new Date("2024-03-10T07:30:00.000Z");
  const subscription = {
    enabled: true,
    timezone: "America/New_York",
    time: "03:30",
    lastSentDate: "",
  };
  assert.equal(isDue(subscription, now), "2024-03-10");
  assert.equal(isDue({ ...subscription, lastSentDate: "2024-03-10" }, now), null);
  assert.equal(isDue({ ...subscription, enabled: false }, now), null);
});

test("atomic claim prevents overlapping scheduler runs from claiming the same day", async () => {
  const record = {
    _id: "subscription-1",
    enabled: true,
    lastSentDate: "",
    claimedForDate: "",
    claimedAt: null,
  };
  const model = {
    async findOneAndUpdate(filter, update) {
      const available = filter.$or.some((condition) => {
        if (condition.claimedForDate) return record.claimedForDate !== condition.claimedForDate.$ne;
        if (Object.hasOwn(condition, "claimedAt")) {
          if (condition.claimedAt === null) return record.claimedAt === null;
          return record.claimedAt && record.claimedAt < condition.claimedAt.$lt;
        }
        return false;
      });
      if (filter._id !== record._id || !record.enabled ||
          record.lastSentDate === filter.lastSentDate.$ne || !available) return null;
      Object.assign(record, update.$set);
      return { ...record };
    },
  };

  const now = new Date("2024-03-10T07:30:00.000Z");
  const claims = await Promise.all([
    claimDueSubscription(model, record._id, "2024-03-10", now),
    claimDueSubscription(model, record._id, "2024-03-10", now),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});
