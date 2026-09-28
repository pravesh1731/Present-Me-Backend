const { VerifaliaRestClient } = require("verifalia");

const verifalia = new VerifaliaRestClient({
  username: process.env.VERIFALIA_USERNAME,
  password: process.env.VERIFALIA_PASSWORD,
});

async function verifyEmail(email) {
  const result = await verifalia.emailValidations.submit(email);

  return result;
}

module.exports = {
  verifyEmail,
};