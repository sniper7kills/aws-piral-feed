import * as fs from 'fs';
import * as path from 'path';
import { getPiletDefinition } from "./helpers";
import { S3Event, S3Handler } from 'aws-lambda';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import * as tar from "tar"
import Mime from 'mime'

import { saveS3FileLocally } from './processing/save-s3-locally';
import { cleanRawRequest } from './processing/clean-raw-request';
import { isPiletAlreadyPublished } from './processing/pilet-already-published';
import { publishPilet } from './processing/publish-pilet';


const s3 = new S3Client({
    apiVersion: "2006-03-01",
});
const dynamoDB = new DynamoDBClient({
    apiVersion: "2012-08-10",
});


export const handler: S3Handler = async (event: S3Event) => {
    try {
        console.log('Received S3 event:', JSON.stringify(event, null, 2));

        /**
         * Iterate though all files in this event
         */
        for (const record of event.Records) {
            const bucketName = record.s3.bucket.name;
            const objectKey = record.s3.object.key;
            console.log(`Processing file ${objectKey} in bucket ${bucketName}`);


            console.log("Downloading From S3")
            await saveS3FileLocally(bucketName, objectKey, '/tmp/request');

            console.log("Cleaning Raw Request into pilet.tgz file")
            await cleanRawRequest('/tmp/request', '/tmp/pilet.tgz')

            console.log("Getting Pilet Definition")
            const local_file_stream = fs.createReadStream('/tmp/pilet.tgz');
            const pilet = await getPiletDefinition(local_file_stream, process.env.CDN_URL);

            console.log("Checking if pilet is already published")
            const alreadyPublished = await isPiletAlreadyPublished(pilet.meta.name, pilet.meta.version)

            if (alreadyPublished) {
                console.log("Pilet Already Published");
                await s3.send(new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: objectKey
                }))
                console.log(`File ${objectKey} Deleted successfully.`);

                throw new Error('Pilet Already Published');
            }
            
            console.log("Extracting tgz and getting file list")
            // await extractTgz('/tmp/pilet.tgz', '/tmp')
            // const files = await listFilesRecursively('/tmp/package')

            console.log("Uploading Files To S3")
            // await Promise.all(files.map(async (file) => {
            //     const fileContent = fs.readFileSync(file);
            //     await s3.send(new PutObjectCommand({
            //         Bucket: bucketName,
            //         Key: pilet.meta.name + "/" + pilet.meta.version + "/" + file.slice(13),
            //         Body: fileContent,
            //         ContentType: Mime.getType(file),
            //     }));
            // }));

            const keys = Object.keys(pilet.files)
            await Promise.all(keys.map(async (file) => {
                const fileContent = pilet.files[file];
                await s3.send(new PutObjectCommand({
                    Bucket: bucketName,
                    Key: pilet.meta.name + "/" + pilet.meta.version + "/" + file,
                    Body: Buffer.from(fileContent),
                    ContentType: Mime.getType(file),
                }));
            }));

            console.log("Publishing Pilet")
            if (!alreadyPublished) {
                await publishPilet(pilet.meta);
            }

            console.log(`File ${objectKey} processed successfully.`);

            await s3.send(new DeleteObjectCommand({
                Bucket: bucketName,
                Key: objectKey
            }))

            console.log(`File ${objectKey} Deleted successfully.`);
        }
    } catch (error) {
        console.error('Error processing S3 event:', error);
    }
};



async function listFilesRecursively(directoryPath: string): Promise<string[]> {
    const files: string[] = [];

    async function traverseDirectory(currentPath: string): Promise<void> {
        const items = await fs.promises.readdir(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            const stats = await fs.promises.stat(itemPath);

            if (stats.isDirectory()) {
                await traverseDirectory(itemPath); // Recursively traverse directories
            } else {
                files.push(itemPath); // Add file path to the list
            }
        }
    }

    await traverseDirectory(directoryPath);
    return files;
}

export async function extractTgz(tgzFilePath: string, extractTo: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        fs.createReadStream(tgzFilePath)
            .pipe(tar.x({ cwd: extractTo }))
            .on('error', err => {
                reject(err);
            })
            .on('end', () => {
                resolve();
            });
    });
}