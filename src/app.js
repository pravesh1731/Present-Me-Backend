// app.js (API entry)
require("dotenv").config(); // ensure .env is loaded
const express = require("express");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");

const authRouter = require("./routes/admin/auth");
const dashboardrouter = require("./routes/admin/dashboard");
const sAdminRouter = require("./routes/sAdmin/sAdmin_institute");
const sAdminAuth = require("./routes/sAdmin/SAuth");
const studentAuth = require("./routes/student/studentAuth");
const teacherAuth = require("./routes/teacher/teacherAuth");
const studentProfile = require("./routes/student/studentProfile");
const adminRouter = require("./routes/admin/updateTeacStatus");
const teacherProfile = require("./routes/teacher/teacherProfile");
const teacherClass = require("./routes/teacher/teacherCreateClass");
const studentClass = require("./routes/student/studentClasses");
const app = express();
const cors = require("cors");
const attendance = require("./routes/teacher/attendance");
const notice = require("./routes/teacher/notice");
const notes = require("./routes/student/notes");

// Middleware
app.use(cors(
  {
    origin: ['http://localhost:5173', 'http://localhost:5174','https://www.presentme.in','https://presentme.in', ],
    credentials: true,
  }
));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
app.use(cookieParser());


app.use("/", authRouter);
app.use("/", dashboardrouter);
app.use("/", sAdminRouter);
app.use("/", sAdminAuth);
app.use("/", studentAuth);
app.use("/", teacherAuth);
app.use("/", studentProfile);
app.use("/", adminRouter);
app.use("/", teacherProfile);
app.use("/", teacherClass);
app.use("/", studentClass);
app.use("/", attendance);
app.use("/", notice);
app.use("/", notes);

// Mount routes
// app.use('/api/institutions', institutionRoutes);

// Example root
app.get("/", (req, res) => res.send("Present-Me back running"));

// Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
