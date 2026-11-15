const User = require("../models/user");

async function consumeDailyGeneration(userId, date, limit) {
  const reset = await User.updateOne(
    { _id: userId, "dailyUsage.date": { $ne: date } },
    { $set: { dailyUsage: { date, count: 1 } } },
  );
  if (reset.modifiedCount === 1) return true;

  const increment = await User.updateOne(
    { _id: userId, "dailyUsage.date": date, "dailyUsage.count": { $lt: limit } },
    { $inc: { "dailyUsage.count": 1 } },
  );
  return increment.modifiedCount === 1;
}

module.exports = { consumeDailyGeneration };
