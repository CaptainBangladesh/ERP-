# 02 — Brand and Encrypted OAuth Vault

Type: task
Status: open
Blocked by: 01

## Question

How should Brand multi-tenancy and third-party social OAuth credentials be modeled, encrypted at rest, and managed?

### Requirements
1. Define Prisma models:
   - `MarketingBrand` (companyId, name, logoUrl, brandColors, settings).
   - `SocialAccount` (brandId, platform: 'instagram'|'facebook'|'tiktok'|'linkedin'|'x'|'youtube'|'pinterest'|'threads'|'bluesky'|'google_business', accountName, platformAccountId, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, status).
2. Build `CryptoService` providing AES-256-GCM encryption/decryption using an encryption secret from environment variables.
3. Build `SocialAccountsService` for initiating OAuth redirect flows, callback token exchange, safe retrieval (masked secrets), and token refresh.
