import { createWriteStream, readFileSync, writeFileSync } from "fs";
import { parse } from "parse-multipart-data";

export async function cleanRawRequest(input: string, output: string) {
    // Read the `multipart/form-data` request body
    const boundry = readFileSync(input, 'utf-8')
        // Get the first line
        .split('\n')[0]
        // Remove the `--` prefix
        .slice(2)
        // Remove the `\r` suffix
        .trimEnd();

    const parts = parse(readFileSync(input), boundry);
    if (parts.length > 1) {
        throw new Error('More parts recieved than expected.');
    }
    const data = parts[0].data;

    await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(output)

        stream.on('error', (error) => {
            reject(error);
        });
        stream.on('finish', () => {
            resolve();
        });
        
        stream.end(Buffer.from(data));
        resolve();
    })
}