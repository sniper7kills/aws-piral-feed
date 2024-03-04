import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

export async function isPiletAlreadyPublished(name: string, version: string): Promise<boolean> {
    const dynamoDB = new DynamoDBClient({
        apiVersion: "2012-08-10",
    });
    const results = await dynamoDB.send(new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: '#name = :name AND #version = :version',
        ExpressionAttributeNames: {
            '#name': 'name',
            '#version': 'version'
        },
        ExpressionAttributeValues: {
            ':name': { S: name },
            ':version': { S: version }
        }
    }));
    if (results.Count > 0) {
        return true;
    }
    return false
}