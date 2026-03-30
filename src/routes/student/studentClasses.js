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

    // ✅ Step 1 — Get all classes the student is enrolled in
    const enrollmentData = await docClient.send(new ScanCommand({
      TableName: "classes",
      FilterExpression: "contains(students, :sid)",
      ExpressionAttributeValues: {
        ":sid": studentId
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
        classSummaries: []
      });
    }

    // ✅ Step 2 — For each class query attendance and compute stats
    let overallPresent = 0;
    let overallAbsent = 0;
    const classSummaries = [];

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
        const attendanceList = Array.isArray(record.attendance)
          ? record.attendance
          : Object.values(record.attendance || {});

        const student = attendanceList.find(s => s.studentId === studentId);

        if (student) {
          const status = typeof student.status === "string"
            ? parseInt(student.status)
            : student.status;

          if (status === 1) classPresent++;
          else if (status === 0) classAbsent++;
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
      classSummaries
    });

  } catch (error) {
    console.error("Error fetching overall attendance:", error);
    return res.status(500).json({ message: "Error fetching overall attendance" });
  }
});


module.exports = studentClass;
