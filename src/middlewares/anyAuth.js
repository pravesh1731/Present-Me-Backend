const jwt = require("jsonwebtoken");
const { findById } = require("../services/awsService");

const anyAuth = async (req, res, next) => {
  console.log('✅ anyAuth called'); // ← add this line
  try {
    const token =
      req.cookies?.token ||
      (req.header("Authorization")
        ? req.header("Authorization").replace("Bearer ", "")
        : null);

    console.log('Token found:', !!token); // ← add this

    if (!token) {
      return res.status(401).json({ message: "No auth token, access denied" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { id } = decoded || {};

    if (!id) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const student = await findById(id, "students", "studentId");
   
    if (student) {
      req.student = student;
      return next();
    }

    const teacher = await findById(id, "teachers", "teacherId");

    if (teacher) {
      req.teacherId = teacher;
      return next();
    }

    return res.status(404).json({ message: "User not found" });

  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = anyAuth;