const express = require("express");
const {
  getAllInstitutions,
  updateInstitutionStatus,
  getPendingInstitutions,
  getVerifiedInstitutions,
} = require("../../services/aws.service");
const SAuth = require("../../middlewares/superAdminAuth.middleware");
const sAdminRouter = express.Router();

// Get all pending institutions
sAdminRouter.get("/sadmin/pendingInstitutes", SAuth, async (req, res) => {
  try {
    // console.log("SAdmin accessing all institutions:", req.admin);
    const institutions = await getPendingInstitutions();
    res.status(200).json({ success: true, data: institutions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all verified institutions
sAdminRouter.get("/sadmin/verifiedInstitutes", SAuth, async (req, res) => {
  try {
    const institutions = await getVerifiedInstitutions();
    res.status(200).json({ success: true, data: institutions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


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
