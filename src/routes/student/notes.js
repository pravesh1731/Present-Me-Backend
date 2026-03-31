const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const studAuth = require("../../middlewares/student_auth");
const tAuth = require("../../middlewares/teacherAuth");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { findById } = require("../../services/awsService");
const anyAuth = require("../../middlewares/anyAuth");

const notesRouter = express.Router();

// ═══════════════════════════════════════════════════════════
//  CLIENTS
// ═══════════════════════════════════════════════════════════

const s3 = new S3Client({ region: process.env.AWS_REGION });

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION }),
);

// ═══════════════════════════════════════════════════════════
//  MULTER — memory storage (no disk write)
// ═══════════════════════════════════════════════════════════

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOC, DOCX, PPT, PPTX files are allowed"));
    }
  },
});

// ═══════════════════════════════════════════════════════════
//  POST /students/notes/upload
// ═══════════════════════════════════════════════════════════




notesRouter.post(
  "/students/notes/upload",
  anyAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const uploaderId = req.student?.studentId ?? req.teacherId?.teacherId;

      // ── 1. Validate file ──
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // ── 2. Validate required body fields ──
      const { type, semester, year, course, department, teacherName } =
        req.body;

      if (!type || !semester || !year || !course || !department) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      if (type === "Notes" && !teacherName) {
        return res
          .status(400)
          .json({ message: "Teacher name is required for Notes" });
      }

      // ── 3. Fetch student to get institutionId ──
      const studentResult = await dynamo.send(new GetCommand({
    TableName: req.student ? 'students' : 'teachers', // ✅ correct table
    Key: req.student
      ? { studentId: uploaderId }
      : { teacherId: uploaderId },
  }));

      if (!studentResult.Item) {
        return res.status(404).json({ message: "Student not found" });
      }

      const institutionId = studentResult.Item.institutionId;

      // ── 3.5 ✅ Duplicate check ──
      const duplicateCheck = await dynamo.send(
        new ScanCommand({
          TableName: "notes",
          FilterExpression: `
          institutionId = :iid AND
          #type = :type AND
          semester = :semester AND
          #year = :year AND
          course = :course AND
          department = :department 
        `,
          ExpressionAttributeNames: {
            "#type": "type",
            "#year": "year",
          },
          ExpressionAttributeValues: {
            ":iid": institutionId,
            ":type": type,
            ":semester": semester,
            ":year": year,
            ":course": course,
            ":department": department,
          },
          Limit: 1,
        }),
      );

      // ✅ If a match found — return 409 warning
      if (duplicateCheck.Items && duplicateCheck.Items.length > 0) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          message:
            "This file already exists. A note with the same file name, type, semester, year, course and department has already been uploaded.",
        });
      }

      // ── 4. Upload file to S3 ──
      const fileExt = req.file.originalname.split(".").pop();
      const fileKey = `study-materials/${institutionId}/${uploaderId}-${Date.now()}.${fileExt}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: "presentme-document",
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }),
      );

      const fileUrl = `https://presentme-document.s3.ap-south-1.amazonaws.com/${fileKey}`;

      // ── 5. Save to DynamoDB ──
      const noteId = `note-${uuidv4()}`;
      const createdAt = new Date().toISOString();

      const noteItem = {
        noteId,
        institutionId,
        uploadedBy: uploaderId,
        status: "pending",
        type,
        semester,
        year,
        course,
        department,
        teacherName: type === "Notes" ? teacherName : null,
        fileName: req.file.originalname,
        fileUrl,
        fileKey,
        downloads: 0,
        createdAt,
      };

      await dynamo.send(
        new PutCommand({
          TableName: "notes",
          Item: noteItem,
        }),
      );

      // ── 6. Respond ──
      return res.status(201).json({
        message: "Uploaded successfully. Pending approval.",
        noteId,
        fileUrl,
        status: "pending",
      });
    } catch (error) {
      console.error("Notes upload error:", error);

      if (error.message?.includes("Only PDF")) {
        return res.status(400).json({ message: error.message });
      }

      return res.status(500).json({ message: "Failed to upload note" });
    }
  },
);

notesRouter.get("/students/notes", anyAuth, async (req, res) => {
  try {
     const uploaderId = req.student?.studentId ?? req.teacherId?.teacherId;

    const { course, department, semester, type } = req.query;

    if (!course || !department || !semester || !type) {
      return res.status(400).json({
        message: "course, department, semester and type are required",
      });
    }

    // ── Get student ──
    const studentResult = await dynamo.send(new GetCommand({
    TableName: req.student ? 'students' : 'teachers',
    Key: req.student
      ? { studentId: uploaderId }
      : { teacherId: uploaderId },
  }));

    if (!studentResult.Item) {
      return res.status(404).json({ message: "Student not found" });
    }

    const institutionId = studentResult.Item.institutionId;

    // ── Fetch notes ──
    const result = await dynamo.send(
      new ScanCommand({
        TableName: "notes",
        FilterExpression: `
        institutionId = :iid AND
        course = :course AND
        department = :department AND
        semester = :semester AND
        #type = :type AND
        #status = :status
      `,
        ExpressionAttributeNames: {
          "#type": "type",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":iid": institutionId,
          ":course": course,
          ":department": department,
          ":semester": semester,
          ":type": type, // ✅ NEW FILTER
          ":status": "approved",
        },
      }),
    );

    return res.status(200).json({
      success: true,
      count: result.Items.length,
      data: result.Items,
    });
  } catch (error) {
    console.error("Fetch notes error:", error);
    return res.status(500).json({ message: "Failed to fetch notes" });
  }
});

notesRouter.get("/students/notes/my-uploads", anyAuth, async (req, res) => {
  try {
    const uploaderId = req.student?.studentId ?? req.teacherId?.teacherId;

    const result = await dynamo.send(new QueryCommand({
    TableName: 'notes',
    IndexName: 'uploadedBy-index',
    KeyConditionExpression: 'uploadedBy = :sid',
    ExpressionAttributeValues: {
      ':sid': uploaderId, // ✅
    },
    ScanIndexForward: false,
  }));

  res.json({
    message: 'Fetched your uploads',
    total:   result.Items?.length ?? 0,
    data:    result.Items || [],
  });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch your uploads" });
  }
});

notesRouter.patch(
  "/students/notes/:noteId/download",
  anyAuth,
  async (req, res) => {
    try {
      const { noteId } = req.params;

      await dynamo.send(
        new UpdateCommand({
          TableName: "notes",
          Key: { noteId },
          UpdateExpression:
            "SET downloads = if_not_exists(downloads, :zero) + :inc",
          ExpressionAttributeValues: {
            ":inc": 1,
            ":zero": 0,
          },
        }),
      );

      res.json({ message: "Download count updated" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update download count" });
    }
  },
);

module.exports = notesRouter;
