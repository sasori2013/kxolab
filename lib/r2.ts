import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const accountId = process.env.R2_ACCOUNT_ID!
const accessKeyId = process.env.R2_ACCESS_KEY_ID!
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!

export const R2_BUCKET = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET!

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
})

/**
 * R2 にファイルをPUTするヘルパー
 */
export async function r2Put(params: {
  key: string
  body: Uint8Array | Buffer
  contentType: string
}) {
  const { key, body, contentType } = params
  console.log(`[R2] Starting upload: ${key} (${body.length} bytes)`)

  try {
    const result = await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
    console.log(`[R2] Upload Success: ${key}`)

    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || ""
    const publicUrl = base ? `${base}/${key}` : null
    return { key, publicUrl }
  } catch (err) {
    console.error(`[R2] Upload FAILED: ${key}`, err)
    throw err
  }
}

export async function r2PutPng(key: string, body: Uint8Array | Buffer) {
  return r2Put({
    key,
    body,
    contentType: "image/png"
  })
}