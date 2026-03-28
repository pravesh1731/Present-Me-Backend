//created for dynamodb operations related to teachers
const {
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { docClient } = require("../dynamoDb");
const { findByEmail, findById } = require("./awsService");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const { customAlphabet } = require("nanoid");

const TABLE_NAME = "teachers";

async function createTeacher(data) {
  const normalizedEmail = data.emailId.toLowerCase();
  //1) check duplicate
  const existing = await findByEmail(normalizedEmail, "teachers");
  if (existing) {
    const err = new Error("Email already exists");
    err.code = "DUPLICATE_EMAIL";
    throw err;
  }

  const hashedPassword = await bcrypt.hash(data.password, 10);

  const institution = await findById(
    data.institutionId,
    "Institutions",
    "institutionId"
  );
  if (!institution) {
    throw new Error("Invalid institutionId — no such institution found.");
  }

  const item = {
    teacherId: "t-" + uuidv4(),
    firstName: data.firstName,
    lastName: data.lastName,
    emailId: normalizedEmail,
    phone: data.phone,
    hotspotName: data.hotspotName,
    passwordHash: hashedPassword,
    institutionId: data.institutionId,
    type: "teacher",
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  const cmd = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(emailId)", //prevent overwrite if email exists
  });
  await docClient.send(cmd);
  return item;
}

// Generate 6-digit alphanumeric class code
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const generateClassCode = customAlphabet(alphabet, 6);

async function createClass({
  className,
  roomNo,
  startTime,
  endTime,
  classDays,
  createdBy,
}) {
  while (true) {
    const classCode = generateClassCode();

    const item = {
      classId: "c-" + uuidv4(),
      classCode, // PK
      roomNo,
      startTime,
      endTime,
      classDays,
      className,
      createdBy,
      joinRequests: [],
      students: [],
      createdAt: new Date().toISOString(),
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: "classes",
          Item: item,
          ConditionExpression: "attribute_not_exists(classCode)",
        })
      );

      return item; // ✅ success, unique code
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        // Duplicate → generate again
        continue;
      }
      throw err;
    }
  }
}

async function deleteClass(classCode) {
  const deleteCmd = new DeleteCommand({
    TableName: "classes",
    Key: {
      classCode: classCode,
    },
    ConditionExpression: "attribute_exists(classCode)",
    // ✅ ensures an error is thrown if class does NOT exist
  });

  try {
    await docClient.send(deleteCmd);
    return { success: true, message: "Class deleted successfully." };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return { success: false, message: "Class does not exist." };
    }
    throw err; // other errors
  }
}

async function updateClassName(
  classCode,
  newClassName,
  roomNo,
  startTime,
  endTime,
  classDays
) {
  try {
    const cmd = new UpdateCommand({
      TableName: "classes",
      Key: { classCode },
      UpdateExpression: `
        SET 
          className = :newName,
          roomNo = :roomNo,
          startTime = :startTime,
          endTime = :endTime,
          classDays = :classDays
      `,
      ExpressionAttributeValues: {
        ":newName": newClassName,
        ":roomNo": roomNo,
        ":startTime": startTime,
        ":endTime": endTime,
        ":classDays": classDays,
      },
      ConditionExpression: "attribute_exists(classCode)",
      // ✅ ensures the class exists before updating
    });

    await docClient.send(cmd);

    return {
      success: true,
      message: "Class details updated successfully.",
    };
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      return {
        success: false,
        message: "Class not found.",
      };
    }
    throw err;
  }
}

async function getClassesByTeacher(teacherId) {
  try {
    // ✅ Step 1 — fetch all classes for this teacher
    const scanCmd = new ScanCommand({
      TableName: "classes",
      FilterExpression: "createdBy = :teacherId",
      ExpressionAttributeValues: {
        ":teacherId": teacherId,
      },
    });

    const result = await docClient.send(scanCmd);
    const classes = result.Items || [];

    if (classes.length === 0) {
      return { success: true, classes: [] };
    }

    // ✅ Step 2 — for each class, query attendance table
    const classesWithStats = await Promise.all(
      classes.map(async (cls) => {
        try {
          const attendanceData = await docClient.send(new QueryCommand({
            TableName: "attendance",
            KeyConditionExpression: "classCode = :classCode",
            ExpressionAttributeValues: {
              ":classCode": cls.classCode,
            },
          }));

          const allDateRecords = attendanceData.Items || [];

          // ✅ Total classes = number of date records
          const totalClasses = allDateRecords.length;

          // ✅ Total students = from class item
          const totalStudents = cls.students?.length || 0;

          // ✅ Average attendance across all days
          let totalPercentageSum = 0;
          let validDays = 0;

          allDateRecords.forEach((record) => {
            const dailyAttendance = record.attendance || [];
            if (dailyAttendance.length === 0) return;

            const presentCount = dailyAttendance.filter(a => a.status === 1).length;
            const totalCount = dailyAttendance.length;

            totalPercentageSum += (presentCount / totalCount) * 100;
            validDays++;
          });

          const averageAttendance = validDays > 0
            ? parseFloat((totalPercentageSum / validDays).toFixed(1))
            : 0.0;

          return {
            ...cls,
            totalClasses,
            totalStudents,
            averageAttendance,
          };

        } catch (err) {
          // ✅ If attendance fetch fails for one class, don't break the whole list
          console.error(`Error fetching attendance for class ${cls.classCode}:`, err);
          return {
            ...cls,
            totalClasses: 0,
            totalStudents: cls.students?.length || 0,
            averageAttendance: 0.0,
          };
        }
      })
    );

    return {
      success: true,
      classes: classesWithStats,
    };

  } catch (err) {
    console.error(err);
    throw err;
  }
}

async function getAllInstitutions() {
  const cmd = new ScanCommand({
    TableName: "Institutions",
  });
  const res = await docClient.send(cmd);
  return res.Items || [];
}

async function updateTeacherProfile(id, updateFields) {
  const expressionParts = [];
  const expressionValues = {};
  const expressionNames = {};

  for (const [key, value] of Object.entries(updateFields)) {
    expressionParts.push(`#${key} = :${key}`);
    expressionValues[`:${key}`] = value;
    expressionNames[`#${key}`] = key;
  }

  const UpdateExpression = `SET ${expressionParts.join(", ")}`;

  const cmd = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { teacherId: id },
    UpdateExpression,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: "ALL_NEW",
  });

  const result = await docClient.send(cmd);
  return result.Attributes;
}

// Get verified teachers
async function getVerifiedTeachers(institutionId) {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "#status = :verified AND institutionId = :institutionId",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":verified": "verified",
      ":institutionId": institutionId,
    },
  });

  const res = await docClient.send(cmd);
  return res.Items || [];
}

// Get pending teachers
async function getPendingTeachers(institutionId) {
  const cmd = new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "#status = :pending AND institutionId = :institutionId",
    ExpressionAttributeNames: {
      "#status": "status",
    },
    ExpressionAttributeValues: {
      ":pending": "pending",
      ":institutionId": institutionId,
    },
  });

  const res = await docClient.send(cmd);
  return res.Items || [];
}

module.exports = {
  createTeacher,
  createClass,
  deleteClass,
  updateClassName,
  getClassesByTeacher,
  getAllInstitutions,
  updateTeacherProfile,
  getVerifiedTeachers,
  getPendingTeachers,
};
