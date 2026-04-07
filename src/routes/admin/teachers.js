const express = require("express");
const { getClassesByTeacher } = require("../../services/teacherService");
const instituteAuth = require("../../middlewares/instituteAuth");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const { QueryCommand, DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const teacher = express.Router();
const client= new DynamoDBClient();

teacher.get("/admin/teachers/:teacherId/classes", instituteAuth ,async (req, res) => {
  const { teacherId } = req.params;
  
  if (!teacherId) {
    return res.status(400).json({ 
      success: false,
      message: "Teacher ID is required" 
    });
  }
  
  try {
    const classes = await getClassesByTeacher(teacherId);
    
    if (!classes || classes.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No classes found for this teacher"
      });
    }
    
    return res.status(200).json({
      success: true,
      data: classes,
      count: classes.length
    });
  } catch (err) {
    console.error("Error fetching teacher classes:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  }
});

teacher.get("/admin/class/:classCode/students", instituteAuth, async (req, res) => {
  try {
    const { classCode } = req.params;

    if (!classCode) {
      return res.status(400).json({ message: "Class code is required" });
    }

    // Fetch class details
    const classData = await client.send(new GetCommand({
      TableName: "classes",
      Key: { classCode }
    }));

    if (!classData.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    const classItem = classData.Item;

    const classInfo = {
      classCode: classItem.classCode,
      className: classItem.className,
      isActive: classItem.isActive,
      createdBy: classItem.createdBy,
      createdAt: classItem.createdAt,
      endTime: classItem.endTime,
      startTime: classItem.startTime,
    };

    const students = classItem.students || [];

    // Query all attendance records for this classCode
    const { QueryCommand } = require("@aws-sdk/lib-dynamodb");
    const attendanceData = await client.send(new QueryCommand({
      TableName: "attendance",
      KeyConditionExpression: "classCode = :classCode",
      ExpressionAttributeValues: {
        ":classCode": classCode
      }
    }));

    const allDateRecords = attendanceData.Items || [];

    // Build Map<studentId, { present, total }> from all date records
    const studentAttendanceMap = {};
    allDateRecords.forEach((record) => {
      const dailyAttendance = record.attendance || [];
      dailyAttendance.forEach(({ studentId, status }) => {
        if (!studentAttendanceMap[studentId]) {
          studentAttendanceMap[studentId] = { present: 0, total: 0 };
        }
        studentAttendanceMap[studentId].total += 1;
        if (status === 1) {
          studentAttendanceMap[studentId].present += 1;
        }
      });
    });

    // Fetch student details + attach attendance summary
    const studentDetails = await Promise.all(students.map(async (studentId) => {
      const studentData = await client.send(new GetCommand({
        TableName: "students",
        Key: { studentId }
      }));

      const student = studentData.Item;
      if (!student) return null;

      const stats = studentAttendanceMap[studentId] || { present: 0, total: 0 };
      const absent = stats.total - stats.present;
      const percentage = stats.total > 0
        ? parseFloat(((stats.present / stats.total) * 100).toFixed(1))
        : 0.0;

      return {
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        name: `${student.firstName} ${student.lastName}`,
        emailId: student.emailId,
        rollNo: student.rollNo,
        profilePicUrl: student.profilePicUrl || null,
        phone: student.phone,
        attendance: {
          totalClasses: stats.total,
          present: stats.present,
          absent,
          percentage,
        }
      };
    }));

    const validStudents = studentDetails.filter(Boolean);

    // Compute statistics
    const totalStudents = validStudents.length;
    let goodAttendance = 0;   // >= 75%
    let averageAttendance = 0; // >= 50% and < 75%
    let poorAttendance = 0;   // < 50%
    let totalPercentageSum = 0;

    validStudents.forEach(({ attendance }) => {
      const pct = attendance.percentage;
      totalPercentageSum += pct;
      if (pct >= 75) {
        goodAttendance += 1;
      } else if (pct >= 50) {
        averageAttendance += 1;
      } else {
        poorAttendance += 1;
      }
    });

    const averageAttendancePercentage = totalStudents > 0
      ? parseFloat((totalPercentageSum / totalStudents).toFixed(1))
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        classInfo,
        students: validStudents,
        statistics: {
          totalStudents,
          goodAttendance,
          averageAttendance,
          poorAttendance,
          averageAttendancePercentage,
        }
      }
    });

  } catch (error) {
    console.error("Error fetching class details for admin", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});
module.exports = teacher;