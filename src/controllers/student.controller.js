const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const { updateStudentProfile, findStudentById } = require("../services/student.service");
const { validatePatchStudentSchema,  } = require("../validations/common.validation");
const { findByEmail } = require("../services/student.service");
const { findById } = require("../services/aws.service");

// Multer: file in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// S3 client
const s3 = new S3Client({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});


// PATCH /students/profile
exports.patchStudentProfile = async (req, res) => {
  try {
    const studentId = req.student.studentId; // assuming studentAuth sets req.student

    const existingStudent = await findById(studentId, "students","studentId");
    if (!existingStudent) {
      return res.status(404).json({ message: "Student not found" });
    }

    // validate only the fields provided (PATCH schema → all optional)
    const { error } = validatePatchStudentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    let updates = { ...req.body };

    // Handle profile image if present
    if (req.file) {
      // Delete old image if exists
      if (existingStudent.profilePicUrl) {
        const oldKey = existingStudent.profilePicUrl.split(".amazonaws.com/")[1];
        if (oldKey) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: oldKey,
            })
          );
        }
      }

      const fileKey = `students/profile/${studentId}-${Date.now()}.jpg`;

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: fileKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );

      const profilePicUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
      updates.profilePicUrl = profilePicUrl;
    }

    // 🔥 This will CREATE any missing attributes & UPDATE existing ones
    const updatedStudent = await updateStudentProfile(studentId, updates);

    return res.status(200).json({ success: true, data: updatedStudent });
  } catch (err) {
    console.error("patchStudentProfile error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


// middleware
exports.uploadStudentProfileImage = upload.single("profilePicUrl");