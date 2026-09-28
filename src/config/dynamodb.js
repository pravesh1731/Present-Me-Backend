const {DynamoDBClient} = require("@aws-sdk/client-dynamodb");
const {DynamoDBDocumentClient} = require("@aws-sdk/lib-dynamodb");
require('dotenv').config();

const dbClient = new DynamoDBClient({
    region:process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const marshallOptions = {
  convertEmptyValues: false, // Whether to automatically convert empty strings, blobs, and sets to null
  removeUndefinedValues: true, // Remove undefined values from JS objects
  convertClassInstanceToMap: true, // Convert class instances to maps
};

const unmarshallOptions = {
  wrapNumbers: false, // Return numbers as native JS numbers
};

const translateConfig = { marshallOptions, unmarshallOptions };

// Create the DocumentClient wrapper
const docClient = DynamoDBDocumentClient.from(dbClient, translateConfig);

module.exports = { docClient ,dbClient};
