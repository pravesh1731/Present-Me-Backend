const express = require("express");
const {
  createStudent,
  createWallet,
} = require("../../services/studentService");
const { validateStudentSchema } = require("../../validations/validation");
const studentAuth = express.Router();
const awsService = require("../../services/awsService");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const anyAuth = require("../../middlewares/anyAuth");
const { verifyEmail } = require("../../services/verifaliaService");
const {
  generateVerificationToken,
  hashVerificationToken,
} = require("../../utils/emailVerification");
const { sendVerificationEmail } = require("../../services/emailService");
const { UpdateCommand,  } = require("@aws-sdk/lib-dynamodb");
const {  dbClient } = require("../../dynamoDb");
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");


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
      semester,
    } = value;

    const existingStudent = await awsService.findByEmail(emailId, "students");
    if (existingStudent) {
      return res
        .status(409)
        .json({ message: "Email already exists, Register with Other Email" });
    }

    // 2. Verify email with Verifalia
    const verifaliaResult = await verifyEmail(emailId);

    const verificationEntry = verifaliaResult?.entries?.[0];

    if (
      !verificationEntry ||
      verificationEntry.status !== "Success" ||
      verificationEntry.classification !== "Deliverable"
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid and deliverable email address.",
        classification: verificationEntry?.classification || null,
        status: verificationEntry?.status || null,
      });
    }

    // 3. Generate email verification token
    const verificationToken = generateVerificationToken();

    // Store only the hash in DynamoDB
    const verificationTokenHash = hashVerificationToken(verificationToken);

    // Token expires in 24 hours
    const verificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000,
    ).toISOString();

    const student = await createStudent({
      firstName,
      lastName,
      emailId,
      phone,
      institutionId,
      password,
      rollNo,
      semester,

      emailVerified: false,
      emailVerifiedAt: null,
      emailVerificationTokenHash: verificationTokenHash,
      emailVerificationExpiresAt: verificationExpiresAt,
    });

    await createWallet(student.studentId);

    await sendVerificationEmail({
      email: emailId,
      firstName,
      verificationToken,
    });

    res
      .status(201)
      .json({
        success: true,
        data: student,
        message: "Account created successfully. Please verify your email.",
      });
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

    // Check email verification
    if (student.emailVerified !== true) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Email verification required",
        email: student.emailId,
      });
    }

    //create JWT token    cccheckkk
    const token = jwt.sign({ id: student.studentId }, process.env.JWT_SECRET);

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
      keyName,
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

//verify email route
studentAuth.get("/students/verify-email", async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Verification token is required",
      });
    }

    // Hash the token received from the email
    const tokenHash = hashVerificationToken(token);

    // Find student using verification token
   const result = await dbClient.send(
  new QueryCommand({
    TableName: "students",
    IndexName: "emailVerificationTokenHash-index",

    KeyConditionExpression:
      "emailVerificationTokenHash = :tokenHash",

    ExpressionAttributeValues: {
      ":tokenHash": tokenHash,
    },

    Limit: 1,
  })
);

    const student = result.Items?.[0];

    if (!student) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification link",
      });
    }

    // Check expiration
    if (
      !student.emailVerificationExpiresAt ||
      new Date(student.emailVerificationExpiresAt) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Verification link has expired",
      });
    }

    // Already verified
    if (student.emailVerified === true) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified",
      });
    }

    // Update student
    await dbClient.send(
      new UpdateCommand({
        TableName: "students",
        Key: {
          studentId: student.studentId,
        },
        UpdateExpression: `
          SET emailVerified = :verified,
              emailVerifiedAt = :verifiedAt
          REMOVE emailVerificationTokenHash,
                 emailVerificationExpiresAt
        `,
        ExpressionAttributeValues: {
          ":verified": true,
          ":verifiedAt": new Date().toISOString(),
        },
      })
    );

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (err) {
    console.error("Email verification error:", err);

    return res.status(500).json({
      success: false,
      message: "Email verification failed",
    });
  }
});

//resent verification email route
studentAuth.post("/students/resend-verification", async (req, res) => {
  try {
    const { emailId } = req.body;

    if (!emailId) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = emailId.toLowerCase();

    // Find student
    const student = await awsService.findByEmail(
      normalizedEmail,
      "students"
    );

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    // Already verified
    if (student.emailVerified === true) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new token
    const verificationToken = generateVerificationToken();

    // Hash token
    const verificationTokenHash =
      hashVerificationToken(verificationToken);

    // New expiry: 24 hours
    const verificationExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    // Update student
    await dbClient.send(
      new UpdateCommand({
        TableName: "students",
        Key: {
          studentId: student.studentId,
        },
        UpdateExpression: `
          SET emailVerificationTokenHash = :tokenHash,
              emailVerificationExpiresAt = :expiresAt
        `,
        ExpressionAttributeValues: {
          ":tokenHash": verificationTokenHash,
          ":expiresAt": verificationExpiresAt,
        },
      })
    );

    // Send new verification email
    await sendVerificationEmail({
      email: student.emailId,
      firstName: student.firstName,
      verificationToken,
    });

    return res.status(200).json({
      success: true,
      message: "Verification email sent successfully",
    });
  } catch (err) {
    console.error("Resend verification error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to resend verification email",
    });
  }
});

module.exports = studentAuth;
