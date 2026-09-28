const {S3Client,PutObjectCommand,DeleteObjectCommand}=require("@aws-sdk/client-s3");
const multer = require("multer");
const {updateInstitutionProfile,findById}= require("../services/aws.service");
const { validatePatchInstitutionSchema } = require("../validations/common.validation");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// Configure AWS SDK
const s3 = new S3Client({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
//PATCH Controller to update institution profile
exports.patchInstitutionProfile= async(req, res)=> {
  try{
    const institutionId = req.institute.institutionId;
    const existingInstitution= await findById(institutionId,"Institutions","institutionId");
    if(!existingInstitution){
      return res.status(404).json({message:"Institution not found"});
    }
    const {error}= validatePatchInstitutionSchema.validate(req.body);
    if(error){
      return res.status(400).json({message:error.details[0].message});
    }

    let updates={...req.body};

    //Handle file uploads if any
    if(req.file){
      if(existingInstitution.profilePicUrl){
        //Delete old profile picture from S3
        const oldKey = existingInstitution.profilePicUrl.split(".amazonaws.com/")[1];
        if (oldKey) {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: oldKey,
            })
          );
        }
      }
      const fileKey= `institutions/profile/${institutionId}-${Date.now()}.jpg`;
      await s3.send(
        new PutObjectCommand({
          Bucket:process.env.AWS_S3_BUCKET,
          Key:fileKey,
          Body:req.file.buffer,
          ContentType:req.file.mimetype,
        })
      );
      const profilePicUrl= `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;
      updates.profilePicUrl= profilePicUrl;
    }
    const updatedInstitution= await updateInstitutionProfile(institutionId,updates);
    res.status(200).json({success:true, data:updatedInstitution});  
  }catch(err){
    res.status(500).json({success:false, message:err.message});
  }
};
exports.uploadProfileImage= upload.single("profilePicUrl");