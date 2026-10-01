const express = require("express");
const SAuth = require("../../middlewares/superAdminAuth.middleware");
const {
  getOverview,
  getAllTeachers,
  getAllStudents,
  queryTeachers,
  queryStudents,
} = require("../../services/superAdminData.service");

const overviewRouter = express.Router();

// Dashboard numbers. Cached ~60s server-side; ?refresh=1 forces a fresh read.
overviewRouter.get("/sadmin/overview", SAuth, async (req, res) => {
  try {
    const data = await getOverview({ force: req.query.refresh === "1" });
    res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("Error in /sadmin/overview:", err);
    res.status(500).json({ success: false, message: "Could not load the overview" });
  }
});

// All teachers across institutes.
// Query: page, pageSize (max 100), search, institutionId, status (verified|pending|rejected), sort (newest|oldest|name)
overviewRouter.get("/sadmin/teachers", SAuth, async (req, res) => {
  try {
    const all = await getAllTeachers({ force: req.query.refresh === "1" });
    res.status(200).json({ success: true, ...queryTeachers(all, req.query) });
  } catch (err) {
    console.error("Error in /sadmin/teachers:", err);
    res.status(500).json({ success: false, message: "Could not load teachers" });
  }
});

// All students across institutes.
// Query: page, pageSize (max 100), search, institutionId, verified (verified|unverified), sort (newest|oldest|name)
overviewRouter.get("/sadmin/students", SAuth, async (req, res) => {
  try {
    const all = await getAllStudents({ force: req.query.refresh === "1" });
    res.status(200).json({ success: true, ...queryStudents(all, req.query) });
  } catch (err) {
    console.error("Error in /sadmin/students:", err);
    res.status(500).json({ success: false, message: "Could not load students" });
  }
});

module.exports = overviewRouter;
