const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const studAuth = require("../../middlewares/student_auth");
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const notes = express.Router();

// ═══════════════════════════════════════════════════════════
//  CLIENTS
// ═══════════════════════════════════════════════════════════

const s3 = new S3Client({ region: process.env.AWS_REGION });

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);

// ═══════════════════════════════════════════════════════════
//  MULTER — memory storage (no disk write)
// ═══════════════════════════════════════════════════════════

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, PPT, PPTX files are allowed'));
    }
  },
});

// ═══════════════════════════════════════════════════════════
//  POST /students/notes/upload
// ═══════════════════════════════════════════════════════════

notes.post(
  '/students/notes/upload',
  studAuth,           // your existing auth middleware
  upload.single('file'), // field name must be 'file' from Flutter
  async (req, res) => {
    try {
      const studentId = req.student.studentId;

      // ── 1. Validate file ──
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
      }

      // ── 2. Validate required body fields ──
      const { type, semester, year, course, department, teacherName } = req.body;

      if (!type || !semester || !year || !course || !department) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Teacher name required only for Notes
      if (type === 'Notes' && !teacherName) {
        return res.status(400).json({ message: 'Teacher name is required for Notes' });
      }

      // ── 3. Fetch student from DynamoDB to get institutionId ──
      const studentResult = await dynamo.send(new GetCommand({
        TableName: 'students',
        Key: { studentId },
      }));

      if (!studentResult.Item) {
        return res.status(404).json({ message: 'Student not found' });
      }

      const institutionId = studentResult.Item.institutionId;

     // ── 4. Upload file to S3 ──
const fileExt = req.file.originalname.split('.').pop();
const fileKey = `study-materials/${institutionId}/${studentId}-${Date.now()}.${fileExt}`;
//               ^^^^^^^^^^^^^^^^ new folder/section in the same bucket

await s3.send(new PutObjectCommand({
  Bucket:      'presentme-document',
  Key:         fileKey,
  Body:        req.file.buffer,
  ContentType: req.file.mimetype,
}));

const fileUrl = `https://presentme-document.s3.ap-south-1.amazonaws.com/${fileKey}`;

      // ── 5. Save record to DynamoDB ──
      const noteId    = `note-${uuidv4()}`;
      const createdAt = new Date().toISOString();

      const noteItem = {
        noteId,                                               // PK
        institutionId,                                        // from DB lookup
        uploadedBy:  studentId,                               // from JWT
        status:      'pending',                               // default
        type,                                                 // 'Notes' | 'PYQ'
        semester,
        year,
        course,
        department,
        teacherName: type === 'Notes' ? teacherName : null,
        fileName:    req.file.originalname,
        fileUrl,
        fileKey,                                              // useful for deletion later
        downloads:   0,
        createdAt,
      };

      await dynamo.send(new PutCommand({
        TableName: 'notes',                                   // 🔁 replace with your table name
        Item: noteItem,
      }));

      // ── 6. Respond ──
      res.status(201).json({
        message: 'Uploaded successfully. Pending approval.',
        noteId,
        fileUrl,
        status: 'pending',
      });

    } catch (error) {
      console.error('Notes upload error:', error);

      if (error.message?.includes('Only PDF')) {
        return res.status(400).json({ message: error.message });
      }

      res.status(500).json({ message: 'Failed to upload note' });
    }
  }
);

module.exports = notes;