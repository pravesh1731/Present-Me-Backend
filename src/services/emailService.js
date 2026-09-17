const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

async function sendVerificationEmail({
  email,
  firstName,
  verificationToken,
}) {
  const verificationUrl =`${process.env.FRONTEND_URL}/api/students/verify-email?token=${verificationToken}`;

  const mailOptions = {
    from: `"Present-Me" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your email address",
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Verify your email</h2>

        <p>Hello ${firstName || "there"},</p>

        <p>
          Your account has been created successfully.
          Please verify your email address by clicking the button below.
        </p>

        <p>
          <a
            href="${verificationUrl}"
            style="
              display:inline-block;
              padding:12px 20px;
              background:#2563eb;
              color:white;
              text-decoration:none;
              border-radius:6px;
            "
          >
            Verify Email
          </a>
        </p>

        <p>This verification link expires in 24 hours.</p>

        <p>
          If you did not create this account, you can safely ignore this email.
        </p>
      </div>
    `,
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  sendVerificationEmail,
};