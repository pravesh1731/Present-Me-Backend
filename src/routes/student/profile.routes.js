const express = require("express");
const studAuth = require("../../middlewares/studentAuth.middleware");
const studentProfile = express.Router();
const {DynamoDBClient}= require("@aws-sdk/client-dynamodb");
const {ScanCommand}= require("@aws-sdk/lib-dynamodb");
const {uploadStudentProfileImage, patchStudentProfile}= require("../../controllers/student.controller");

const client= new DynamoDBClient();
const TABLE_NAME="classes";

studentProfile.get("/students/profile", studAuth, async (req, res) => {
  try {
    const student = req.student;

    if (!student){
      return res.status(400).json({ message: "Student ID is required" });
    }

    res.status(200).json({ success: true, data: student});
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


studentProfile.patch("/students/profile",
  studAuth,
  uploadStudentProfileImage,  // multer
  patchStudentProfile         // controller
);





module.exports = studentProfile;
