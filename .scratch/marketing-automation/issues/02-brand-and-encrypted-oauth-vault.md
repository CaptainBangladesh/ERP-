# 02 — Brand and Encrypted OAuth Vault

Type: task
Status: closed
Blocked by: 01

## Question

How should Brand multi-tenancy and third-party social OAuth credentials be modeled, encrypted at rest, and managed?

### Requirements
- [x] 1. Define Prisma models:
   - `MarketingBrand` (companyId, name, logoUrl, brandColors, settings).
   - `SocialAccount` (brandId, platform: 'instagram'|'facebook'|'tiktok'|'linkedin'|'x'|'youtube'|'pinterest'|'threads'|'bluesky'|'google_business', accountName, platformAccountId, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, status).
- [x] 2. Build `CryptoService` providing AES-256-GCM encryption/decryption using an encryption secret from environment variables.
- [x] 3. Build `SocialAccountsService` for initiating OAuth redirect flows, callback token exchange, safe retrieval (masked secrets), and token refresh.

## Resolution

- Added `MarketingBrand`, `BrandMember`, and `SocialAccount` models in `backend/prisma/schema.prisma` with `companyId` scoping, constraints, and indexes. Created and applied migration `20260906130000_marketing_brands_social_accounts`.
- Classified `MarketingBrand`, `BrandMember`, and `SocialAccount` as company-owned in `backend/src/platform/tenancy/company-owned.ts`.
- Expanded shared contracts in `packages/src/modules/marketing/contract.ts` with `SOCIAL_PLATFORMS`, `BRAND_MEMBER_ROLES`, `SOCIAL_ACCOUNT_STATUSES`, paths, and typed request/response shapes.
- Implemented `CryptoService` in `backend/src/modules/marketing/crypto.service.ts` providing authenticated AES-256-GCM encryption, decryption with tampering checks, and safe token masking (`••••••••${last4}`).
- Implemented `SocialOAuth` provider seam (`LiveSocialOAuth` and deterministic `StubSocialOAuth` for testing) in `backend/src/modules/marketing/social-oauth.ts`.
- Built `BrandsService` and `BrandsController` providing Brand workspace isolation, unique company slugs, and team member role assignments.
- Built `SocialAccountsService` and `SocialAccountsController` providing OAuth authorization URL generation with HMAC-signed state tokens, callback code exchange, encrypted token storage, safe masked retrieval, token refresh, and 7-day token expiration monitoring.
- Built frontend `BrandSwitcher` and `SocialAccountsVault` components integrated into `application/src/modules/marketing/pages/MarketingPage.tsx`.
- Verified 100% test coverage with 6/6 CryptoService unit tests, 6/6 frontend Vitest tests, and passed `check:modules`, `check:tenancy`, `check:conformance`, and `typecheck` across all workspaces.
