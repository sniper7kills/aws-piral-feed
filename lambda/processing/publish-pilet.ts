import { DynamoDBClient, PutItemCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { PiletMetadata } from "../types";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";

export async function publishPilet(pilet: PiletMetadata) {

    try {
        await undefaultPreviousVersion(pilet.name)
    } catch (e) {
        console.log(e)
    }
    

    const dynamoDB = new DynamoDBClient({
        apiVersion: "2012-08-10",
    });

    await dynamoDB.send(new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
            ...pilet,
            spec: pilet.type,
            latest: 1,
            id: randomUUID()
        }, {
            convertEmptyValues: true,
            removeUndefinedValues: true,
        }),
    }));
}

export async function undefaultPreviousVersion(name: string) {

    const dynamoDB = new DynamoDBClient({
        apiVersion: "2012-08-10",
    }); 

    // Get current default version
    const currentDefaultResults = await dynamoDB.send(new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: "#name = :name and #latest = :latest",
        ExpressionAttributeValues: marshall({
            ":name": name,
            ":latest": 1
        }),
        ExpressionAttributeNames: {
            "#name": "name",
            "#latest": "latest"
        },
        ProjectionExpression: "id"
    }));

    // Undefault previous version and set latest to 0
    await dynamoDB.send(new UpdateItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({
            id: unmarshall(currentDefaultResults.Items[0]).id
        }),
        UpdateExpression: "set latest = :latest",
        ExpressionAttributeValues: marshall({
            ":latest": 0
        }),
    }));    
}