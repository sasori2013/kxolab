import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Force cache bust: 2026-01-21
  env: {
    // Inject dummy credentials during build if missing, to satisfy ghost GoogleAuth instances
    GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || `{"type":"service_account","project_id":"dummy","private_key_id":"dummy","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7\\n-----END PRIVATE KEY-----\\n","client_email":"dummy@example.com","client_id":"123","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/dummy%40example.com"}`,
  },
};

export default nextConfig;
