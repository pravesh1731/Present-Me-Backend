const { PutCommand,UpdateCommand ,ScanCommand, GetCommand} = require("@aws-sdk/lib-dynamodb");
const { findByEmail, findById } = require("./awsService");
const {v4:uuidv4}= require('uuid');
const bcrypt = require("bcrypt");
const{docClient}= require('../dynamoDb');
const { QueryCommand } = require("@aws-sdk/lib-dynamodb");


const SALT_ROUNDS=10;
const TABLE_NAME="students";
const CLASS_TABLE="classes";

async function getTeacherById(teacherId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: "teachers",
      Key: { teacherId },
      ProjectionExpression: "teacherId, firstName, lastName",
    })
  );

  return result.Item;
}


async function createStudent({firstName,lastName,emailId,phone,institutionId,password,rollNo}){
  //lowercase email to ensure uniqueness
  const normalizedEmail=emailId.toLowerCase();
  //1) check duplicate
  const  existing =await findByEmail(normalizedEmail , "students");
  if(existing){
    const err = new Error("Email already exists");
    err.code="DUPLICATE_EMAIL";
    throw err;
  }

  //hash password
  const passwordHash = await bcrypt.hash(password,SALT_ROUNDS);

  //Get institution info (for name reference)
  const institution = await findById(institutionId, "Institutions", "institutionId");
  
  if (!institution) {
    throw new Error("Invalid institutionId — no such institution found.");
  }

  //3) build item
  const item={
    studentId:"s-"+uuidv4(),
    firstName,
    lastName,
    emailId:normalizedEmail,
    phone,
    passwordHash,
    rollNo,  
    institutionId,            
    type: "student",
    createdAt: new Date().toISOString()
  };

  //4)put item
  const putCmd = new PutCommand({
    TableName:TABLE_NAME,
    Item:item,
    ConditionExpression:"attribute_not_exists(studentId)" //to avoid overwriting existing item
  });
  await docClient.send(putCmd);
  //5)return item(without passwordHash)
  const {passwordHash:_,...itemWithoutPasswordHash}=item;
  return itemWithoutPasswordHash;
}


async function addJoinRequest(classCode,studentId){
  const updateCmd= new UpdateCommand({
    TableName:CLASS_TABLE,
    Key:{ classCode },
    UpdateExpression: "SET joinRequests = list_append(if_not_exists(joinRequests, :empty_list), :studentId)",
    ExpressionAttributeValues:{
      ":studentId":[studentId],
      ":empty_list":[],
    },
    ReturnValues:"UPDATED_NEW",
  });
  try{
    await docClient.send(updateCmd);
  }catch(err){
    throw new Error("Failed to add join request: " + err.message);  
  }
  }

async function getStudentJoinRequests(studentId){
  try{ 
    const scanParams={
      TableName:"classes",
      ProjectionExpression:"classCode,className,createdBy,roomNo,joinRequests",
    };

    const result= await docClient.send(new ScanCommand(scanParams));

    // 1️⃣ Filter enrolled classes
    const enrolledClasses = result.Items.filter(
      (cls) => Array.isArray(cls.joinRequests) && cls.joinRequests.includes(studentId)
    );

    // Attach teacher name
    const requestedClasses = await Promise.all(
      enrolledClasses.map(async (cls) => {
        const teacher = await getTeacherById(cls.createdBy);

        return {
          classCode: cls.classCode,
          className: cls.className,
          roomNo: cls.roomNo,
          teacherId: cls.createdBy,
          teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : "Unknown",
        };
      })
    );

    return requestedClasses;

  }catch(err){
    throw new Error("Failed to get join requests: " + err.message);
  }
}

async function getStudentEnrollClasses(studentId) {
  try {
    // Step 1: Scan all classes and filter enrolled ones
    const scanParams = {
      TableName: "classes",
      ProjectionExpression: "classCode, className, createdBy, roomNo, classDays, startTime, endTime, students, isActive",
    };
    const result = await docClient.send(new ScanCommand(scanParams));

    const enrolledClasses = result.Items.filter(
      (cls) => Array.isArray(cls.students) && cls.students.includes(studentId)
    );

    const requestedClasses = await Promise.all(
      enrolledClasses.map(async (cls) => {

        // Step 2: Fetch teacher info
        const teacher = await getTeacherById(cls.createdBy);

        // Step 3: Fetch all attendance records for this classCode
        const attendanceData = await docClient.send(new QueryCommand({
          TableName: "attendance",
          KeyConditionExpression: "classCode = :c",
          ExpressionAttributeValues: {
            ":c": cls.classCode
          }
        }));

        const records = attendanceData.Items || [];

        // Step 4: Build per-date attendance list + count totals
        let totalClasses = 0;
        let present = 0;
        const attendanceList = [];

        for (const record of records) {
          const studentRecord = (record.attendance || []).find(
            (s) => s.studentId === studentId
          );

          if (studentRecord) {
            totalClasses += 1;
            if (studentRecord.status === 1) present += 1;

            attendanceList.push({
              date: record.date,
              status: studentRecord.status, // 1 = present, 0 = absent
            });
          }
        }

        const absent = totalClasses - present;
        const percentage = totalClasses > 0
          ? parseFloat(((present / totalClasses) * 100).toFixed(1))
          : 0.0;

        return {
          classCode: cls.classCode,
          className: cls.className,
          classDays: cls.classDays,
          startTime: cls.startTime,
          endTime: cls.endTime,
          roomNo: cls.roomNo,
          teacherId: cls.createdBy,
          teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : "Unknown",
          isActive: cls.isActive ?? true,
          attendanceSummary: {
            totalClasses,
            present,
            absent,
            percentage,
          },
          attendanceRecords: attendanceList, // per-day breakdown
        };
      })
    );

    return requestedClasses;
  } catch (err) {
    throw new Error("Failed to get enrolled classes: " + err.message);
  }
}

async function updateStudentProfile(id, updateFields) {
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
    Key: { studentId: id },
    UpdateExpression,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: "ALL_NEW",
  });

  const result = await docClient.send(cmd);
  return result.Attributes;
}


module.exports={createStudent,addJoinRequest,getStudentJoinRequests, updateStudentProfile,getStudentEnrollClasses};