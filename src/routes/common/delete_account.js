const { PutCommand } = require("@aws-sdk/lib-dynamodb");
const express = require("express");
const { docClient } = require("../../dynamoDb");
const { v4: uuidv4 } = require("uuid");

// POST /api/delete-request — saves request, sends confirmation email
const deleteRequests = express.Router();

deleteRequests.post("/delete-request", async (req, res) => {
  try {
    const { email, reason } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // ── Save request to DynamoDB ──
    await docClient.send(new PutCommand({
      TableName: "delete_requests",
      Item: {
        requestId:   `del-${uuidv4()}`,
        email:       email.toLowerCase(),
        reason:      reason || "not provided",
        status:      "pending",            // pending | completed
        requestedAt: new Date().toISOString(),
        deleteBy:    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
      },
    }));

    res.status(200).json({ message: "Deletion request received" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit request" });
  }
});

module.exports = deleteRequests;