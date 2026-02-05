import { google } from 'googleapis';
import { Readable } from 'stream';

/**
 * Upload an image from a buffer to a Google Drive folder.
 */
export async function uploadToGoogleDrive(args: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    folderId: string;
}) {
    try {
        const client_id = process.env.GOOGLE_DRIVE_CLIENT_ID;
        const client_secret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
        const refresh_token = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;

        if (!client_id || !client_secret || !refresh_token) {
            throw new Error("Missing Google Drive OAuth2 credentials in env");
        }

        const auth = new google.auth.OAuth2(client_id, client_secret);
        auth.setCredentials({ refresh_token });

        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = {
            name: args.filename,
            parents: [args.folderId],
        };

        const media = {
            mimeType: args.mimeType,
            body: Readable.from(args.buffer),
        };

        console.log(`[Google Drive] Uploading ${args.filename} to folder ${args.folderId} as user...`);

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
            supportsAllDrives: true,
        });

        console.log(`[Google Drive] Upload success: ${response.data.id}`);
        return { ok: true, fileId: response.data.id, link: response.data.webViewLink };
    } catch (error: any) {
        console.error('[Google Drive Error]', error.message || error);
        return { ok: false, error: error.message };
    }
}
