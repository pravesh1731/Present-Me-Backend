const jwt = require("jsonwebtoken");
const { findByEmail } = require("../services/awsService");

const SAuth = async (req, res, next) => {
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
    console.log(id);

    if (!id) {
      return res.status(401).json({ message: "Admin not found" });
    }
console.log("Decoded token:", id.emailId.toLowerCase());
    // Load full user by email
    const AdminEmail = await findByEmail(id.emailId, "admin");
    if (!AdminEmail) {
      return res.status(404).json({ message: "User not found" });
    }
    req.admin = AdminEmail; //attach user info to request object
    next(); //proceed to next middleware or route handler
  } catch (err) {
    console.error("Auth error : ", err);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports = SAuth;
