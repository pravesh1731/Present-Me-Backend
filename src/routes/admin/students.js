const express = require("express");
const { getStudentEnrollClasses} = require("../../services/studentService");
const instituteAuth = require("../../middlewares/instituteAuth");

const adminStudentClass = express.Router();




adminStudentClass.get("/admin/students/:studentId/classes", instituteAuth, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    const result = await getStudentEnrollClasses(studentId);

    return res.status(200).json({
      success: true,
      total: result.length,
      data: result,
    });
  } catch (error) {
    console.error("error fetching enrolled classes:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = adminStudentClass;