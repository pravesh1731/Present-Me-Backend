const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const studAuth = require("../../middlewares/student_auth");
const tAuth = require("../../middlewares/teacherAuth");
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { TransactWriteCommand } = require("@aws-sdk/lib-dynamodb");

const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const anyAuth = require("../../middlewares/anyAuth");
const { docClient } = require("../../dynamoDb");

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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
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
    let reservedDuplicateKey = null;
    let fileKey = null;
    let uniqueReservationCreated = false;
    let s3Uploaded = false;
    let noteCreated = false;

    try {
      // ─────────────────────────────────────
      // 1. Get uploader ID and role
      // ─────────────────────────────────────

      const uploaderId = req.student?.studentId ?? req.teacherId?.teacherId;

      const uploaderRole = req.student ? "student" : "teacher";

      if (!uploaderId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized user",
        });
      }

      // ─────────────────────────────────────
      // 2. Validate file
      // ─────────────────────────────────────

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      // ─────────────────────────────────────
      // 3. Validate required fields
      // ─────────────────────────────────────

      const { type, semester, year, course, department, teacherName } =
        req.body;

      if (!type || !semester || !year || !course || !department) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      // ─────────────────────────────────────
      // 4. Validate type
      // ─────────────────────────────────────

      if (type !== "Notes" && type !== "PYQ") {
        return res.status(400).json({
          success: false,
          message: "Type must be either Notes or PYQ",
        });
      }

      // ─────────────────────────────────────
      // 5. Teacher name required for Notes
      // ─────────────────────────────────────

      if (type === "Notes" && !teacherName) {
        return res.status(400).json({
          success: false,
          message: "Teacher name is required for Notes",
        });
      }

      // ─────────────────────────────────────
      // 6. Get uploader from DynamoDB
      // ─────────────────────────────────────

      const userTable = uploaderRole === "student" ? "students" : "teachers";

      const userKey =
        uploaderRole === "student"
          ? { studentId: uploaderId }
          : { teacherId: uploaderId };

      const userResult = await dynamo.send(
        new GetCommand({
          TableName: userTable,
          Key: userKey,
        }),
      );

      if (!userResult.Item) {
        return res.status(404).json({
          success: false,
          message: `${
            uploaderRole === "student" ? "Student" : "Teacher"
          } not found`,
        });
      }

      const user = userResult.Item;

      // ─────────────────────────────────────
      // 7. Get institution
      // ─────────────────────────────────────

      const institutionId = user.institutionId;

      if (!institutionId) {
        return res.status(400).json({
          success: false,
          message: "Uploader institution not found",
        });
      }

      // ─────────────────────────────────────
      // 8. Normalize values
      // ─────────────────────────────────────

      const normalize = (value) =>
        String(value).trim().replace(/\s+/g, " ").toLowerCase();

      // ─────────────────────────────────────
      // 9. Generate unique duplicate key
      // ─────────────────────────────────────

      const duplicateKey = [
        institutionId,
        normalize(type),
        normalize(semester),
        normalize(year),
        normalize(course),
        normalize(department),
      ].join("#");

      const notesLookupKey = [
        institutionId,
        course,
        department,
        semester,
        type,
      ].join("#");

      reservedDuplicateKey = duplicateKey;

      // ─────────────────────────────────────
      // 10. Generate note ID + timestamp
      // ─────────────────────────────────────

      const noteId = `note-${uuidv4()}`;

      const createdAt = new Date().toISOString();

      // ─────────────────────────────────────
      // 11. Reserve unique combination
      //
      // This replaces ScanCommand completely.
      //
      // Only ONE pending/approved note can
      // own this duplicateKey.
      // ─────────────────────────────────────

      try {
        await dynamo.send(
          new PutCommand({
            TableName: "noteUnique",

            Item: {
              duplicateKey,
              noteId,
              status: "pending",
              createdAt,
            },

            ConditionExpression: "attribute_not_exists(duplicateKey)",
          }),
        );

        uniqueReservationCreated = true;
      } catch (error) {
        // Another pending/approved note
        // already owns this key.
        if (error.name === "ConditionalCheckFailedException") {
          return res.status(409).json({
            success: false,
            isDuplicate: true,
            message:
              "A Notes/PYQ already exists for this course, department, semester and year, Try New One",
          });
        }

        throw error;
      }

      // ─────────────────────────────────────
      // 12. Upload file to S3
      // ─────────────────────────────────────

      const fileExt =
        req.file.originalname.split(".").pop()?.toLowerCase() || "pdf";

      fileKey = `study-materials/${institutionId}/` + `${noteId}.${fileExt}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: "presentme-document",
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }),
      );

      s3Uploaded = true;

      // ─────────────────────────────────────
      // 13. Generate file URL
      // ─────────────────────────────────────

      const fileUrl = `https://presentme-document.s3.ap-south-1.amazonaws.com/${fileKey}`;

      // ─────────────────────────────────────
      // 14. Create notes item
      // ─────────────────────────────────────

      const noteItem = {
        noteId,
        duplicateKey,
        notesLookupKey,

        institutionId,

        // Uploader
        uploadedBy: uploaderId,

        // Note information
        status: "pending",
        type,
        semester,
        year,
        course,
        department,

        // Teacher name only for Notes
        teacherName: type === "Notes" ? teacherName.trim() : null,

        // File information
        fileName: req.file.originalname,
        fileUrl,
        fileKey,

        // Downloads
        downloads: 0,

        // Time
        createdAt,
      };

      // ─────────────────────────────────────
      // 15. Save note
      // ─────────────────────────────────────

      await dynamo.send(
        new PutCommand({
          TableName: "notes",
          Item: noteItem,
        }),
      );

      noteCreated = true;

      // ─────────────────────────────────────
      // 16. Mark unique reservation complete
      // ─────────────────────────────────────

      await dynamo.send(
        new UpdateCommand({
          TableName: "noteUnique",

          Key: {
            duplicateKey,
          },

          UpdateExpression: "SET #status = :status",

          ExpressionAttributeNames: {
            "#status": "status",
          },

          ExpressionAttributeValues: {
            ":status": "pending",
          },
        }),
      );

      // ─────────────────────────────────────
      // 17. Success
      // ─────────────────────────────────────

      return res.status(201).json({
        success: true,

        message: "Uploaded successfully. Pending approval.",

        noteId,

        uploadedBy: uploaderId,

        status: "pending",

        createdAt,

        fileUrl,
      });
    } catch (error) {
      console.error("Notes upload error:", error);

      // ─────────────────────────────────────
      // CLEANUP
      // ─────────────────────────────────────

      // If S3 uploaded but notes creation
      // failed, delete the orphaned S3 file.
      if (s3Uploaded && fileKey && !noteCreated) {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: "presentme-document",
              Key: fileKey,
            }),
          );
        } catch (cleanupError) {
          console.error("S3 cleanup failed:", cleanupError);
        }
      }

      // If unique reservation was created
      // but the upload failed, release it.
      if (uniqueReservationCreated && reservedDuplicateKey && !noteCreated) {
        try {
          await dynamo.send(
            new DeleteCommand({
              TableName: "noteUnique",

              Key: {
                duplicateKey: reservedDuplicateKey,
              },
            }),
          );
        } catch (cleanupError) {
          console.error("Unique reservation cleanup failed:", cleanupError);
        }
      }

      // ─────────────────────────────────────
      // Existing PDF validation error
      // ─────────────────────────────────────

      if (error.message?.includes("Only PDF")) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      // ─────────────────────────────────────
      // Generic error
      // ─────────────────────────────────────

      return res.status(500).json({
        success: false,
        message: "Failed to upload note",
        error: error.message,
      });
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

    // ─────────────────────────────────────
    // Get student / teacher
    // ─────────────────────────────────────

    const studentResult = await dynamo.send(
      new GetCommand({
        TableName: req.student ? "students" : "teachers",

        Key: req.student
          ? { studentId: uploaderId }
          : { teacherId: uploaderId },
      }),
    );

    if (!studentResult.Item) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    const institutionId = studentResult.Item.institutionId;

    if (!institutionId) {
      return res.status(400).json({
        message: "Institution not found for user",
      });
    }

    // ─────────────────────────────────────
    // Build lookup key
    // ─────────────────────────────────────

    const notesLookupKey = [
      institutionId,
      course,
      department,
      semester,
      type,
    ].join("#");

    // ─────────────────────────────────────
    // Fetch approved notes
    // Latest first
    // ─────────────────────────────────────

    const result = await dynamo.send(
      new QueryCommand({
        TableName: "notes",

        IndexName: "notesLookupIndex",

        KeyConditionExpression: "notesLookupKey = :lookupKey",

        FilterExpression: "#status = :approved",

        ExpressionAttributeNames: {
          "#status": "status",
        },

        ExpressionAttributeValues: {
          ":lookupKey": notesLookupKey,
          ":approved": "approved",
        },

        ScanIndexForward: false,
      }),
    );

    return res.status(200).json({
      success: true,
      count: result.Items?.length || 0,
      data: result.Items || [],
    });
  } catch (error) {
    console.error("Fetch notes error:", error);

    return res.status(500).json({
      message: "Failed to fetch notes",
    });
  }
});

notesRouter.get("/students/notes/my-uploads", anyAuth, async (req, res) => {
  try {
    const uploaderId = req.student?.studentId ?? req.teacherId?.teacherId;

    const result = await dynamo.send(
      new QueryCommand({
        TableName: "notes",
        IndexName: "uploadedBy-index",
        KeyConditionExpression: "uploadedBy = :sid",
        ExpressionAttributeValues: {
          ":sid": uploaderId, // ✅
        },
        ScanIndexForward: false,
      }),
    );

    res.json({
      message: "Fetched your uploads",
      total: result.Items?.length ?? 0,
      data: result.Items || [],
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

// Minimum withdrawal amount
const MIN_WITHDRAWAL = 10;

notesRouter.post("/withdrawal/request", anyAuth, async (req, res) => {
  try {
    // =================================================
    // 1. GET AUTHENTICATED USER
    // =================================================

    const userId = req.student?.studentId ?? req.teacherId?.teacherId;

    const userRole = req.student ? "student" : req.teacherId ? "teacher" : null;

    if (!userId || !userRole) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }
    // =================================================
    // 2. GET REQUEST BODY
    // =================================================

    const { amount, upiId } = req.body;

    // =================================================
    // 3. VALIDATE AMOUNT
    // =================================================

    const withdrawalAmount = Number(amount);

    if (
      amount === undefined ||
      amount === null ||
      amount === "" ||
      !Number.isFinite(withdrawalAmount)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid withdrawal amount is required",
      });
    }

    if (withdrawalAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL}`,
      });
    }

    // Only allow 2 decimal places
    if (Math.round(withdrawalAmount * 100) !== withdrawalAmount * 100) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal amount can have maximum 2 decimal places",
      });
    }

    // =================================================
    // 4. VALIDATE UPI ID
    // =================================================

    if (!upiId || typeof upiId !== "string" || !upiId.trim()) {
      return res.status(400).json({
        success: false,
        message: "UPI ID is required",
      });
    }

    const cleanUpiId = upiId.trim().toLowerCase();

    // Basic UPI format validation
    const upiRegex = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;

    if (!upiRegex.test(cleanUpiId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid UPI ID",
      });
    }

    // =================================================
    // 5. FIND WALLET
    // =================================================

    const walletResult = await docClient.send(
      new QueryCommand({
        TableName: "wallet",
        IndexName: "userId-index",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        Limit: 1,
      }),
    );

    const wallet = walletResult.Items?.[0];

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    // =================================================
    // 6. CHECK WALLET STATUS
    // =================================================

    if (wallet.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: "Wallet is not active",
      });
    }

    // =================================================
    // 7. CHECK BALANCE
    // =================================================

    const currentBalance = Number(wallet.balance || 0);

    if (withdrawalAmount > currentBalance) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        data: {
          availableBalance: currentBalance,
          requestedAmount: withdrawalAmount,
        },
      });
    }

    // =================================================
    // 8. GET INSTITUTION ID
    // =================================================

    let institutionId = null;

    if (userRole === "student") {
      const studentResult = await docClient.send(
        new GetCommand({
          TableName: "students",
          Key: {
            studentId: userId,
          },
        }),
      );

      if (!studentResult.Item) {
        return res.status(404).json({
          success: false,
          message: "Student not found",
        });
      }

      institutionId = studentResult.Item.institutionId;
    }

    if (userRole === "teacher") {
      const teacherResult = await docClient.send(
        new GetCommand({
          TableName: "teachers",
          Key: {
            teacherId: userId,
          },
        }),
      );

      if (!teacherResult.Item) {
        return res.status(404).json({
          success: false,
          message: "Teacher not found",
        });
      }

      institutionId = teacherResult.Item.institutionId;
    }

    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: "User institution not found",
      });
    }

    // =================================================
    // 9. CREATE IDs
    // =================================================

    const withdrawalId = `wd-${uuidv4()}`;

    const transactionId = `txn-${uuidv4()}`;

    const now = new Date().toISOString();

    // =================================================
    // 10. TRANSACTION
    // =================================================
    //
    // Wallet balance
    //       ↓
    // Debit amount
    //
    // Withdrawal
    //       ↓
    // PENDING
    //
    // WalletTransaction
    //       ↓
    // DEBIT
    //
    // All three happen together.
    // =================================================

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // -----------------------------------------
          // UPDATE WALLET
          // -----------------------------------------

          {
            Update: {
              TableName: "wallet",

              Key: {
                walletId: wallet.walletId,
              },

              UpdateExpression:
                "SET balance = balance - :amount, updatedAt = :updatedAt",

              ConditionExpression:
                "attribute_exists(walletId) AND " +
                "#status = :active AND " +
                "balance >= :amount",

              ExpressionAttributeNames: {
                "#status": "status",
              },

              ExpressionAttributeValues: {
                ":amount": withdrawalAmount,
                ":active": "ACTIVE",
                ":updatedAt": now,
              },
            },
          },

          // -----------------------------------------
          // CREATE WITHDRAWAL
          // -----------------------------------------

          {
            Put: {
              TableName: "withdrawal",

              Item: {
                withdrawalId,

                walletId: wallet.walletId,

                userId,

                userRole,

                institutionId,

                amount: withdrawalAmount,

                currency: "INR",

                upiId: cleanUpiId,

                status: "PENDING",

                requestedAt: now,

                createdAt: now,

                updatedAt: now,
              },

              ConditionExpression: "attribute_not_exists(withdrawalId)",
            },
          },

          // -----------------------------------------
          // CREATE WALLET TRANSACTION
          // -----------------------------------------

          {
            Put: {
              TableName: "walletTransaction",

              Item: {
                transactionId,

                walletId: wallet.walletId,

                userId,

                type: "DEBIT",

                amount: withdrawalAmount,

                source: "WITHDRAWAL",

                referenceId: withdrawalId,

                description: `Withdrawal request of ₹${withdrawalAmount}`,

                status: "COMPLETED",

                createdAt: now,
              },

              ConditionExpression: "attribute_not_exists(transactionId)",
            },
          },
        ],
      }),
    );

    // =================================================
    // 11. RESPONSE
    // =================================================

    return res.status(201).json({
      success: true,

      message: "Withdrawal request submitted successfully",

      data: {
        withdrawalId,

        userId,

        userRole,

        institutionId,

        walletId: wallet.walletId,

        amount: withdrawalAmount,

        currency: "INR",

        upiId: cleanUpiId,

        status: "PENDING",

        requestedAt: now,

        // Expected balance after withdrawal
        availableBalance: currentBalance - withdrawalAmount,
      },
    });
  } catch (error) {
    console.error("Withdrawal request error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create withdrawal request",
      error: error.message,
    });
  }
});

module.exports = notesRouter;
