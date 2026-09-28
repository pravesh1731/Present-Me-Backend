const express = require("express");

// Admin (institute)
const adminAuthRoutes = require("./admin/auth.routes");
const adminDashboardRoutes = require("./admin/dashboard.routes");
const adminTeacherStatusRoutes = require("./admin/teacherStatus.routes");
const adminTeacherRoutes = require("./admin/teacher.routes");
const adminStudentRoutes = require("./admin/student.routes");
const adminAttendanceRoutes = require("./admin/attendance.routes");

// Super admin
const superAdminInstituteRoutes = require("./superAdmin/institute.routes");
const superAdminAuthRoutes = require("./superAdmin/auth.routes");
const superAdminPyqNotesRoutes = require("./superAdmin/pyqNotes.routes");

// Student
const studentAuthRoutes = require("./student/auth.routes");
const studentProfileRoutes = require("./student/profile.routes");
const studentClassRoutes = require("./student/class.routes");
const studentNotesRoutes = require("./student/notes.routes");

// Teacher
const teacherAuthRoutes = require("./teacher/auth.routes");
const teacherProfileRoutes = require("./teacher/profile.routes");
const teacherClassRoutes = require("./teacher/class.routes");
const teacherAttendanceRoutes = require("./teacher/attendance.routes");
const teacherNoticeRoutes = require("./teacher/notice.routes");

// Common / public / dev
const deleteAccountRoutes = require("./common/deleteAccount.routes");
const publicStatsRoutes = require("./public/stats.routes");
const verifaliaRoutes = require("./dev/verifalia.routes");
const testEmailRoutes = require("./dev/testEmail.routes");

const router = express.Router();

// Mount order is significant: Express matches routes in registration order and
// some paths are registered more than once, so do not reorder these.
router.use("/", adminAuthRoutes);
router.use("/", adminDashboardRoutes);
router.use("/", superAdminInstituteRoutes);
router.use("/", superAdminAuthRoutes);
router.use("/", studentAuthRoutes);
router.use("/", teacherAuthRoutes);
router.use("/", studentProfileRoutes);
router.use("/", adminTeacherStatusRoutes);
router.use("/", teacherProfileRoutes);
router.use("/", teacherClassRoutes);
router.use("/", studentClassRoutes);
router.use("/", teacherAttendanceRoutes);
router.use("/", teacherNoticeRoutes);
router.use("/", studentNotesRoutes);
router.use("/", deleteAccountRoutes);
router.use("/", adminTeacherRoutes);
router.use("/", adminStudentRoutes);
router.use("/", adminAttendanceRoutes);
router.use("/", superAdminPyqNotesRoutes);
router.use("/", verifaliaRoutes);
router.use("/", testEmailRoutes);
router.use("/", publicStatsRoutes);

module.exports = router;
