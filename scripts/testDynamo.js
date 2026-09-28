const { docClient } = require("../src/config/dynamodb");
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

(async () => {
  try {
    const result = await docClient.send(new ScanCommand({ TableName: "Institutions", Limit: 1 }));
    console.log("✅ DynamoDB Connected! Sample result:", result);
  } catch (err) {
    console.error("❌ DynamoDB Connection Error:", err);
  }
})();
