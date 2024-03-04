import { APIGatewayProxyCallback, APIGatewayProxyEvent, Context } from "aws-lambda";

import { DynamoDBClient, QueryCommand, PutItemCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const dynamoDB = new DynamoDBClient({
    apiVersion: "2012-08-10",
});

export const handler = async (event: APIGatewayProxyEvent, context: Context, callback: APIGatewayProxyCallback) => {
    // Get the latest version of all entries in the DynamoDB
    const names_and_versions = await dynamoDB.send(new ScanCommand({
        TableName: process.env.TABLE_NAME,
        FilterExpression: '#latest = :latest',
        ExpressionAttributeNames: {
            '#latest': 'latest',
        },
        ExpressionAttributeValues: marshall({
            ':latest': 1,
        }),
    }));

    const results: any[] = [];
    names_and_versions.Items.forEach(item => {
        const unmarshalled = unmarshall(item);
        // remove the id and latest field from unmarshalled
        delete unmarshalled.id;
        delete unmarshalled.latest;
        results.push(unmarshalled);
    })


    callback(null, {
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
            items: results,
            feed: 'my-feed'
        })
    });
}

interface Pilet {
    id: string;
    name: string;
    version: string;
}

function getIdForLatestVersion(pilets: Pilet[]): { [name: string]: string } {
    const latestVersions: { [name: string]: string } = {};

    for (const pilet of pilets) {
        const { name, version, id } = pilet;
        
        if (!latestVersions[name] || compareVersions(version, latestVersions[name]) > 0) {
            latestVersions[name] = id;
        }
    }

    return latestVersions;
}

function compareVersions(v1: string, v2: string): number {
    const parseVersion = (version: string): number[] => {
        return version.split('.').map(Number);
    };

    const parts1 = parseVersion(v1);
    const parts2 = parseVersion(v2);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const part1 = parts1[i] || 0;
        const part2 = parts2[i] || 0;

        if (part1 < part2) return -1;
        if (part1 > part2) return 1;
    }

    return 0;
}
