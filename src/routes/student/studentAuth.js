const express = require("express");
const { createStudent } = require("../../services/studentService");
const { validateStudentSchema } = require("../../validations/validation");
const studentAuth = express.Router();
const awsService = require("../../services/awsService");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const studAuth = require("../../middlewares/student_auth");
const anyAuth = require("../../middlewares/anyAuth");
// const studentAuth = require("../../middlewares/student_auth");

//signup route
studentAuth.post("/students/signup", async (req, res) => {
  try {
    const { error, value } = validateStudentSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }
    const {
      firstName,
      lastName,
      emailId,
      phone,
      institutionId,
      password,
      rollNo,
    } = value;

    const existingStudent = await awsService.findByEmail(emailId, "students");
    if (existingStudent) {
      return res
        .status(409)
        .json({ message: "Email already exists, Register with new account" });
    }

    const student = await createStudent({
      firstName,
      lastName,
      emailId,
      phone,
      institutionId,
      password,
      rollNo,
    });

    res.status(201).json({ success: true, data: student });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Signin route
studentAuth.post("/students/login", async (req, res) => {
  try {
    const { emailId, password } = req.body;

    //validate input
    if (!emailId || !password) {
      return res
        .status(400)
        .json({ message: "Email and Password are required" });
    }
    // Find student by email
    const student = await awsService.findByEmail(emailId, "students");
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    //compare password
    const isMatch = await bcrypt.compare(password, student.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    //create JWT token    cccheckkk
    const token = jwt.sign({ id: student.studentId }, process.env.JWT_SECRET, {
      expiresIn: "2d",
    });

    //set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", //set secure flag in production
      sameSite: "Strict",
      maxAge: 2 * 24 * 60 * 60 * 1000, //2 days
    });
    return res.status(200).json({
      message: "Login successful",
      token, //also send token in response body
      student,
    });
  } catch (err) {
    console.error("Error in /login:", err);
    res
      .status(500)
      .json({ message: "Internal server error", error: err.message });
  }
});

// logout route
studentAuth.post("/students/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
});

//Change Password Route
studentAuth.post("/change-password", anyAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    // Validate input
    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "Old password and new password are required",
      });
    }

    let user, tableName, keyName, userId;

    // Identify user type
    if (req.student) {
      user = req.student;
      tableName = "students";
      keyName = "studentId";
      userId = user.studentId;
    } else if (req.teacherId) {
      user = req.teacherId; // this is actually teacher object
      tableName = "teachers";
      keyName = "teacherId";
      userId = user.teacherId;
    } else {
      return res.status(401).json({ message: "Unauthorized user" });
    }

    // Check old password
    const isMatch = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    // Hash new password
    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await awsService.updatePassword(
      userId,
      newHashedPassword,
      tableName,
      keyName
    );

    res.status(200).json({
      message: "Password changed successfully",
    });

  } catch (err) {
    console.error("Error in /change-password:", err);
    res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
});

module.exports = studentAuth;
