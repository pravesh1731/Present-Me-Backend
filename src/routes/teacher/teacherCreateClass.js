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

    const classes = result.classes || []; // ✅ FIX

    const totalStudents = classes.reduce((sum, cls) => {
      return sum + (Array.isArray(cls.students) ? cls.students.length : 0);
    }, 0);

    return res.status(200).json({
      success: true,
      totalStudents,
    });

  } catch (err) {
    console.error("❌ ERROR:", err);

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


module.exports = teacherClass;
