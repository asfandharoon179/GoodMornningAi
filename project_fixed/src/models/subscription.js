const mongoose = require("mongoose");

const pushSubscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
  },
}, { _id: false });

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  pushSubscription: { type: pushSubscriptionSchema },
  time: { type: String, required: true, default: "04:00" },
  timezone: { type: String, required: true, default: "Asia/Karachi" },
  language: { type: String, required: true, default: "English" },
  tone: { type: String, required: true, default: "Motivational" },
  enabled: { type: Boolean, default: true },
  lastSentDate: { type: String, default: "" },
  failureCount: { type: Number, default: 0 },
  claimedForDate: { type: String, default: "" },
  claimedAt: { type: Date, default: null },
  userEmail: { type: String, select: false },
  userName: { type: String, select: false },
  subscription: { type: mongoose.Schema.Types.Mixed, select: false },
}, { timestamps: true, collection: "subscriptions" });

subscriptionSchema.index({ "pushSubscription.endpoint": 1 }, { unique: true, sparse: true });
subscriptionSchema.index({ enabled: 1, time: 1, lastSentDate: 1 });
subscriptionSchema.index({ userId: 1, enabled: 1 });

module.exports = mongoose.models.Subscription || mongoose.model("Subscription", subscriptionSchema);
