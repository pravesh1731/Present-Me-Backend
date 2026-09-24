const express = require("express");
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../../dynamoDb");

// Public, unauthenticated platform counts for the landing page.
// Returns totals only — never names, emails or IDs.
const publicStats = express.Router();

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null, pending: null };

// COUNT scan, following pagination. Optional filter on a single attribute value.
async function countItems(TableName, filter) {
  let total = 0;
  let ExclusiveStartKey;
  do {
    const params = { TableName, Select: "COUNT", ExclusiveStartKey };
    if (filter) {
      params.FilterExpression = "#f = :v";
      params.ExpressionAttributeNames = { "#f": filter.name };
      params.ExpressionAttributeValues = { ":v": filter.value };
    }
    const res = await docClient.send(new ScanCommand(params));
    total += res.Count || 0;
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return total;
}

async function computeStats() {
  const [institutions, teachers, students, classes, sessions] = await Promise.all([
    countItems("Institutions", { name: "status", value: "verified" }),
    countItems("teachers", { name: "status", value: "verified" }),
    countItems("students"),
    countItems("classes"),
    countItems("attendance"),
  ]);
  return { institutions, teachers, students, classes, sessions, updatedAt: new Date().toISOString() };
}

publicStats.get("/public/stats", async (req, res) => {
  try {
    if (!cache.data || Date.now() - cache.at > CACHE_MS) {
      // Share one in-flight computation between concurrent requests
      cache.pending = cache.pending || computeStats().finally(() => (cache.pending = null));
      cache.data = await cache.pending;
      cache.at = Date.now();
    }
    res.set("Cache-Control", "public, max-age=300");
    res.status(200).json({ success: true, data: cache.data });
  } catch (err) {
    console.error("Error in /public/stats:", err);
    // Serve stale numbers rather than nothing if we have them
    if (cache.data) return res.status(200).json({ success: true, data: cache.data, stale: true });
    res.status(500).json({ success: false, message: "Could not load stats" });
  }
});

module.exports = publicStats;
