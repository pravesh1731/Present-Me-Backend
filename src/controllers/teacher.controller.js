const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");


const { updateTeacherProfile } = require("../services/teacher.service");
const { findById } = require("../services/aws.service");
const { validate } = require("uuid");
const { validatePatchTeacherSchema } = require("../validations/teacher.validation");

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


// PATCH /teachers/profile
exports.patchTeacherProfile = async (req, res) => {
  try {
    const teacherId = req.teacherId.teacherId; // assuming teacherAuth sets req.teacher
    const existingTeacher = await findById(teacherId, "teachers","teacherId");
    if (!existingTeacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    // validate only the fields provided (PATCH schema → all optional)
    const { error } = validatePatchTeacherSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    let updates = { ...req.body };

    // Handle profile image if present
    if (req.file) {
      // Delete old image if exists
      if (existingTeacher.profilePicUrl) {
        const oldKey = existingTeacher.profilePicUrl.split(".amazonaws.com/")[1];
        if (oldKey) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: oldKey,
            })
          );
        }
      }

      const fileKey = `teachers/profile/${teacherId}-${Date.now()}.jpg`;

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
    const updatedTeacher = await updateTeacherProfile(teacherId, updates);

    return res.status(200).json({ success: true, data: updatedTeacher });
  } catch (err) {
    console.error("patchTeacherProfile error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


// middleware
exports.uploadTeacherProfileImage = upload.single("profilePicUrl");