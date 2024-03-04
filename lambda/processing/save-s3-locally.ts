import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3/";

import { createWriteStream } from "fs"

export async function saveS3FileLocally(bucket: string, key: string, path: string) {
    const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key
    });
    const s3 = new S3Client({
        apiVersion: "2006-03-01",
    });
    const response = await s3.send(getObjectCommand);

    const byteArray = await response.Body.transformToByteArray();
    
    await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(path)

        stream.on('error', (error) => {
            reject(error);
        });
        stream.on('finish', () => {
            resolve();
        });
        
        stream.end(Buffer.from(byteArray));
    })


}