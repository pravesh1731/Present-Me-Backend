const express = require("express");
const adminDownloadAttendance = express.Router();
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { QueryCommand, GetCommand, DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const client = new DynamoDBClient({ region: "ap-south-1" });
const dynamo = DynamoDBDocumentClient.from(client);
const instituteAuth = require("../../middlewares/instituteAuth");
const { docClient } = require("../../dynamoDb");




adminDownloadAttendance.get("/admin/download/class-attendance/:classCode", instituteAuth, async (req, res) => {
  try {

    const { classCode } = req.params;
    const { startDate, endDate } = req.query;

    /// 🔹 1. GET ATTENDANCE DATA
    const attendanceData = await dynamo.send(new QueryCommand({
      TableName: "attendance",
      KeyConditionExpression: "classCode = :cc",
      ExpressionAttributeValues: {
        ":cc": classCode,
      },
    }));

    let records = attendanceData.Items || [];

    /// 🔹 2. FILTER BY DATE
    if (startDate && endDate) {
      records = records.filter(item =>
        item.date >= startDate && item.date <= endDate
      );
    }

    /// 🔹 3. BUILD STUDENT MAP
    const studentMap = {};

    records.forEach(record => {
      record.attendance.forEach(a => {

        if (!studentMap[a.studentId]) {
          studentMap[a.studentId] = {
            studentId: a.studentId,
            attendance: [],
            present: 0,
            absent: 0,
          };
        }

        studentMap[a.studentId].attendance.push({
          date: record.date,
          status: a.status
        });

        if (a.status === 1) {
          studentMap[a.studentId].present++;
        } else {
          studentMap[a.studentId].absent++;
        }
      });
    });

    /// 🔹 4. FETCH STUDENT DETAILS (BATCH)
    const studentIds = Object.keys(studentMap);

    const studentDetails = {};

    await Promise.all(
      studentIds.map(async (id) => {
        const student = await dynamo.send(new GetCommand({
          TableName: "students",
          Key: { studentId: id },
        }));

        if (student.Item) {
          studentDetails[id] = student.Item;
        }
      })
    );

    /// 🔹 5. MERGE DATA
    const result = studentIds.map(id => {
      const s = studentMap[id];
      const info = studentDetails[id] || {};

      const total = s.present + s.absent;

      return {
        studentId: id,

        /// ✅ STUDENT DETAILS
        name: `${info.firstName || ""} ${info.lastName || ""}`.trim(),
        email: info.emailId || "",
        rollNo: info.rollNo || "",
        

        /// ✅ ATTENDANCE
        attendance: s.attendance,
        present: s.present,
        absent: s.absent,
        percentage: total > 0
          ? Math.round((s.present / total) * 100)
          : 0,
      };
    });

    res.json({
      classCode,
      totalDays: records.length,
      totalStudents: result.length,
      students: result,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching attendance" });
  }
});

adminDownloadAttendance.get("/admin/classes", instituteAuth, async (req, res) => {
  try {
    const instituteId = req.institute.institutionId // from instituteAuth middleware

    // Step 1: Scan all teachers and filter by institutionId in JS
    const teachersResult = await docClient.send(new ScanCommand({
      TableName: "teachers",
      ProjectionExpression: "teacherId, firstName, lastName, institutionId"
    }));

    const teachers = (teachersResult.Items || []).filter(
      t => t.institutionId === instituteId
    );

    if (teachers.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Step 2: Build teacherId → name map
    const teacherMap = {};
    teachers.forEach(t => {
      teacherMap[t.teacherId] = `${t.firstName} ${t.lastName}`;
    });

    const teacherIds = Object.keys(teacherMap);

    // Step 3: Scan all classes and filter in JS
    const classesResult = await docClient.send(new ScanCommand({
      TableName: "classes",
      ProjectionExpression: "classCode, classId, className, classDays, startTime, endTime, roomNo, isActive, createdBy, createdAt, students"
    }));

    const allClasses = classesResult.Items || [];

    const instituteClasses = allClasses
      .filter(cls => teacherIds.includes(cls.createdBy))
      .map(cls => ({
        classCode: cls.classCode,
        classId: cls.classId,
        className: cls.className,
        classDays: cls.classDays || [],
        startTime: cls.startTime,
        endTime: cls.endTime,
        roomNo: cls.roomNo,
        isActive: cls.isActive ?? true,
        createdAt: cls.createdAt,
        teacherId: cls.createdBy,
        teacherName: teacherMap[cls.createdBy] || "Unknown",
        totalStudents: Array.isArray(cls.students) ? cls.students.length : 0,
      }));

    return res.status(200).json({
      success: true,
      data: instituteClasses
    });

  } catch (error) {
    console.error("Error fetching institute classes:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
});

module.exports = adminDownloadAttendance;