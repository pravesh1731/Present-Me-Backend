const express = require("express");
const router = express.Router();

const { verifyEmail } = require("../services/verifaliaService");

router.get("/test-verifalia", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const result = await verifyEmail(email);

    const entry = result?.entries?.[0];

    return res.json({
      success: true,
      email,
      classification: entry?.classification || null,
      status: entry?.status || null,
      result: entry || null,
    });
  } catch (error) {
    console.error("Verifalia test error:", error);

    return res.status(500).json({
      success: false,
      message: "Verifalia validation failed",
      error: error.message,
    });
  }
});

module.exports = router;