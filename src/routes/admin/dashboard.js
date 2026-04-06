const express = require("express");
const dashboardrouter = express.Router();
//const userAuth = require("./middlewares/userAuth");
//const router = require("./auth");
const instituteAuth = require("../../middlewares/instituteAuth");
const { uploadProfileImage, patchInstitutionProfile } = require("../../controllers/institutionUpdateController");
const { getVerifiedTeachers, getPendingTeachers, getStudentList } = require("../../services/teacherService");

dashboardrouter.get("/admin/profile", instituteAuth, (req, res) => {
  console.log(req.institute);
  res.json(req.institute);
});


dashboardrouter.patch("/admin/profile",instituteAuth,uploadProfileImage,patchInstitutionProfile);

// Get all verified teachers
dashboardrouter.get("/admin/approvedTeachers", instituteAuth, async (req, res) => {
  try {
    const institutionId = req.institute.institutionId
    const approvedTeachers = await getVerifiedTeachers(institutionId)
    res.status(200).json({ success: true, data: approvedTeachers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all student teachers
dashboardrouter.get("/admin/students", instituteAuth, async (req, res) => {
  try {
    const institutionId = req.institute.institutionId
    const studentList = await getStudentList(institutionId,)
    res.status(200).json({ success: true, data: studentList });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all pending teachers
dashboardrouter.get("/admin/pendingTeachers", instituteAuth, async (req, res) => {
  try {
    const institutionId = req.institute.institutionId
    const pendingTeachers = await getPendingTeachers(institutionId)
    res.status(200).json({ success: true, data: pendingTeachers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = dashboardrouter;
