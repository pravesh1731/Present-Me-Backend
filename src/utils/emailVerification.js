const crypto = require("crypto");

function generateVerificationToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashVerificationToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

module.exports = {
  generateVerificationToken,
  hashVerificationToken,
};