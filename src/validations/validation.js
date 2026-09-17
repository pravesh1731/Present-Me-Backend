const Joi = require("joi");

const validateInstitutionSchema = Joi.object({
  firstName: Joi.string().min(2).max(30).required(),
  lastName: Joi.string().min(2).max(30).required(),
  emailId: Joi.string().email().required(),
  phone: Joi.string().required(),
  password: Joi.string().min(6).max(128).required(),
  InstitutionName: Joi.string().min(2).max(100).required(),
  Role: Joi.string().valid("Dean", "HOD", "Class Incharge").required(),
  bio: Joi.string().max(500).optional().allow(null, ""),
  address: Joi.string().min(10).max(200).required(),
  website: Joi.string().min(0).max(50).required(),
  expectedStudents: Joi.number().integer().min(0).required(),
  expectedTeachers: Joi.number().integer().min(0).required(),
}).unknown(true); // Allow file uploads like aadhar and designationID

const validateStudentSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "First name is required",
    "string.min": "First name must be at least 2 characters long",
  }),

  lastName: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Last name is required",
  }),

  emailId: Joi.string().email().required().messages({
    "string.email": "Email must be valid",
    "string.empty": "Email is required",
  }),

  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .required()
    .messages({
      "string.pattern.base": "Phone number must be 10 digits",
      "string.empty": "Phone number is required",
    }),

  password: Joi.string()
    .min(6)
    .max(20)
    .required()
    .pattern(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[@$!%*?&]).+$/)
    .messages({
      "string.pattern.base":
        "Password must include uppercase, lowercase, number, and special character",
      "string.min": "Password must be at least 6 characters long",
      "string.empty": "Password is required",
    }),

  rollNo: Joi.string().trim().required().messages({
    "string.empty": "Roll number is required",
  }),


  semester: Joi.number().integer().required().min(1).max(8).messages({
    'any.required': 'Semester is required',
    'number.min': 'Semester must be at least 1',
    'number.max': 'Semester cannot be greater than 8',
    'number.base': 'Semester must be a number'
}),


  institutionId: Joi.string().trim().required().messages({
    "string.empty": "Institution selection is required",
  }),
});

const validatePatchStudentSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).optional(),

  lastName: Joi.string().trim().min(2).max(50).optional(),

  emailId: Joi.string().email().optional(),

  phone: Joi.string()
    .pattern(/^[0-9]{10}$/)
    .optional(),

  rollNo: Joi.string().trim().min(1).max(10).optional(),

  semester: Joi.string().trim().min(1).max(10).optional(),

  branch: Joi.string().trim().min(2).max(50).optional(),

  yearOfStudy: Joi.number().integer().min(1).max(6).optional(),

  section: Joi.string().trim().min(1).max(5).optional(),

  bio: Joi.string().trim().max(500).optional(),
}).unknown(true); // must update at least one field


const validateClassName = Joi.object({
  className: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Class name is required",
    "string.min": "Class name must be at least 2 characters long",
  }),
  roomNo: Joi.string().trim().min(1).max(20).required().messages({
    "string.empty": "Room number is required",
  }),
  startTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({
      "string.empty": "Start time is required",
      "string.pattern.base": "Start time must be in HH:mm format (24-hour)",
    }),

  endTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .required()
    .messages({
      "string.empty": "End time is required",
      "string.pattern.base": "End time must be in HH:mm format (24-hour)",
    }),
  classDays: Joi.array()
    .items(Joi.string().valid(
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday"
    ))
    .min(1)
    .required()
    .messages({
      "array.min": "At least one class day is required",
    }),
});

const validatePatchInstitutionSchema = Joi.object({
  firstName: Joi.string().min(2).max(30).optional(),
  lastName: Joi.string().min(2).max(30).optional(),
  emailId: Joi.forbidden().messages({
    "any.unknown": "Email cannot be updated",
  }),
  phone: Joi.string().optional(),
  InstitutionName: Joi.string().min(2).max(100).optional(),
  Role: Joi.forbidden().messages({
    "any.unknown": "Role cannot be updated",
  }),
  bio: Joi.string().max(500).optional().allow(null, ""),
  profilePicUrl: Joi.any().optional(),
}).unknown(true); // Allow file uploads like profilePic

module.exports = {
  validateInstitutionSchema,
  validateStudentSchema,
  validateClassName,
  validatePatchInstitutionSchema,
  validatePatchStudentSchema,
};
