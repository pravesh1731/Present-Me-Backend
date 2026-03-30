const express = require("express");
const studAuth = require("../../middlewares/student_auth");
const {
  addJoinRequest,
  getStudentJoinRequests,
  getStudentEnrollClasses,
  
} = require("../../services/studentService");
const { GetCommand, UpdateCommand, ScanCommand,QueryCommand } = require("@aws-sdk/lib-dynamodb");
const studentClass = express.Router();
const { docClient } = require("../../dynamoDb");



const TABLE_NAME = "classes";

studentClass.post("/students/joinRequests", studAuth, async (req, res) => {
  try {
    const student = req.student;
    const { classCode } = req.body;

    if (!student) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    if (!classCode) {
      return res.status(400).json({ error: "Class code is required" });
    }

    if (classCode.length !== 6) {
      return res.status(400).json({ error: "Class code must be 6 Digits" });
    }

    const getCmd = new GetCommand({
      TableName: "classes",
      Key: { classCode },
    });
    const result = await docClient.send(getCmd);

    if (!result.Item) {
      return res.status(404).json({ error: "Class Code is Incorrect" });
    }

    const classItem = result.Item;

    //check if student already joined the class
    if (
      classItem.students &&
      classItem.students.includes(student.studentId)
    ) {
      return res.status(400).json({ error: "Already joined the class" });
    }

    //check if student already requested to join
    if (
      classItem.joinRequests &&
      classItem.joinRequests.includes(student.studentId)
    ) {
      return res.status(400).json({ error: "Join request already sent" });
    }
    

    await addJoinRequest(classCode, student.studentId);

    return res
      .status(200)
      .json({ success: true, message: "Join request sent successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

studentClass.get("/students/ViewJoinRequests", studAuth, async (req, res) => {
  try {
    const student = req.student;
    if (!student) {
      return res.status(400).json({ message: "Student ID is required" });
    }
    

    const classes = await getStudentJoinRequests(student.studentId);

    if (!classes || classes.length === 0) {
      return res.status(404).json({ message: "No join requests found" });
    }

    res.status(200).json({
      success: true,
      total: classes.length,
      data: classes,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

studentClass.get("/students/enrolledClasses", studAuth, async (req, res) => {
  try {
    const studentId = req.student?.studentId;

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

studentClass.patch("/students/leaveClass", studAuth, async (req, res) => {
  try {
    const studentId = req.student?.studentId;
    const { classCode } = req.body;

    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    if (!classCode) {
      return res.status(400).json({ message: "Class code is required" });
    }

    const getCmd = new GetCommand({
      TableName: TABLE_NAME,
      Key: { classCode },
    });
    const result = await docClient.send(getCmd);

    if (!result.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    const classItem = result.Item;

    if (!classItem.joinRequests || !classItem.joinRequests.includes(studentId)) {
      return res.status(400).json({ message: "Student request is not for this class" });
    }

    // Remove student from the class
    classItem.joinRequests = classItem.joinRequests.filter(id => id !== studentId);

    const updateCmd = {
      TableName: TABLE_NAME,
      Key: { classCode },
      UpdateExpression: "SET joinRequests = :joinRequests",
      ExpressionAttributeValues: {
        ":joinRequests": classItem.joinRequests,
      },
    };

    await docClient.send(new UpdateCommand(updateCmd));

    return res.status(200).json({ success: true, message: "Left the class successfully." });
  } catch (error) {
    console.error("Error leaving class:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

studentClass.get("/students/attendance-overall", studAuth, async (req, res) => {
  try {
    const studentId = req.student?.studentId;

    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    // ✅ Get last 6 months keys
    const getLast6Months = () => {
      const months = [];
      const now = new Date();

      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months.push(key);
      }

      return months;
    };

    const last6Months = getLast6Months();

    // ================= STEP 1 — ACTIVE CLASSES =================
    const enrollmentData = await docClient.send(new ScanCommand({
      TableName: "classes",
      FilterExpression: "contains(students, :sid) AND isActive = :active",
      ExpressionAttributeValues: {
        ":sid": studentId,
        ":active": true
      }
    }));

    const enrolledClasses = enrollmentData.Items || [];

    if (enrolledClasses.length === 0) {
      return res.status(200).json({
        success: true,
        totalClassesJoined: 0,
        overallPresent: 0,
        overallAbsent: 0,
        overallTotalClasses: 0,
        overallAttendancePercentage: 0,
        classSummaries: [],
        monthlySummary: []
      });
    }

    // ================= STEP 2 — PROCESS =================
    let overallPresent = 0;
    let overallAbsent = 0;

    const classSummaries = [];
    const monthlyStats = {}; // 🔥 NEW

    for (const enrolledClass of enrolledClasses) {
      const classCode = enrolledClass.classCode;

      const attendanceData = await docClient.send(new QueryCommand({
        TableName: "attendance",
        KeyConditionExpression: "classCode = :c",
        ExpressionAttributeValues: {
          ":c": classCode
        }
      }));

      const records = attendanceData.Items || [];

      let classPresent = 0;
      let classAbsent = 0;

      for (const record of records) {
        // ⚠️ Ensure your DB has record.date
        const date = new Date(record.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        // ❌ Skip if not in last 6 months
        if (!last6Months.includes(monthKey)) continue;

        // init month
        if (!monthlyStats[monthKey]) {
          monthlyStats[monthKey] = { present: 0, absent: 0 };
        }

        const attendanceList = Array.isArray(record.attendance)
          ? record.attendance
          : Object.values(record.attendance || {});

        const student = attendanceList.find(s => s.studentId === studentId);

        if (student) {
          const status = typeof student.status === "string"
            ? parseInt(student.status)
            : student.status;

          if (status === 1) {
            classPresent++;
            monthlyStats[monthKey].present++;
          } else if (status === 0) {
            classAbsent++;
            monthlyStats[monthKey].absent++;
          }
        }
      }

      const classTotalClasses = classPresent + classAbsent;

      const attendancePercentage = classTotalClasses > 0
        ? parseFloat(((classPresent / classTotalClasses) * 100).toFixed(1))
        : 0.0;

      overallPresent += classPresent;
      overallAbsent += classAbsent;

      classSummaries.push({
        classCode,
        className: enrolledClass.className ?? "Unknown",
        totalPresent: classPresent,
        totalAbsent: classAbsent,
        totalClasses: classTotalClasses,
        attendancePercentage
      });
    }

    // ================= STEP 3 — MONTHLY SUMMARY =================
    const monthlySummary = last6Months.map(month => {
      const data = monthlyStats[month] || { present: 0, absent: 0 };

      const total = data.present + data.absent;

      const percentage = total > 0
        ? parseFloat(((data.present / total) * 100).toFixed(1))
        : 0;

      return {
        month,
        present: data.present,
        absent: data.absent,
        totalClasses: total,
        attendancePercentage: percentage
      };
    });

    // ================= FINAL =================
    const overallTotalClasses = overallPresent + overallAbsent;

    const overallAttendancePercentage = overallTotalClasses > 0
      ? parseFloat(((overallPresent / overallTotalClasses) * 100).toFixed(1))
      : 0.0;

    return res.status(200).json({
      success: true,
      totalClassesJoined: enrolledClasses.length,
      overallPresent,
      overallAbsent,
      overallTotalClasses,
      overallAttendancePercentage,
      classSummaries,
      monthlySummary // 🔥 NEW FIELD
    });

  } catch (error) {
    console.error("Error fetching overall attendance:", error);
    return res.status(500).json({ message: "Error fetching overall attendance" });
  }
});


module.exports = studentClass;
