const jwt = require("jsonwebtoken");
const { findById } = require("../services/aws.service");

const studAuth = async (req, res, next) => {
  try {
    //get token from cookie or AUTHORIZATION OF HEADER
    const token =
      req.cookies?.token ||
      (req.header("Authorization")
        ? req.header("Authorization").replace("Bearer ", "")
        : null);

    if (!token) {
      return res.status(401).json({ message: "No auth token, access denied" });
    }

    //VERIFY TOKEN
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { id } = decoded || {};
    

    if (!id) {
      return res.status(401).json({ message: "Student not found" });
    }

    // Load full user by id
    const student = await findById(id, "students", "studentId");

    // Student tokens always carry studentId, so there is no email fallback.
    // Keep 401 here: clients treat 404 on student routes as "no data".
    if (!student) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    req.student = student; //attach user info to request object
    next(); //proceed to next middleware or route handler
  } catch (err) {
    console.error("Auth error : ", err);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = studAuth;
