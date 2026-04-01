const express = require("express");
const { createTeacher } = require("../../services/teacherService");
const {
  teacherSignupSchema,
  teacherLoginSchema,
} = require("../../validations/teacherValidation");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { findByEmail } = require("../../services/awsService");
const tAuth = require("../../middlewares/teacherAuth");
const awsService = require("../../services/awsService");
const { getAllInstitutions } = require("../../services/teacherService");

const teacherAuth = express.Router();

// Teacher Signup Route
teacherAuth.post("/teachers/signup", async (req, res) => {
  try {
    const { error } = teacherSignupSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }
    const existing = await findByEmail(
      req.body.emailId.toLowerCase(),
      "teachers"
    );
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }
    const newTeacher = await createTeacher(req.body);
    res
      .status(201)
      .json({
        success: true,
        message: "Teacher registered successfully",
        teacherId: newTeacher.teacherId,
      });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Teacher Login Route
teacherAuth.post("/teachers/login", async (req, res) => {
  try {
    const { error } = teacherLoginSchema.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }
    const teacher = await findByEmail(
      req.body.emailId.toLowerCase(),
      "teachers"
    );
    if (!teacher) {
      return res
        .status(400)
        .json({ success: false, message: "EmailId not found" });
    }
    const isPasswordValid = await bcrypt.compare(
      req.body.password,
      teacher.passwordHash
    );
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });
    }
    //create JWT token
    const token = jwt.sign(
      {
        id: teacher.teacherId,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2d" }
    );

    //set token in cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 2 * 24 * 60 * 60 * 1000, //2 days
    });

    return res
      .status(200)
      .json({ success: true, message: "Login successful", token, teacher });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// logout route
teacherAuth.post("/teachers/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
});

//get list of collage name for teacher and student signup
teacherAuth.get("/getColleges", async (req, res) => {
  try {
    const institute = await getAllInstitutions();

    // optional: only verified ones
    const verifiedInstitutes = institute.filter(
      (inst) => inst.status === "verified"
    );

    const instituteData = verifiedInstitutes.map((inst) => ({
      id: inst.institutionId,          // this is what you will save with teacher
      name: inst.InstitutionName,      // this is what you will show in UI
    }));
    res.status(200).json({ success: true, data: instituteData });
  } catch (err) {
    console.error("Error in /getColleges:", err);
    res
      .status(500)
      .json({ message: "Internal server error", error: err.message });
  }
});



module.exports = teacherAuth;
