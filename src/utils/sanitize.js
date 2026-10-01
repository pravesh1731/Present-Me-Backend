// Fields that must never be sent to a client: password hashes, verification tokens, secrets.
const SENSITIVE_KEY = /pass(word)?|hash|token|secret/i;

// Returns a copy of a DB record without credential-like fields.
function stripSensitive(record) {
  if (!record || typeof record !== "object") return record;

  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !SENSITIVE_KEY.test(key))
  );
}

module.exports = { stripSensitive };
