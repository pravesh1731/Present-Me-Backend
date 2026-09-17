const express = require("express");
const Erouter = express.Router();

const { sendVerificationEmail } = require("../services/emailService");

Erouter.get("/test-email", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }


    await sendVerificationEmail({
      email: email,
      firstName,
      verificationToken,
    });

    return res.json({
      success: true,
      message: "Test verification email sent successfully",
    });
  } catch (error) {
    console.error("Test email error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send email",
      error: error.message,
    });
  }
});

module.exports = Erouter;
