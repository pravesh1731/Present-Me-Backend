const Joi = require("joi");
const teacherSignupSchema= Joi.object({
  firstName: Joi.string().min(2).max(30).required(),
  lastName: Joi.string().min(2).max(30).required(),
  emailId: Joi.string().email().required(),
  phone:Joi.string().pattern(/^[0-9]{10}$/).required(),
  password: Joi.string().min(6).max(128).required(),
  institutionId: Joi.string().required(),
  hotspotName: Joi.string().min(2).max(50).required(),

});


const validatePatchTeacherSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).optional(),
  lastName: Joi.string().trim().min(2).max(50).optional(),
  emailId: Joi.string().email().optional(),
  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .optional(),

  hotspotName: Joi.string().trim().min(1).max(20).optional(),  
  officeLocation: Joi.string().trim().min(1).max(100).optional(),
  department: Joi.string().trim().min(1).max(30).optional(),
  specialization: Joi.string().trim().min(2).max(20).optional(),
  qualification: Joi.string().trim().min(1).max(20).optional(),
  experience: Joi.string().trim().min(1).max(10).optional(),
  empId: Joi.string().trim().max(20).optional(),

}).unknown(true); // must update at least one field



const teacherLoginSchema= Joi.object({
  emailId: Joi.string().email().required(),
  password: Joi.string().min(6).max(128).required(),
});
module.exports={teacherSignupSchema,teacherLoginSchema,validatePatchTeacherSchema};