const express = require("express");
const {
  getAllInstitutions,
  updateInstitutionStatus,
  getPendingInstitutions,
  getVerifiedInstitutions,
  findById,
} = require("../../services/aws.service");
const {
  getAllTeachersByInstitution,
  getAllStudentsByInstitution,
} = require("../../services/teacher.service");
const { stripSensitive } = require("../../utils/sanitize");
const SAuth = require("../../middlewares/superAdminAuth.middleware");
const sAdminRouter = express.Router();

const newestFirst = (a, b) =>
  new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

// Get all pending institutions
sAdminRouter.get("/sadmin/pendingInstitutes", SAuth, async (req, res) => {
  try {
    // console.log("SAdmin accessing all institutions:", req.admin);
    const institutions = await getPendingInstitutions();
    res
      .status(200)
      .json({ success: true, data: institutions.map(stripSensitive) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all verified institutions
sAdminRouter.get("/sadmin/verifiedInstitutes", SAuth, async (req, res) => {
  try {
    const institutions = await getVerifiedInstitutions();
    res
      .status(200)
      .json({ success: true, data: institutions.map(stripSensitive) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get every teacher (any status) of one institution
sAdminRouter.get(
  "/sadmin/institutes/:institutionId/teachers",
  SAuth,
  async (req, res) => {
    try {
      const { institutionId } = req.params;

      const institution = await findById(
        institutionId,
        "Institutions",
        "institutionId"
      );
      if (!institution) {
        return res
          .status(404)
          .json({ success: false, message: "Institution not found" });
      }

      const teachers = await getAllTeachersByInstitution(institutionId);
      const data = teachers.map(stripSensitive).sort(newestFirst);

      res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Get every student of one institution
sAdminRouter.get(
  "/sadmin/institutes/:institutionId/students",
  SAuth,
  async (req, res) => {
    try {
      const { institutionId } = req.params;

      const institution = await findById(
        institutionId,
        "Institutions",
        "institutionId"
      );
      if (!institution) {
        return res
          .status(404)
          .json({ success: false, message: "Institution not found" });
      }

      const students = await getAllStudentsByInstitution(institutionId);
      const data = students.map(stripSensitive).sort(newestFirst);

      res.status(200).json({ success: true, count: data.length, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);


// ✅ Update institution status
sAdminRouter.patch(
  "/sadmin/institutes/:institutionId/status",
  SAuth,
  async (req, res) => {
    try {
      const { institutionId } = req.params;
      const { status } = req.body; // e.g., { "status": "verified" }

      const updated = await updateInstitutionStatus(institutionId, status,"Institutions","institutionId");
      res.status(200).json({
        success: true,
        message: `Institution status updated to '${status}'`,
        data: updated,
      });
    } catch (err) {
      console.error(err);
      res.status(400).json({ success: false, message: err.message });
    }
  }
);

module.exports = sAdminRouter;
