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
        const creds = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}');

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: creds.client_email,
                private_key: creds.private_key?.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = {
            name: args.filename,
            parents: [args.folderId],
        };

        const media = {
            mimeType: args.mimeType,
            body: Readable.from(args.buffer),
        };

        console.log(`[Google Drive] Uploading ${args.filename} to folder ${args.folderId}...`);

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, webViewLink',
        });

        console.log(`[Google Drive] Upload success: ${response.data.id}`);
        return { ok: true, fileId: response.data.id, link: response.data.webViewLink };
    } catch (error: any) {
        console.error('[Google Drive Error]', error.message || error);
        return { ok: false, error: error.message };
    }
}
