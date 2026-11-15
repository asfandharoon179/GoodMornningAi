const mongoose = require("mongoose");

const preferencesSchema = new mongoose.Schema({
  language: { type: String, default: "English" },
  tone: { type: String, default: "Motivational" },
  defaultCardStyle: { type: String, default: "sunrise" },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, select: false },
  password: { type: String, select: false },
  dailyUsage: {
    date: { type: String, default: "" },
    count: { type: Number, default: 0 },
  },
  dailyGenerations: { type: Number, select: false },
  lastGenerationDate: { type: String, select: false },
  preferences: { type: preferencesSchema, default: () => ({}) },
  resetTokenHash: { type: String, select: false },
  resetTokenExpiresAt: { type: Date, select: false },
}, { timestamps: true, collection: "userprofiles" });

userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
