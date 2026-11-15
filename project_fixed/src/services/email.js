const nodemailer = require("nodemailer");
const config = require("../config");

async function sendPasswordResetEmail(email, token) {
  if (!config.smtpEnabled) throw new Error("Password-reset email delivery is not configured.");

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  });
  const url = new URL("/", config.BASE_URL);
  url.searchParams.set("resetToken", token);

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: "Reset your Good Morning AI password",
    text: `Use this link within 30 minutes to reset your password: ${url.toString()}`,
    html: `<p>Use this link within 30 minutes to reset your password:</p><p><a href="${url.toString()}">Reset password</a></p>`,
  });
}

module.exports = { sendPasswordResetEmail };
