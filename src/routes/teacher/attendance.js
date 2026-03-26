
const express = require("express");
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const tAuth = require("../../middlewares/teacherAuth");
const studAuth = require("../../middlewares/student_auth");
const client = new DynamoDBClient({ region: "ap-south-1" });
const dynamo = DynamoDBDocumentClient.from(client);

const attendance = express.Router();
const TABLE_NAME = "attendance";

attendance.post("/teachers/mark-attendance",tAuth, async (req, res) => {
  try {

    const { classCode, date, attendance, teacherId } = req.body;

    if (!classCode || !date || !attendance) {
      return res.status(400).json({ message: "classCode, date and attendance are required" });
    }
    

    // Check if attendance already exists
    const checkParams = {
      TableName: TABLE_NAME,
      Key: {
        classCode,
        date
      }
    };

    const existing = await dynamo.send(new GetCommand(checkParams));

    if (existing.Item) {
      return res.status(400).json({
        message: "Attendance already submitted for today"
      });
    }

    const params = {
      TableName: "attendance",
      Item: {
        classCode,
        date,
        attendance,
        createdAt: new Date().toISOString(),
        markedBy: req.teacherId.teacherId
      }
    };

    await client.send(new PutCommand(params));

    res.json({
      message: "Attendance saved successfully"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error saving attendance" });
  }
});

attendance.get("/teachers/attendance-status/:classCode",
  tAuth,
  async (req, res) => {
    try {

      const { classCode } = req.params;

      const today = new Date().toISOString().split("T")[0];

      const params = {
        TableName: "attendance",
        Key: {
          classCode,
          date: today
        }
      };

      const data = await dynamo.send(new GetCommand(params));

      if (!data.Item) {
        return res.json({
          submitted: false,
          attendance: []
        });
      }

      return res.json({
        submitted: true,
        attendance: data.Item.attendance
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching attendance status" });
    }
  }
);

attendance.get("/teachers/student-attendance/:classCode/:studentId",
  
  async (req, res) => {

    try {

      const { classCode, studentId } = req.params;

      const params = {
        TableName: "attendance",
        KeyConditionExpression: "classCode = :c",
        ExpressionAttributeValues: {
          ":c": classCode
        }
      };

      const data = await dynamo.send(new QueryCommand(params));

      const records = data.Items || [];

      const studentAttendance = [];

      for (const record of records) {

        const student = record.attendance.find(
          s => s.studentId === studentId
        );

        if (student) {
          studentAttendance.push({
            date: record.date,
            status: student.status
          });
        }

      }

      res.json({
        classCode,
        studentId,
        attendance: studentAttendance
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        message: "Error fetching student attendance"
      });

    }

  }
);

attendance.patch("/teachers/update-attendance", tAuth, async (req, res) => {
  try {
    const { classCode, date, studentId, status } = req.body;

    if (!classCode || !date || !studentId || status === undefined) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const existing = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date }
    }));

    if (!existing.Item) {
      return res.status(404).json({ message: "Attendance not found" });
    }

    let attendanceList = existing.Item.attendance;

    attendanceList = attendanceList.map((item) => {
      if (item.studentId === studentId) {
        return { ...item, status };
      }
      return item;
    });

    // 3️⃣ Save updated list
    await dynamo.send(new PutCommand({
      TableName: "attendance",
      Item: {
        ...existing.Item,
        attendance: attendanceList,
        updatedAt: new Date().toISOString(),
      }
    }));

    res.json({ message: "Attendance updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating attendance" });
  }
});


attendance.get("/teachers/class-attendance/:classCode", tAuth, async (req, res) => {
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


// SMART ATTENDANCE API 

// POST /teachers/enable-attendance
attendance.post("/teachers/enable-attendance", tAuth, async (req, res) => {
  try {
    const { classCode, className, wifiSSID, date } = req.body;
    const teacherId = req.teacherId.teacherId;

  
    console.log("👤 Teacher ID:", teacherId);

    if (!classCode || !className || !wifiSSID || !date) {
      return res.status(400).json({
        message: "Missing required fields",
        received: { classCode, className, wifiSSID, date }
      });
    }

    const sessionId = `${teacherId}_${classCode}`;
   

    // 1. Create session
    console.log("💾 Creating session...");
    await dynamo.send(new PutCommand({
      TableName: "attendanceSessions",
      Item: {
        sessionId,
        teacherId,
        classCode,
        className,
        wifiSSID: wifiSSID.trim(),
        enabled: true,
        date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));
   

    // 2. Get class students
    console.log("📚 Fetching class:", classCode);
    const classDoc = await dynamo.send(new GetCommand({
      TableName: "classes",
      Key: { classCode },
    }));

  

    if (!classDoc.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    const students = classDoc.Item.students ?? [];
    

    // 3. Check existing attendance
    const existingAttendance = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date },
    }));

    if (!existingAttendance.Item) {
      

      const attendanceList = students.map((studentId) => ({
        studentId,
        status: 0,
      }));

      await dynamo.send(new PutCommand({
        TableName: "attendance",
        Item: {
          classCode,
          date,
          attendance: attendanceList,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }));
      console.log("✅ Attendance record created");
    } else {
      console.log("ℹ️Attendance record already exists");
    }

    res.status(200).json({
      message: "Attendance session started successfully",
      sessionId,
      wifiSSID: wifiSSID.trim(),
      enabled: true,
      date,
    });

  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,   // ← shows real error in response
      errorName: err.name,
    });
  }
});

attendance.post("/teachers/disable-attendance", tAuth, async (req, res) => {
  try {
    const { classCode, date } = req.body;
    const teacherId = req.teacherId.teacherId;

    if (!classCode || !date) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const sessionId = `${teacherId}_${classCode}`;
   

    // 1. Check session exists first
    const sessionDoc = await dynamo.send(new GetCommand({
      TableName: "attendanceSessions",
      Key: { sessionId },
    }));


    if (!sessionDoc.Item) {
      return res.status(404).json({ message: "Session not found" });
    }

    await dynamo.send(new UpdateCommand({
      TableName: "attendanceSessions",
      Key: { sessionId },
      UpdateExpression: "SET enabled = :false, updatedAt = :now",
      ExpressionAttributeValues: {
        ":false": false,
        ":now": new Date().toISOString(),
      },
    }));
  

    // 3. Get attendance for today
    console.log("📊 Fetching attendance...");
    const attendanceDoc = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date },
    }));
    console.log("📊 Attendance:", JSON.stringify(attendanceDoc.Item));

    // 4. Get all students of the class
    console.log("📚 Fetching class students...");
    const classDoc = await dynamo.send(new GetCommand({
      TableName: "classes",
      Key: { classCode },
    }));
 

    if (!classDoc.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    const allStudents = classDoc.Item?.students ?? [];
    let attendanceList = attendanceDoc.Item?.attendance ?? [];

    // 5. Mark remaining students as absent
    const presentIds = attendanceList
      .filter((a) => a.status === 1)
      .map((a) => a.studentId);

    const absentIds = allStudents.filter((id) => !presentIds.includes(id));

    absentIds.forEach((studentId) => {
      const existingIndex = attendanceList.findIndex(
        (a) => a.studentId === studentId
      );
      if (existingIndex >= 0) {
        attendanceList[existingIndex].status = 0;
      } else {
        attendanceList.push({ studentId, status: 0 });
      }
    });

    // 6. Save final attendance
    await dynamo.send(new PutCommand({
      TableName: "attendance",
      Item: {
        classCode,
        date,
        attendance: attendanceList,
        createdAt: attendanceDoc.Item?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }));

    res.status(200).json({
      message: "Attendance session ended",
      totalStudents: allStudents.length,
      presentCount: presentIds.length,
      absentCount: absentIds.length,
    });

  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,    // ← shows real error
      errorName: err.name,
    });
  }
});


// GET /students/attendance-session/:classCode
// Returns session info including SSID, enabled flag, alreadyMarked
attendance.get("/students/attendance-session/:classCode", studAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const { date } = req.query;
    const studentId = req.student

    if (!date) {
      return res.status(400).json({ message: "date query param required" });
    }

    // 1. Get class to find teacherId
    const classDoc = await dynamo.send(new GetCommand({
      TableName: "classes",
      Key: { classCode }
    }));

    if (!classDoc.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    console.log("📚 Class found:", classDoc);
    const teacherId = classDoc.Item.createdBy;
    console.log("👤 Teacher ID:", teacherId);

    // 2. Get attendance session
    const session = await dynamo.send(new GetCommand({
      TableName: "attendanceSessions",
      Key: { sessionId: `${teacherId}_${classCode}` }
    }));

    if (!session.Item) {
      return res.status(404).json({ message: "No attendance session found" });
    }

    // 3. Check if student already marked today
    const attendanceDoc = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date }
    }));

    const attendanceList = attendanceDoc.Item?.attendance ?? [];
    const studentRecord = attendanceList.find(a => a.studentId === studentId);
    const alreadyMarked = studentRecord?.status === 1;

    res.json({
      wifiSSID: session.Item.wifiSSID,      // ← SSID for student to connect
      enabled: session.Item.enabled,         // ← must be true
      alreadyMarked,                         // ← already marked today
      date,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});


// POST /students/mark-smart-attendance
attendance.post("/students/mark-smart-attendance", studAuth, async (req, res) => {
  try {
    const { classCode, date, status } = req.body;
    const studentId = req.student.studentId;  // ← fix: get studentId from object

    if (!classCode || !date || status === undefined) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // 1. Get class
    const classDoc = await dynamo.send(new GetCommand({
      TableName: "classes",
      Key: { classCode },
    }));

    if (!classDoc.Item) {
      return res.status(404).json({ message: "Class not found" });
    }

    // ← check both createdBy and teacherId
    const teacherId = classDoc.Item?.createdBy || classDoc.Item?.teacherId;

    if (!teacherId) {
      return res.status(404).json({ message: "Teacher not found in class" });
    }

    // 2. Check session is enabled
    const sessionId = `${teacherId}_${classCode}`;

    const session = await dynamo.send(new GetCommand({
      TableName: "attendanceSessions",
      Key: { sessionId },
    }));

    if (!session.Item) {
      return res.status(403).json({ message: "No attendance session found" });
    }

    if (!session.Item.enabled) {
      return res.status(403).json({ message: "Attendance session is not active" });
    }

    // 3. Get existing attendance record
    const existing = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date },
    }));

    let attendanceList = existing.Item?.attendance ?? [];

    // 4. Check already marked — prevent duplicate
    const alreadyMarked = attendanceList.some(
      (a) => a.studentId === studentId && a.status === 1
    );

    if (alreadyMarked) {
      return res.status(409).json({ message: "Attendance already marked" });
    }

    // 5. Update existing entry OR add new entry
    const existingIndex = attendanceList.findIndex(
      (a) => a.studentId === studentId
    );

    if (existingIndex >= 0) {
      attendanceList[existingIndex] = {
        ...attendanceList[existingIndex],
        status: 1,
      };
    } else {
      attendanceList.push({ studentId, status: 1 });
    }

    // 6. Save to DynamoDB — matching your DB structure
    await dynamo.send(new PutCommand({
      TableName: "attendance",
      Item: {
        classCode,
        date,
        attendance: attendanceList,
        createdAt: existing.Item?.createdAt ?? new Date().toISOString(),
        markedBy: teacherId,
        updatedAt: new Date().toISOString(),
      },
    }));

    res.status(200).json({
      message: "Attendance marked successfully",
      studentId,
      classCode,
      date,
      status: 1,
    });

  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
      errorName: err.name,
    });
  }
});


// GET /teachers/session-status/:classCode
// Check if session already exists for today
attendance.get("/teachers/session-status/:classCode", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const teacherId = req.teacherId.teacherId;

    const sessionId = `${teacherId}_${classCode}`;

    const session = await dynamo.send(new GetCommand({
      TableName: "attendanceSessions",
      Key: { sessionId }
    }));

    if (!session.Item) {
      return res.json({
        exists: false,
        enabled: false,
        wifiSSID: null,
      });
    }

    res.json({
      exists: true,
      enabled: session.Item.enabled,
      wifiSSID: session.Item.wifiSSID,
      date: session.Item.date,
      sessionId,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// show live stdent attendance for a session
// GET /teachers/present-students/:classCode
attendance.get("/teachers/present-students/:classCode", tAuth, async (req, res) => {
  try {
    const { classCode } = req.params;
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: "date query param required" });
    }

    // 1. Get attendance for today
    const attendanceDoc = await dynamo.send(new GetCommand({
      TableName: "attendance",
      Key: { classCode, date },
    }));

    if (!attendanceDoc.Item) {
      return res.status(200).json({ students: [] });
    }

    const attendanceList = attendanceDoc.Item.attendance ?? [];

    // 2. Filter only present (status === 1)
    const presentIds = attendanceList
      .filter((a) => a.status === 1)
      .map((a) => a.studentId);

    if (presentIds.length === 0) {
      return res.status(200).json({ students: []});
    }

    // 3. Fetch each present student's details
    const studentDetails = await Promise.all(
      presentIds.map(async (studentId) => {
        const result = await dynamo.send(new GetCommand({
          TableName: "students",
          Key: { studentId },
        }));
        return result.Item ?? null;
      })
    );

    // 4. Return clean response
    const students = studentDetails
      .filter((s) => s !== null)
      .map((s) => ({
        studentId:    s.studentId,
        name:         `${s.firstName || ""} ${s.lastName || ""}`.trim(),
        firstName:    s.firstName || "",
        lastName:     s.lastName  || "",
        rollNo:       s.rollNo    || "N/A",
        profilePicUrl: s.profilePicUrl || "",
      }));

    res.status(200).json({ students });

  } catch (err) {
    console.error("present-students error:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
});



module.exports = attendance;