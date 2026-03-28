const express = require("express");
const tAuth = require("../../middlewares/teacherAuth");
const {DynamoDBClient}= require("@aws-sdk/client-dynamodb");
const{GetCommand, UpdateCommand} = require("@aws-sdk/lib-dynamodb");
const client= new DynamoDBClient();
const TABLE_NAME="classes";
const {
  createClass,
  deleteClass,
  updateClassName,
  getClassesByTeacher,
} = require("../../services/teacherService");
const { validateClassName } = require("../../validations/validation");
const { data } = require("react-router-dom");
const teacherClass = express.Router();

teacherClass.post("/teachers/class", tAuth, async (req, res) => {
  try {
    const teacher = req.teacherId;
    
    if (!teacher) {
      return res.status(400).json({ message: "Teacher ID is required" });
    }

    const { error, value } = validateClassName.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const { 
      className, 
      roomNo,
      startTime,
      endTime,
      classDays = [],
      } = value;

    const newClass = await createClass({
      className,
      roomNo,
      startTime,
      endTime,
      classDays,
      createdBy: teacher.teacherId,
    });

    res.status(201).json({ success: true, data: newClass });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

teacherClass.delete("/teachers/class/:classCode", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    if (!classCode) {
      return res.status(400).json({ message: "Class code is required" });
    }

    const result = await deleteClass(classCode);
    if (result.success) {
      res.status(200).json({ success: true, message: result.message });
    } else {
      res.status(404).json({ success: false, message: result.message });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

teacherClass.patch("/teachers/class/:classCode", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;

    const { error, value } = validateClassName.validate(req.body);
    if (error) {
      return res
        .status(400)
        .json({ success: false, message: error.details[0].message });
    }

    const { 
      className, 
      roomNo,
      startTime,
      endTime,
      classDays = [],
     } = value;

    if (!classCode) {
      return res.status(400).json({ message: "Class code is not found" });
    }

    if (!className) {
      return res.status(400).json({ message: "Enter the class name" });
    }
    
    if (!roomNo) {
      return res.status(400).json({ message: "Enter the room number" });
    }

    if (!startTime) {
      return res.status(400).json({ message: "Enter the start time" });
    }

    if (!endTime) {
      return res.status(400).json({ message: "Enter the end time" });
    }

     if (classDays.length === 0) {
      return res.status(400).json({ message: "Enter the class days" });
    }

    const updatedClass = await updateClassName(classCode, className, roomNo, startTime, endTime, classDays);

    if (updatedClass.success) {
      res
        .status(200)
        .json({ success: true, data: updatedClass });
    } else {
      res.status(404).json({ success: false, message: updatedClass.message });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

teacherClass.get("/teachers/class", tAuth, async (req, res) => {
  const teacherId = req.teacherId.teacherId; // ✅ your login user id
  if (!teacherId) {
    return res.status(400).json({ message: "Teacher is not found" });
  }
  try {
    const classes = await getClassesByTeacher(teacherId);

    return res.status(200).json(classes);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

teacherClass.get("/teachers/total-students", tAuth, async (req, res) => {
  const teacherId = req.teacherId.teacherId;

  if (!teacherId) {
    return res.status(400).json({ message: "Teacher not found" });
  }

  try {
    const result = await getClassesByTeacher(teacherId);
    const classes = result.classes || [];

    if (classes.length === 0) {
      return res.status(200).json({
        success: true,
        totalStudents: 0,
        totalClasses: 0,
        averageAttendance: 0.0,
      });
    }

    // ✅ Count all enrollments across all classes (duplicates included)
    const totalStudents = classes.reduce((sum, cls) => {
      return sum + (cls.students?.length || 0);
    }, 0);

    // ✅ Total sessions held across all classes
    const totalClasses = classes.reduce((sum, cls) => {
      return sum + (cls.totalClasses || 0);
    }, 0);

    // ✅ Simple average of all class averages (equal weight per class)
    const classesWithSessions = classes.filter(cls => cls.totalClasses > 0);

    const averageAttendance = classesWithSessions.length > 0
      ? parseFloat(
          (
            classesWithSessions.reduce((sum, cls) => sum + (cls.averageAttendance || 0), 0)
            / classesWithSessions.length
          ).toFixed(1)
        )
      : 0.0;

    return res.status(200).json({
      success: true,
      totalStudents,   // e.g. student in 2 classes = counted twice
      totalClasses,    // total sessions held across all classes
      averageAttendance, // e.g. (87.5 + 91.0 + 76.0) / 3 = 84.8
    });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

teacherClass.patch("/teachers/handle-student-request", tAuth, async (req, res) => {
  try {
    const { classCode, studentId, action } = req.body;
    const teacherId = req.teacherId.teacherId;

    if (!classCode || !studentId || !action) {
      return res.status(400).json({ message: "classCode, studentId and action are required" });
    }

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    // Fetch class
    const classData = await client.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { classCode }
    }));

    if (!classData.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    if (classData.Item.createdBy !== teacherId) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    const joinRequests = classData.Item.joinRequests || [];
    const students = classData.Item.students || [];

    if (!joinRequests.includes(studentId)) {
      return res.status(400).json({ message: "Student not found in join requests" });
    }

    // Remove student from joinRequests
    const updatedJoinRequests = joinRequests.filter(id => id !== studentId);

    let updatedStudents = students;

    // If approve → add to students list
    if (action === "approve" && !students.includes(studentId)) {
      updatedStudents = [...students, studentId];
    }

    // Update database
    await client.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { classCode },
      UpdateExpression: "SET joinRequests = :jr, students = :st",
      ExpressionAttributeValues: {
        ":jr": updatedJoinRequests,
        ":st": updatedStudents
      },
    }));

    return res.status(200).json({
      message: action === "approve"
          ? "Student approved successfully"
          : "Student request rejected successfully",
      studentId,
      classCode
    });

  } catch (error) {
    console.error("Error handling student request:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

teacherClass.get("/teachers/class/:classCode/pendingStudentsList", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const teacherId = req.teacherId.teacherId;

    if (!classCode) {
      return res.status(400).json({ message: "Class code is required" });
    }

    // Fetch class details
    const classData = await client.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { classCode }
    }));

    if (!classData.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    if (classData.Item.createdBy !== teacherId) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    const students = classData.Item.joinRequests || [];
    //get student details for each studentId in students array
    const studentDetails = await Promise.all(students.map(async (studentId) => {
      //fetch student details from students table using studentId
      const studentData = await client.send(new GetCommand({
        TableName: "students",
        Key: { studentId }
      }));
      return studentData.Item;
    }));
    return res.status(200).json({ students: studentDetails });
  } catch (error) {
    console.error("Error fetching students", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

teacherClass.get("/teachers/class/:classCode/joinedStudentsList", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const teacherId = req.teacherId.teacherId;

    if (!classCode) {
      return res.status(400).json({ message: "Class code is required" });
    }

    // Fetch class details
    const classData = await client.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { classCode }
    }));

    if (!classData.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    if (classData.Item.createdBy !== teacherId) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    const students = classData.Item.students || [];

    // ✅ Query all attendance records for this classCode (all dates)
    const { QueryCommand } = require("@aws-sdk/lib-dynamodb");

    const attendanceData = await client.send(new QueryCommand({
      TableName: "attendance",
      KeyConditionExpression: "classCode = :classCode",
      ExpressionAttributeValues: {
        ":classCode": classCode
      }
    }));

    const allDateRecords = attendanceData.Items || [];
    // allDateRecords shape:
    // [
    //   { classCode, date: "2026-03-19", attendance: [{ studentId, status }] },
    //   { classCode, date: "2026-03-22", attendance: [{ studentId, status }] },
    // ]

    // ✅ Build Map<studentId, { present, total }> from all date records
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

    // ✅ Fetch student details + attach attendance summary
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
        ...student,
        attendance: {
          totalClasses: stats.total,
          present: stats.present,
          absent,
          percentage,
        }
      };
    }));

    const validStudents = studentDetails.filter(Boolean);

    return res.status(200).json({
      success: true,
      students: validStudents
    });

  } catch (error) {
    console.error("Error fetching students", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});


module.exports = teacherClass;
