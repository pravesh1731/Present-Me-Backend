const express = require("express");
const SAuth = require("../../middlewares/s_admin_auth");
const { docClient, dbClient } = require("../../dynamoDb");
const pyqNotesRouter = express.Router();
const { v4: uuidv4 } = require("uuid");
const {
  GetCommand,
  TransactWriteCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const multer = require("multer");
// GET ALL NOTES / PYQ FOR SUPER ADMIN
pyqNotesRouter.get("/sadmin/pyq-notes", SAuth, async (req, res) => {
  try {
    const {
      type = "all",
      status = "all",
      institutionId,
      year,
      department,
      course,
      pageSize = "50",
      cursor,
    } = req.query;

    // --------------------------------
    // PAGE SIZE
    // --------------------------------
    let limit = parseInt(pageSize);

    if (isNaN(limit) || limit <= 0) {
      limit = 50;
    }

    // Maximum 50 records per request
    if (limit > 50) {
      limit = 50;
    }

    // --------------------------------
    // DYNAMODB PARAMS
    // --------------------------------
    const params = {
      TableName: "notes",
      Limit: limit,
    };

    // --------------------------------
    // FILTER CONDITIONS
    // --------------------------------
    const filters = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    // TYPE
    if (type !== "all") {
      filters.push("#type = :type");

      expressionAttributeNames["#type"] = "type";
      expressionAttributeValues[":type"] = type;
    }

    // STATUS
    if (status !== "all") {
      filters.push("#status = :status");

      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":status"] = status;
    }

    // INSTITUTION
    if (institutionId) {
      filters.push("#institutionId = :institutionId");

      expressionAttributeNames["#institutionId"] = "institutionId";
      expressionAttributeValues[":institutionId"] = institutionId;
    }

    // YEAR
    if (year) {
      filters.push("#year = :year");

      expressionAttributeNames["#year"] = "year";
      expressionAttributeValues[":year"] = year;
    }

    if (course) {
      filters.push("#course = :course");
      expressionAttributeNames["#course"] = "course";
      expressionAttributeValues[":course"] = course;
    }

    // DEPARTMENT
    if (department) {
      filters.push("#department = :department");
      expressionAttributeNames["#department"] = "department";
      expressionAttributeValues[":department"] = department;
    }

    // --------------------------------
    // APPLY FILTER
    // --------------------------------
    if (filters.length > 0) {
      params.FilterExpression = filters.join(" AND ");

      params.ExpressionAttributeNames = expressionAttributeNames;
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    // --------------------------------
    // CURSOR
    // --------------------------------
    if (cursor) {
      try {
        params.ExclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64").toString("utf8"),
        );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "Invalid cursor",
        });
      }
    }

    // --------------------------------
    // DATABASE REQUEST
    // --------------------------------
    const result = await docClient.send(new ScanCommand(params));
    const notes = result.Items || [];

    // --------------------------------
      // GET UPLOADER INFORMATION
      // --------------------------------

      const data = await Promise.all(
        notes.map(async (note) => {
          const uploadedBy = note.uploadedBy;

          let uploaderName = "Super Admin";
          let uploaderRole = "super_admin";

          // --------------------------------
          // 1. SEARCH STUDENT
          // --------------------------------

          const studentResult = await docClient.send(
            new GetCommand({
              TableName: "students",
              Key: {
                studentId: uploadedBy,
              },
            })
          );

          if (studentResult.Item) {
            const student = studentResult.Item;

            uploaderName =
              `${student.firstName || ""} ${
                student.lastName || ""
              }`.trim() ||
              student.name ||
              "Unknown Student";

            uploaderRole = "student";

            return {
              ...note,
              uploaderName,
              uploaderRole,
            };
          }

          // --------------------------------
          // 2. SEARCH TEACHER
          // --------------------------------

          const teacherResult = await docClient.send(
            new GetCommand({
              TableName: "teachers",
              Key: {
                teacherId: uploadedBy,
              },
            })
          );

          if (teacherResult.Item) {
            const teacher = teacherResult.Item;

            uploaderName =
              `${teacher.firstName || ""} ${
                teacher.lastName || ""
              }`.trim() ||
              teacher.name ||
              "Unknown Teacher";

            uploaderRole = "teacher";

            return {
              ...note,
              uploaderName,
              uploaderRole,
            };
          }

          // --------------------------------
          // 3. NOT STUDENT / TEACHER
          //    => ADMIN
          // --------------------------------

          return {
            ...note,
            uploaderName: "Super Admin",
            uploaderRole: "super_admin",
          };
        })
      );

    // --------------------------------
    // CREATE NEXT CURSOR
    // --------------------------------
    let nextCursor = null;

    if (result.LastEvaluatedKey) {
      nextCursor = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString("base64");
    }

    // --------------------------------
    // RESPONSE
    // --------------------------------
    return res.status(200).json({
      success: true,

      count: data.length || 0,

      data,

      nextCursor,
    });
  } catch (error) {
    console.error("Super Admin Notes API Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notes",
      error: error.message,
    });
  }
});

// Uplaod Notes / PYQ for Super Admin

// =================================================
// CLIENTS
// =================================================

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION,
  }),
);

// =================================================
// MULTER
// =================================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 20 * 1024 * 1024,
  },

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

// =================================================
// SUPER ADMIN UPLOAD
// =================================================

pyqNotesRouter.post( "/sadmin/pyq-notes/upload",
  SAuth,

  // =================================================
  // MULTER ERROR HANDLING
  // =================================================
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            code: "FILE_TOO_LARGE",
            message: "File size must not exceed 20 MB.",
          });
        }

        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            success: false,
            code: "INVALID_FILE_FIELD",
            message: 'Please upload the file using the field name "file".',
          });
        }

        return res.status(400).json({
          success: false,
          code: "FILE_UPLOAD_ERROR",
          message: err.message,
        });
      }

      if (err) {
        return res.status(400).json({
          success: false,
          code: "FILE_UPLOAD_ERROR",
          message: err.message || "Unable to upload file.",
        });
      }

      next();
    });
  },

  async (req, res) => {
    let reservedDuplicateKey = null;
    let fileKey = null;

    let uniqueReservationCreated = false;
    let s3Uploaded = false;
    let noteCreated = false;

    try {
      // =================================================
      // 1. SUPER ADMIN
      // =================================================

      if (!req.admin) {
        return res.status(401).json({
          success: false,
          message: "Super Admin not authenticated",
        });
      }

      const uploaderId = req.admin.adminId;

      if (!uploaderId) {
        return res.status(401).json({
          success: false,
          message: "Super Admin ID not found",
        });
      }

      // =================================================
      // 2. GET ADMIN FROM ADMIN TABLE
      // =================================================

      const adminResult = await dynamo.send(
        new GetCommand({
          TableName: "admin",
          Key: {
            adminId: uploaderId,
          },
        })
      );

      const admin = adminResult.Item;

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: "Admin not found",
        });
      }

      // =================================================
      // 3. FILE VALIDATION
      // =================================================

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      // =================================================
      // 4. BODY
      // =================================================

      const {
        type,
        semester,
        year,
        course,
        department,
        institutionId,
        teacherName,
      } = req.body;

      if (
        !type ||
        !semester ||
        !year ||
        !course ||
        !department ||
        !institutionId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "type, semester, year, course, department and institutionId are required",
        });
      }

      // =================================================
      // 5. TYPE VALIDATION
      // =================================================

      if (type !== "Notes" && type !== "PYQ") {
        return res.status(400).json({
          success: false,
          message: "Type must be either Notes or PYQ",
        });
      }

      // =================================================
      // 6. TEACHER NAME
      // =================================================

      if (type === "Notes" && !teacherName) {
        return res.status(400).json({
          success: false,
          message: "Teacher name is required for Notes",
        });
      }

      // =================================================
      // 7. NORMALIZE
      // =================================================

      const normalize = (value) =>
        String(value)
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();

      // =================================================
      // 8. GENERATE DUPLICATE KEY
      //
      // SAME LOGIC AS STUDENT/TEACHER API
      // =================================================

      const duplicateKeyParts = [
        institutionId,
        normalize(type),
        normalize(semester),
        normalize(year),
        normalize(course),
        normalize(department),
      ];

      // Teacher name is part of uniqueness for Notes
      if (type === "Notes") {
        duplicateKeyParts.push(normalize(teacherName));
      }

      const duplicateKey = duplicateKeyParts.join("#");

      reservedDuplicateKey = duplicateKey;

      // =================================================
      // 9. NOTES LOOKUP KEY
      //
      // SAME AS STUDENT/TEACHER API
      // =================================================

      const notesLookupKey = [
        institutionId,
        course,
        department,
        semester,
        type,
      ].join("#");

      // =================================================
      // 10. NOTE ID + CREATED TIME
      // =================================================

      const noteId = `note-${uuidv4()}`;

      const createdAt = new Date().toISOString();

      // =================================================
      // 11. RESERVE UNIQUE COMBINATION
      //
      // IMPORTANT:
      // No ScanCommand.
      // DynamoDB conditional Put prevents duplicates.
      // =================================================

      try {
        await dynamo.send(
          new PutCommand({
            TableName: "noteUnique",

            Item: {
              duplicateKey,
              noteId,

              // Admin uploads are immediately approved
              status: "approved",

              createdAt,
            },

            ConditionExpression:
              "attribute_not_exists(duplicateKey)",
          })
        );

        uniqueReservationCreated = true;
      } catch (error) {
        // =================================================
        // DUPLICATE
        // =================================================

        if (error.name === "ConditionalCheckFailedException") {
          return res.status(409).json({
            success: false,
            isDuplicate: true,
            message:
              "A Notes/PYQ already exists for this institution, course, department, semester and year.",
          });
        }

        throw error;
      }

      // =================================================
      // 12. FILE EXTENSION
      // =================================================

      const fileExt =
        req.file.originalname.split(".").pop()?.toLowerCase() || "pdf";

      // =================================================
      // 13. S3 FILE KEY
      // =================================================

      fileKey =
        `study-materials/${institutionId}/` +
        `${noteId}.${fileExt}`;

      // =================================================
      // 14. UPLOAD TO S3
      // =================================================

      await s3.send(
        new PutObjectCommand({
          Bucket: "presentme-document",
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );

      s3Uploaded = true;

      // =================================================
      // 15. FILE URL
      // =================================================

      const fileUrl =
        `https://presentme-document.s3.ap-south-1.amazonaws.com/${fileKey}`;

      // =================================================
      // 16. CREATE NOTE ITEM
      // =================================================

      const noteItem = {
        noteId,

        // Duplicate system
        duplicateKey,
        notesLookupKey,

        // Institution
        institutionId,

        // Super Admin uploader
        uploadedBy: uploaderId,

        // Automatically approved
        status: "approved",

        // Note information
        type,
        semester,
        year,
        course,
        department,

        // Teacher only for Notes
        teacherName:
          type === "Notes"
            ? teacherName.trim()
            : null,

        // File information
        fileName: req.file.originalname,
        fileUrl,
        fileKey,

        // Downloads
        downloads: 0,

        // Time
        createdAt,
      };

      // =================================================
      // 17. SAVE TO NOTES TABLE
      // =================================================

      await dynamo.send(
        new PutCommand({
          TableName: "notes",
          Item: noteItem,
        })
      );

      noteCreated = true;

      // =================================================
      // 18. UPDATE UNIQUE RESERVATION
      // =================================================

      await dynamo.send(
        new UpdateCommand({
          TableName: "noteUnique",

          Key: {
            duplicateKey,
          },

          UpdateExpression:
            "SET #status = :status",

          ExpressionAttributeNames: {
            "#status": "status",
          },

          ExpressionAttributeValues: {
            ":status": "approved",
          },
        })
      );

      // =================================================
      // 19. SUCCESS
      // =================================================

      return res.status(201).json({
        success: true,

        message:
          "Uploaded successfully. The content has been approved automatically.",

        noteId,

        uploadedBy: uploaderId,

        institutionId,

        type,

        status: "approved",

        createdAt,

        fileUrl,

        data: noteItem,
      });
    } catch (error) {
      console.error(
        "Super Admin Notes/PYQ upload error:",
        error
      );

      // =================================================
      // CLEANUP S3
      // =================================================

      if (
        s3Uploaded &&
        fileKey &&
        !noteCreated
      ) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: "presentme-document",
              Key: fileKey,
            })
          );

          console.log(
            "Orphaned S3 file deleted:",
            fileKey
          );
        } catch (cleanupError) {
          console.error(
            "S3 cleanup failed:",
            cleanupError
          );
        }
      }

      // =================================================
      // CLEANUP UNIQUE RESERVATION
      // =================================================

      if (
        uniqueReservationCreated &&
        reservedDuplicateKey &&
        !noteCreated
      ) {
        try {
          await dynamo.send(
            new DeleteCommand({
              TableName: "noteUnique",

              Key: {
                duplicateKey:
                  reservedDuplicateKey,
              },
            })
          );

          console.log(
            "Unique reservation deleted:",
            reservedDuplicateKey
          );
        } catch (cleanupError) {
          console.error(
            "Unique reservation cleanup failed:",
            cleanupError
          );
        }
      }

      // =================================================
      // PDF VALIDATION ERROR
      // =================================================

      if (
        error.message?.includes("Only PDF")
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      // =================================================
      // GENERIC ERROR
      // =================================================

      return res.status(500).json({
        success: false,
        message:
          "Failed to upload Notes/PYQ",
        error: error.message,
      });
    }
  }
);

pyqNotesRouter.post("/sadmin/pyq-notes/:noteId/verify",
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const { amount, description } = req.body;

      // 1. Validate amount
      if (
        amount === undefined ||
        typeof amount !== "number" ||
        amount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid amount is required",
        });
      }

      // 2. Validate description
      if (
        !description ||
        typeof description !== "string" ||
        !description.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Description is required",
        });
      }

      // 3. Get the note
      const noteResult = await dbClient.send(
        new GetCommand({
          TableName: "notes",
          Key: {
            noteId,
          },
        }),
      );

      const note = noteResult.Item;

      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found",
        });
      }

      // 4. Check current status
      if (note.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Note is already ${note.status}`,
        });
      }

      console.log(
        "Note uploadedBy:",
        note.uploadedBy
      );

      // ─────────────────────────────────────
      // NEW:
      // duplicateKey should already exist on
      // the note from the upload API.
      // ─────────────────────────────────────

      if (!note.duplicateKey) {
        return res.status(500).json({
          success: false,
          message:
            "Note duplicate key is missing",
        });
      }

      // 5. Get student's wallet
      const walletResult = await dbClient.send(
        new QueryCommand({
          TableName: "wallet",
          IndexName: "userId-index",
          KeyConditionExpression:
            "userId = :userId",
          ExpressionAttributeValues: {
            ":userId": note.uploadedBy,
          },
          Limit: 1,
        }),
      );

      const wallet = walletResult.Items?.[0];

      if (!wallet) {
        return res.status(404).json({
          success: false,
          message:
            "Wallet not found for this user",
        });
      }

      // 6. Generate transaction ID
      const transactionId =
        "txn-" + uuidv4();

      const now =
        new Date().toISOString();

      // 7. Update note + wallet + transaction
      //    + noteUnique atomically
      await dbClient.send(
        new TransactWriteCommand({
          TransactItems: [

            // ─────────────────────────────
            // Approve note
            // ─────────────────────────────

            {
              Update: {
                TableName: "notes",
                Key: {
                  noteId,
                },

                UpdateExpression:
                  "SET #status = :approved, approvedAt = :approvedAt, rewardAmount = :amount",

                ConditionExpression:
                  "#status = :pending",

                ExpressionAttributeNames: {
                  "#status": "status",
                },

                ExpressionAttributeValues: {
                  ":approved": "approved",
                  ":pending": "pending",
                  ":amount": amount,
                  ":approvedAt": now,
                },
              },
            },

            // ─────────────────────────────
            // NEW:
            // Keep duplicate reservation and
            // change it to approved
            // ─────────────────────────────

            {
              Update: {
                TableName: "noteUnique",

                Key: {
                  duplicateKey:
                    note.duplicateKey,
                },

                UpdateExpression:
                  "SET #status = :approved",

                ConditionExpression:
                  "attribute_exists(duplicateKey)",

                ExpressionAttributeNames: {
                  "#status": "status",
                },

                ExpressionAttributeValues: {
                  ":approved": "approved",
                },
              },
            },

            // ─────────────────────────────
            // Add amount to wallet
            // ─────────────────────────────

            {
              Update: {
                TableName: "wallet",

                Key: {
                  walletId:
                    wallet.walletId,
                },

                UpdateExpression:
                  "SET balance = balance + :amount, updatedAt = :updatedAt",

                ExpressionAttributeValues: {
                  ":amount": amount,
                  ":updatedAt": now,
                },
              },
            },

            // ─────────────────────────────
            // Create wallet transaction
            // ─────────────────────────────

            {
              Put: {
                TableName:
                  "walletTransaction",

                Item: {
                  transactionId,
                  walletId:
                    wallet.walletId,
                  userId:
                    note.uploadedBy,
                  type: "CREDIT",
                  amount,
                  source:
                    "NOTE/PYQ_REWARD",
                  referenceId: noteId,
                  description:
                    description.trim(),
                  status: "COMPLETED",
                  createdAt: now,
                },

                ConditionExpression:
                  "attribute_not_exists(transactionId)",
              },
            },
          ],
        }),
      );

      return res.status(200).json({
        success: true,
        message:
          "Note approved and wallet credited successfully",

        data: {
          noteId,
          amount,
          description:
            description.trim(),
          transactionId,
          walletId:
            wallet.walletId,
        },
      });

    } catch (error) {
      console.error(
        "Verify note error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to approve note",
      });
    }
  }
);


pyqNotesRouter.post("/sadmin/pyq-notes/:noteId/reject",
  async (req, res) => {
    try {
      const { noteId } = req.params;
      const { description } = req.body;

      // ─────────────────────────────────────
      // 1. Validate rejection description
      // ─────────────────────────────────────

      if (
        !description ||
        typeof description !== "string" ||
        !description.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Rejection description is required",
        });
      }

      const rejectionDescription =
        description.trim();

      // ─────────────────────────────────────
      // 2. Get the note
      // ─────────────────────────────────────

      const noteResult = await dbClient.send(
        new GetCommand({
          TableName: "notes",
          Key: {
            noteId,
          },
        }),
      );

      const note = noteResult.Item;

      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found",
        });
      }

      // ─────────────────────────────────────
      // 3. Only pending notes can be rejected
      // ─────────────────────────────────────

      if (note.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Note is already ${note.status}`,
        });
      }

      // ─────────────────────────────────────
      // 4. duplicateKey is required
      // ─────────────────────────────────────

      if (!note.duplicateKey) {
        return res.status(500).json({
          success: false,
          message: "Note duplicate key is missing",
        });
      }

      const now =
        new Date().toISOString();

      // ─────────────────────────────────────
      // 5. Atomically:
      //
      // notes:
      // pending → rejected
      // + rejectionDescription
      // + rejectedAt
      //
      // noteUnique:
      // DELETE reservation
      //
      // Both succeed or both fail.
      // ─────────────────────────────────────

      await dbClient.send(
        new TransactWriteCommand({
          TransactItems: [
            // ─────────────────────────────
            // Update note
            // ─────────────────────────────

            {
              Update: {
                TableName: "notes",

                Key: {
                  noteId,
                },

                UpdateExpression:
                  "SET #status = :rejected, " +
                  "rejectedAt = :rejectedAt, " +
                  "description = :description",

                ConditionExpression:
                  "#status = :pending",

                ExpressionAttributeNames: {
                  "#status": "status",
                },

                ExpressionAttributeValues: {
                  ":pending": "pending",
                  ":rejected": "rejected",
                  ":rejectedAt": now,
                  ":description":description,
                },
              },
            },

            // ─────────────────────────────
            // Delete duplicate reservation
            //
            // This allows another upload
            // with the same combination.
            // ─────────────────────────────

            {
              Delete: {
                TableName: "noteUnique",

                Key: {
                  duplicateKey:
                    note.duplicateKey,
                },

                ConditionExpression:
                  "attribute_exists(duplicateKey)",
              },
            },
          ],
        }),
      );

      // ─────────────────────────────────────
      // 6. Success
      // ─────────────────────────────────────

      return res.status(200).json({
        success: true,
        message: "Note rejected successfully",

        data: {
          noteId,
          status: "rejected",
          rejectionDescription,
          rejectedAt: now,
        },
      });
    } catch (error) {
      console.error(
        "Reject note error:",
        error,
      );

      // ─────────────────────────────────────
      // Transaction failed
      // ─────────────────────────────────────

      if (
        error.name ===
        "TransactionCanceledException"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Note could not be rejected because its status was changed. Please refresh and try again.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to reject note",
      });
    }
  },
);





pyqNotesRouter.get("/sadmin/withdrawals",SAuth,async (req, res) => {
    try {
      const {
        status = "all",
        userRole = "all",
        institutionId,
        withdrawalId,
        userId,
        upiId,
        minAmount,
        maxAmount,
        fromDate,
        toDate,
        search,
        pageSize = "50",
        cursor,
      } = req.query;

      // ----------------------------------------
      // PAGINATION
      // ----------------------------------------

      let limit = parseInt(pageSize, 10);

      if (isNaN(limit) || limit <= 0) {
        limit = 50;
      }

      if (limit > 50) {
        limit = 50;
      }

      // ----------------------------------------
      // VALIDATE STATUS
      // ----------------------------------------

      const allowedStatuses = [
        "PENDING",
        "PROCESSING",
        "PAID",
        "REJECTED",
        "FAILED",
      ];

      if (
        status !== "all" &&
        !allowedStatuses.includes(status.toUpperCase())
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid withdrawal status",
        });
      }

      // ----------------------------------------
      // VALIDATE USER ROLE
      // ----------------------------------------

      const allowedRoles = ["student", "teacher"];

      if (
        userRole !== "all" &&
        !allowedRoles.includes(userRole.toLowerCase())
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid userRole. Use student or teacher",
        });
      }

      // ----------------------------------------
      // BUILD FILTER
      // ----------------------------------------

      const filters = [];

      const ExpressionAttributeNames = {};
      const ExpressionAttributeValues = {};

      // STATUS
      if (status !== "all") {
        filters.push("#status = :status");

        ExpressionAttributeNames["#status"] = "status";
        ExpressionAttributeValues[":status"] =
          status.toUpperCase();
      }

      // USER ROLE
      if (userRole !== "all") {
        filters.push("#userRole = :userRole");

        ExpressionAttributeNames["#userRole"] = "userRole";
        ExpressionAttributeValues[":userRole"] =
          userRole.toLowerCase();
      }

      // INSTITUTION
      if (institutionId) {
        filters.push("#institutionId = :institutionId");

        ExpressionAttributeNames["#institutionId"] =
          "institutionId";

        ExpressionAttributeValues[":institutionId"] =
          institutionId;
      }

      // WITHDRAWAL ID
      if (withdrawalId) {
        filters.push("#withdrawalId = :withdrawalId");

        ExpressionAttributeNames["#withdrawalId"] =
          "withdrawalId";

        ExpressionAttributeValues[":withdrawalId"] =
          withdrawalId;
      }

      // USER ID
      if (userId) {
        filters.push("#userId = :userId");

        ExpressionAttributeNames["#userId"] = "userId";

        ExpressionAttributeValues[":userId"] = userId;
      }

      // UPI ID
      if (upiId) {
        filters.push("#upiId = :upiId");

        ExpressionAttributeNames["#upiId"] = "upiId";

        ExpressionAttributeValues[":upiId"] =
          upiId.trim().toLowerCase();
      }

      // MIN AMOUNT
      if (minAmount !== undefined) {
        const min = Number(minAmount);

        if (!Number.isFinite(min) || min < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid minAmount",
          });
        }

        filters.push("#amount >= :minAmount");

        ExpressionAttributeNames["#amount"] = "amount";

        ExpressionAttributeValues[":minAmount"] = min;
      }

      // MAX AMOUNT
      if (maxAmount !== undefined) {
        const max = Number(maxAmount);

        if (!Number.isFinite(max) || max < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid maxAmount",
          });
        }

        filters.push("#amount <= :maxAmount");

        ExpressionAttributeNames["#amount"] = "amount";

        ExpressionAttributeValues[":maxAmount"] = max;
      }

      // ----------------------------------------
      // DATE FILTER
      // ----------------------------------------

      if (fromDate) {
        const startDate = new Date(fromDate);

        if (isNaN(startDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid fromDate",
          });
        }

        filters.push("#requestedAt >= :fromDate");

        ExpressionAttributeNames["#requestedAt"] =
          "requestedAt";

        ExpressionAttributeValues[":fromDate"] =
          startDate.toISOString();
      }

      if (toDate) {
        const endDate = new Date(toDate);

        if (isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: "Invalid toDate",
          });
        }

        /*
         * If only a date is supplied, include the whole day.
         *
         * Example:
         * 2026-09-17
         *
         * becomes:
         * 2026-09-17T23:59:59.999Z
         */

        if (/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
          endDate.setUTCHours(23, 59, 59, 999);
        }

        filters.push("#requestedAt <= :toDate");

        ExpressionAttributeNames["#requestedAt"] =
          "requestedAt";

        ExpressionAttributeValues[":toDate"] =
          endDate.toISOString();
      }

      // ----------------------------------------
      // SCAN PARAMS
      // ----------------------------------------

      const params = {
        TableName: "withdrawal",
        Limit: limit,
      };

      if (filters.length > 0) {
        params.FilterExpression = filters.join(" AND ");

        params.ExpressionAttributeNames =
          ExpressionAttributeNames;

        params.ExpressionAttributeValues =
          ExpressionAttributeValues;
      }

      // ----------------------------------------
      // CURSOR
      // ----------------------------------------

      if (cursor) {
        try {
          params.ExclusiveStartKey = JSON.parse(
            Buffer.from(cursor, "base64").toString("utf8")
          );
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: "Invalid cursor",
          });
        }
      }

      // ----------------------------------------
      // GET WITHDRAWALS
      // ----------------------------------------

      const result = await docClient.send(
        new ScanCommand(params)
      );

      let withdrawals = result.Items || [];

      // ----------------------------------------
      // SEARCH
      // ----------------------------------------
      /*
       * Search supports:
       * - withdrawalId
       * - userId
       * - upiId
       *
       * User name is handled after fetching student/teacher.
       */

      if (search && search.trim()) {
        const searchText = search.trim().toLowerCase();

        withdrawals = withdrawals.filter((withdrawal) => {
          return (
            String(withdrawal.withdrawalId || "")
              .toLowerCase()
              .includes(searchText) ||
            String(withdrawal.userId || "")
              .toLowerCase()
              .includes(searchText) ||
            String(withdrawal.upiId || "")
              .toLowerCase()
              .includes(searchText)
          );
        });
      }

      // ----------------------------------------
      // RESOLVE USER + INSTITUTION
      // ----------------------------------------

      const data = await Promise.all(
        withdrawals.map(async (withdrawal) => {
          let user = null;
          let userName = "Unknown User";
          let userEmail = null;
          let institutionName = "Unknown Institution";

          // ------------------------------
          // STUDENT
          // ------------------------------

          if (withdrawal.userRole === "student") {
            const studentResult = await docClient.send(
              new GetCommand({
                TableName: "students",
                Key: {
                  studentId: withdrawal.userId,
                },
              })
            );

            user = studentResult.Item || null;

            if (user) {
              userName =
                `${user.firstName || ""} ${
                  user.lastName || ""
                }`.trim() ||
                user.name ||
                "Unknown Student";

              userEmail = user.emailId || user.email || null;
            }
          }

          // ------------------------------
          // TEACHER
          // ------------------------------

          if (withdrawal.userRole === "teacher") {
            const teacherResult = await docClient.send(
              new GetCommand({
                TableName: "teachers",
                Key: {
                  teacherId: withdrawal.userId,
                },
              })
            );

            user = teacherResult.Item || null;

            if (user) {
              userName =
                `${user.firstName || ""} ${
                  user.lastName || ""
                }`.trim() ||
                user.name ||
                "Unknown Teacher";

              userEmail = user.emailId || user.email || null;
            }
          }

          // ------------------------------
          // INSTITUTION
          // ------------------------------

          if (withdrawal.institutionId) {
            const institutionResult = await docClient.send(
              new GetCommand({
                TableName: "Institutions",
                Key: {
                  institutionId:withdrawal.institutionId,
                },
              })
            );

            if (institutionResult.Item) {
              institutionName =
                institutionResult.Item.name ||
                institutionResult.Item.InstitutionName ||
                "Unknown Institution";
            }
          }

          return {
            ...withdrawal,

            // Dynamic user information
            userName,
            userEmail,

            // Dynamic institution information
            institutionName,

            // Useful for frontend
            userExists: !!user,
          };
        })
      );

      // ----------------------------------------
      // SEARCH BY USER NAME
      // ----------------------------------------

      let finalData = data;

      if (search && search.trim()) {
        const searchText = search.trim().toLowerCase();

        finalData = data.filter((withdrawal) => {
          return (
            String(withdrawal.withdrawalId || "")
              .toLowerCase()
              .includes(searchText) ||
            String(withdrawal.userId || "")
              .toLowerCase()
              .includes(searchText) ||
            String(withdrawal.upiId || "")
              .toLowerCase()
              .includes(searchText) ||
            String(withdrawal.userName || "")
              .toLowerCase()
              .includes(searchText)
          );
        });
      }

      // ----------------------------------------
      // SORT
      // ----------------------------------------
      // Newest withdrawal first

      finalData.sort((a, b) => {
        return (
          new Date(b.requestedAt || b.createdAt) -
          new Date(a.requestedAt || a.createdAt)
        );
      });

      // ----------------------------------------
      // NEXT CURSOR
      // ----------------------------------------

      let nextCursor = null;

      if (result.LastEvaluatedKey) {
        nextCursor = Buffer.from(
          JSON.stringify(result.LastEvaluatedKey)
        ).toString("base64");
      }

      // ----------------------------------------
      // RESPONSE
      // ----------------------------------------

      return res.status(200).json({
        success: true,

        count: finalData.length,

        data: finalData,

        nextCursor,
      });
    } catch (error) {
      console.error(
        "Get admin withdrawals error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to fetch withdrawal requests",
        error: error.message,
      });
    }
  }
);

pyqNotesRouter.patch("/sadmin/withdrawals/:withdrawalId/status",SAuth,async (req, res) => {
    try {
      const { withdrawalId } = req.params;

      const {
        status,
        adminNote,
        paymentReferenceId,
        failureReason,
      } = req.body || {};

      // ----------------------------------------
      // VALIDATE WITHDRAWAL ID
      // ----------------------------------------

      if (!withdrawalId) {
        return res.status(400).json({
          success: false,
          message: "Withdrawal ID is required",
        });
      }

      // ----------------------------------------
      // VALIDATE STATUS
      // ----------------------------------------

      const allowedStatuses = [
        "PROCESSING",
        "PAID",
        "REJECTED",
        "FAILED",
      ];

      const newStatus = String(status || "")
        .trim()
        .toUpperCase();

      if (!allowedStatuses.includes(newStatus)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid status. Use PROCESSING, PAID, REJECTED or FAILED",
        });
      }

      // ----------------------------------------
      // GET ADMIN ID
      // ----------------------------------------

      const adminId = req.admin?.adminId;

      if (!adminId) {
        return res.status(401).json({
          success: false,
          message: "Admin information not found",
        });
      }

      // ----------------------------------------
      // GET WITHDRAWAL
      // ----------------------------------------

      const withdrawalResult = await docClient.send(
        new GetCommand({
          TableName: "withdrawal",
          Key: {
            withdrawalId,
          },
        })
      );

      const withdrawal = withdrawalResult.Item;

      if (!withdrawal) {
        return res.status(404).json({
          success: false,
          message: "Withdrawal request not found",
        });
      }

      // ----------------------------------------
      // CURRENT STATUS
      // ----------------------------------------

      const currentStatus = String(
        withdrawal.status || ""
      ).toUpperCase();

      // ----------------------------------------
      // PREVENT UPDATING COMPLETED REQUESTS
      // ----------------------------------------

      if (
        currentStatus === "PAID" ||
        currentStatus === "REJECTED" ||
        currentStatus === "FAILED"
      ) {
        return res.status(400).json({
          success: false,
          message: `Withdrawal is already ${currentStatus} and cannot be updated`,
        });
      }

      // ----------------------------------------
      // VALIDATE STATUS TRANSITION
      // ----------------------------------------

      if (
        currentStatus === "PENDING" &&
        !["PROCESSING", "REJECTED"].includes(newStatus)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "PENDING withdrawal can only be moved to PROCESSING or REJECTED",
        });
      }

      if (
        currentStatus === "PROCESSING" &&
        !["PAID", "FAILED"].includes(newStatus)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "PROCESSING withdrawal can only be moved to PAID or FAILED",
        });
      }

      // ----------------------------------------
      // VALIDATE PAYMENT REFERENCE
      // ----------------------------------------

      if (newStatus === "PAID") {
        if (
          !paymentReferenceId ||
          typeof paymentReferenceId !== "string" ||
          !paymentReferenceId.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Payment reference ID is required when marking withdrawal as PAID",
          });
        }
      }

      // ----------------------------------------
      // VALIDATE FAILURE REASON
      // ----------------------------------------

      if (newStatus === "FAILED") {
        if (
          !failureReason ||
          typeof failureReason !== "string" ||
          !failureReason.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Failure reason is required when marking withdrawal as FAILED",
          });
        }
      }

      // ----------------------------------------
      // VALIDATE REJECTION NOTE
      // ----------------------------------------

      if (newStatus === "REJECTED") {
        if (
          !adminNote ||
          typeof adminNote !== "string" ||
          !adminNote.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Admin note is required when rejecting withdrawal",
          });
        }
      }

      // ----------------------------------------
      // AMOUNT
      // ----------------------------------------

      const amount = Number(withdrawal.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid withdrawal amount",
        });
      }

      // ----------------------------------------
      // CURRENT TIME
      // ----------------------------------------

      const now = new Date().toISOString();

      // ----------------------------------------
      // DOES THIS REQUIRE REFUND?
      // ----------------------------------------

      const shouldRefund =
        newStatus === "REJECTED" ||
        newStatus === "FAILED";

      // ----------------------------------------
      // NORMAL STATUS UPDATE
      // ----------------------------------------

      if (!shouldRefund) {
        const updateExpressionParts = [
          "#status = :status",
          "updatedAt = :updatedAt",
          "adminId = :adminId",
        ];

        const expressionAttributeNames = {
          "#status": "status",
        };

        const expressionAttributeValues = {
          ":status": newStatus,
          ":updatedAt": now,
          ":adminId": adminId,
          ":oldStatus": currentStatus,
        };

        // PROCESSING
        if (newStatus === "PROCESSING") {
          updateExpressionParts.push(
            "processedAt = :processedAt"
          );

          expressionAttributeValues[":processedAt"] = now;
        }

        // PAID
        if (newStatus === "PAID") {
          updateExpressionParts.push(
            "paidAt = :paidAt",
            "paymentReferenceId = :paymentReferenceId"
          );

          expressionAttributeValues[":paidAt"] = now;

          expressionAttributeValues[
            ":paymentReferenceId"
          ] = paymentReferenceId.trim();
        }

        // ADMIN NOTE
        if (
          adminNote &&
          typeof adminNote === "string" &&
          adminNote.trim()
        ) {
          updateExpressionParts.push(
            "adminNote = :adminNote"
          );

          expressionAttributeValues[":adminNote"] =
            adminNote.trim();
        }

        await docClient.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: "withdrawal",

                  Key: {
                    withdrawalId,
                  },

                  UpdateExpression:
                    "SET " +
                    updateExpressionParts.join(", "),

                  ConditionExpression:
                    "#status = :oldStatus",

                  ExpressionAttributeNames:
                    expressionAttributeNames,

                  ExpressionAttributeValues:
                    expressionAttributeValues,
                },
              },
            ],
          })
        );

        return res.status(200).json({
          success: true,
          message: `Withdrawal marked as ${newStatus}`,
          data: {
            withdrawalId,
            previousStatus: currentStatus,
            status: newStatus,
            adminId,
            updatedAt: now,
            paymentReferenceId:
              newStatus === "PAID"
                ? paymentReferenceId.trim()
                : null,
          },
        });
      }

      // ----------------------------------------
      // REFUND FLOW
      // ----------------------------------------

      // Get wallet
      const walletResult = await docClient.send(
        new GetCommand({
          TableName: "wallet",
          Key: {
            walletId: withdrawal.walletId,
          },
        })
      );

      const wallet = walletResult.Item;

      if (!wallet) {
        return res.status(404).json({
          success: false,
          message: "User wallet not found",
        });
      }

      const refundTransactionId = `txn-${uuidv4()}`;

      let refundDescription;

      if (newStatus === "REJECTED") {
        refundDescription =
          `Refund for rejected withdrawal ${withdrawalId}`;
      } else {
        refundDescription =
          `Refund for failed withdrawal ${withdrawalId}`;
      }

      // ----------------------------------------
      // ATOMIC REFUND
      // ----------------------------------------

      const transactionItems = [
        // 1. Update withdrawal
        {
          Update: {
            TableName: "withdrawal",

            Key: {
              withdrawalId,
            },

            UpdateExpression:
              "SET #status = :status, " +
              "updatedAt = :updatedAt, " +
              "processedAt = :processedAt, " +
              "adminId = :adminId, " +
              "adminNote = :adminNote, " +
              "failureReason = :failureReason",

            ConditionExpression:
              "#status = :oldStatus",

            ExpressionAttributeNames: {
              "#status": "status",
            },

            ExpressionAttributeValues: {
              ":status": newStatus,
              ":oldStatus": currentStatus,
              ":updatedAt": now,
              ":processedAt": now,
              ":adminId": adminId,
              ":adminNote":
                adminNote?.trim() || null,
              ":failureReason":
                failureReason?.trim() ||
                null,
            },
          },
        },

        // 2. Refund wallet
        {
          Update: {
            TableName: "wallet",

            Key: {
              walletId: withdrawal.walletId,
            },

            UpdateExpression:
              "SET balance = balance + :amount, " +
              "updatedAt = :updatedAt",

            ConditionExpression:
              "attribute_exists(walletId)",

            ExpressionAttributeValues: {
              ":amount": amount,
              ":updatedAt": now,
            },
          },
        },

        // 3. Create refund transaction
        {
          Put: {
            TableName: "walletTransaction",

            Item: {
              transactionId: refundTransactionId,

              walletId: withdrawal.walletId,

              userId: withdrawal.userId,

              type: "CREDIT",

              amount,

              source: "WITHDRAWAL_REFUND",

              referenceId: withdrawalId,

              description: refundDescription,

              status: "COMPLETED",

              createdAt: now,
            },

            ConditionExpression:
              "attribute_not_exists(transactionId)",
          },
        },
      ];

      await docClient.send(
        new TransactWriteCommand({
          TransactItems: transactionItems,
        })
      );

      return res.status(200).json({
        success: true,

        message: `Withdrawal ${newStatus.toLowerCase()} and amount refunded to wallet`,

        data: {
          withdrawalId,

          previousStatus: currentStatus,

          status: newStatus,

          refundedAmount: amount,

          walletId: withdrawal.walletId,

          userId: withdrawal.userId,

          refundTransactionId,

          adminId,

          updatedAt: now,
        },
      });
    } catch (error) {
      console.error(
        "Update withdrawal status error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to update withdrawal status",
        error: error.message,
      });
    }
  }
);


module.exports = pyqNotesRouter;
