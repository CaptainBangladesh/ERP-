import {
  AUTH_PATHS,
  MARKETING_ERROR_CODES,
  MARKETING_PATHS,
  type AuthenticatedSession,
  type BrandDetailResponse,
  type BrandListResponse,
  type BrandSummary,
  type ExpiringAccountsResponse,
  type OAuthAuthorizeResponse,
  type RefreshTokenResponse,
  type SignUpRequest,
  type SocialAccountListResponse,
  type SocialAccountResponse,
} from '@erp/shared';
import { CryptoService } from '../src/modules/marketing/crypto.service';
import { SocialAccountsService } from '../src/modules/marketing/social-accounts.service';
import { StubSocialOAuth } from '../src/modules/marketing/social-oauth';
import { createTestApp, resetDatabase, type TestApp } from './harness/test-app';

describe('Marketing: Brand & Encrypted OAuth Vault', () => {
  let app: TestApp;

  type SupertestRequest = ReturnType<TestApp['http']['get']>;

  interface Tenant {
    session: AuthenticatedSession;
    as: (request: SupertestRequest) => SupertestRequest;
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  async function signUp(overrides: Partial<SignUpRequest> = {}): Promise<Tenant> {
    const response = await app.http
      .post(AUTH_PATHS.signUp)
      .send({
        companyName: 'Acme Agency',
        name: 'Jane Doe',
        email: 'jane@acme.test',
        password: 'correct-horse-battery',
        ...overrides,
      })
      .expect(201);

    const session = response.body as AuthenticatedSession;
    return { session, as: (request) => request.set('Authorization', `Bearer ${session.token}`) };
  }

  describe('CryptoService unit tests', () => {
    it('encrypts and decrypts with AES-256-GCM authentication', () => {
      const crypto = new CryptoService();
      const secret = 'test-oauth-access-token-123456789';

      const encrypted = crypto.encrypt(secret);
      expect(encrypted).not.toBe(secret);
      expect(encrypted.split('.').length).toBe(4); // kid.iv.ciphertext.tag
      expect(encrypted.startsWith('v1.')).toBe(true);

      const decrypted = crypto.decrypt(encrypted);
      expect(decrypted).toBe(secret);
    });

    it('produces different ciphertexts for identical plaintext due to random IVs', () => {
      const crypto = new CryptoService();
      const secret = 'same-token';

      const enc1 = crypto.encrypt(secret);
      const enc2 = crypto.encrypt(secret);
      expect(enc1).not.toBe(enc2);
      expect(crypto.decrypt(enc1)).toBe(secret);
      expect(crypto.decrypt(enc2)).toBe(secret);
    });

    it('detects tampering and throws when ciphertext or auth tag is modified', () => {
      const crypto = new CryptoService();
      const encrypted = crypto.encrypt('sensitive-data');
      const [kid, iv, ciphertext, tag] = encrypted.split('.') as [string, string, string, string];

      // Tamper ciphertext
      const tamperedCiphertext = Buffer.from(ciphertext, 'base64url');
      tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
      const tampered = [kid, iv, tamperedCiphertext.toString('base64url'), tag].join('.');

      expect(() => crypto.decrypt(tampered)).toThrow();
    });

    it('still reads a token encrypted under v1 after v2 becomes the active key', () => {
      const before = { ...process.env };
      try {
        process.env.MARKETING_VAULT_SECRET = 'first-vault-secret-long-enough-to-pass-0001';
        process.env.MARKETING_VAULT_KEY_ID = 'v1';
        delete process.env.MARKETING_VAULT_RETIRED_KEYS;

        const v1 = new CryptoService();
        v1.forgetKey();
        const underV1 = v1.encrypt('token-written-before-the-rotation');
        expect(underV1.startsWith('v1.')).toBe(true);

        // Rotate: new active secret, old one retired but still readable.
        process.env.MARKETING_VAULT_SECRET = 'second-vault-secret-long-enough-to-pass-002';
        process.env.MARKETING_VAULT_KEY_ID = 'v2';
        process.env.MARKETING_VAULT_RETIRED_KEYS =
          'v1:first-vault-secret-long-enough-to-pass-0001';

        const v2 = new CryptoService();
        v2.forgetKey();
        expect(v2.encrypt('anything').startsWith('v2.')).toBe(true);
        expect(v2.decrypt(underV1)).toBe('token-written-before-the-rotation');
      } finally {
        process.env = before;
        new CryptoService().forgetKey();
      }
    });

    it('reads pre-rotation three-part ciphertext as v1', () => {
      const before = { ...process.env };
      try {
        process.env.MARKETING_VAULT_SECRET = 'legacy-vault-secret-long-enough-to-pass-01';
        process.env.MARKETING_VAULT_KEY_ID = 'v1';
        delete process.env.MARKETING_VAULT_RETIRED_KEYS;

        const crypto = new CryptoService();
        crypto.forgetKey();
        const [, ...legacyParts] = crypto.encrypt('older-than-the-key-id').split('.');

        expect(crypto.decrypt(legacyParts.join('.'))).toBe('older-than-the-key-id');
      } finally {
        process.env = before;
        new CryptoService().forgetKey();
      }
    });

    it('names a lost key differently from a modified row', () => {
      const before = { ...process.env };
      try {
        process.env.MARKETING_VAULT_SECRET = 'active-vault-secret-long-enough-to-pass-01';
        process.env.MARKETING_VAULT_KEY_ID = 'v9';
        delete process.env.MARKETING_VAULT_RETIRED_KEYS;

        const crypto = new CryptoService();
        crypto.forgetKey();
        const stored = crypto.encrypt('a token');
        const fromAKeyWeNoLongerHold = stored.replace(/^v9\./, 'v3.');

        // Conflating "we lost the key" with "someone edited this row" makes an operational
        // incident look like an attack, so the two carry different codes.
        expect(() => crypto.decrypt(fromAKeyWeNoLongerHold)).toThrow(
          expect.objectContaining({ code: MARKETING_ERROR_CODES.vaultKeyUnknown }),
        );
      } finally {
        process.env = before;
        new CryptoService().forgetKey();
      }
    });

    it('refuses to boot in production without a vault secret', () => {
      const before = { ...process.env };
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.MARKETING_VAULT_SECRET;
        delete process.env.MARKETING_OAUTH_STATE_SECRET;
        delete process.env.MARKETING_ANALYTICS_PEPPER;

        expect(() => new CryptoService().onModuleInit()).toThrow(/MARKETING_VAULT_SECRET/);
      } finally {
        process.env = before;
        new CryptoService().forgetKey();
      }
    });

    it('accepts a production boot once all three secrets are long enough', () => {
      const before = { ...process.env };
      try {
        process.env.NODE_ENV = 'production';
        process.env.MARKETING_VAULT_SECRET = 'a'.repeat(40);
        process.env.MARKETING_OAUTH_STATE_SECRET = 'b'.repeat(40);
        process.env.MARKETING_ANALYTICS_PEPPER = 'c'.repeat(40);

        expect(() => new CryptoService().onModuleInit()).not.toThrow();
      } finally {
        process.env = before;
        new CryptoService().forgetKey();
      }
    });

    it('safely masks tokens for public responses', () => {
      const crypto = new CryptoService();
      expect(crypto.maskToken('gho_1234567890abcdef')).toBe('••••••••cdef');
      expect(crypto.maskToken('abc')).toBe('••••••••abc');
      expect(crypto.maskToken('')).toBe('••••••••');
    });
  });

  describe('Brand multi-tenancy and management', () => {
    it('creates a Brand profile and automatically assigns creator as lead member', async () => {
      const tenant = await signUp();

      const response = await tenant
        .as(app.http.post(MARKETING_PATHS.brands))
        .send({
          name: 'Nike Running',
          timezone: 'America/New_York',
          brandColors: { primary: '#FF5733', secondary: '#000000' },
          storageQuotaMb: 2000,
        })
        .expect(201);

      const brand = response.body as BrandSummary;
      expect(brand.name).toBe('Nike Running');
      expect(brand.slug).toBe('nike-running');
      expect(brand.timezone).toBe('America/New_York');
      expect(brand.brandColors?.primary).toBe('#FF5733');
      expect(brand.storageQuotaMb).toBe(2000);

      // Verify creator was assigned as lead
      const detailRes = await tenant.as(app.http.get(MARKETING_PATHS.brand(brand.id))).expect(200);
      const detail = detailRes.body as BrandDetailResponse;
      expect(detail.members.length).toBe(1);
      expect(detail.members[0]?.userId).toBe(tenant.session.user.id);
      expect(detail.members[0]?.role).toBe('lead');
    });

    it('refuses duplicate slug within the same company', async () => {
      const tenant = await signUp();

      await tenant
        .as(app.http.post(MARKETING_PATHS.brands))
        .send({ name: 'Acme Corp', slug: 'acme-brand' })
        .expect(201);

      const dup = await tenant
        .as(app.http.post(MARKETING_PATHS.brands))
        .send({ name: 'Acme Other', slug: 'acme-brand' })
        .expect(409);

      expect(dup.body.code).toBe(MARKETING_ERROR_CODES.brandSlugTaken);
    });

    it('enforces multi-tenancy: Company A cannot see or manage Company B brands', async () => {
      const companyA = await signUp({ companyName: 'Company A', email: 'a@agency.test' });
      const companyB = await signUp({ companyName: 'Company B', email: 'b@agency.test' });

      const brandARes = await companyA
        .as(app.http.post(MARKETING_PATHS.brands))
        .send({ name: 'Brand A' })
        .expect(201);
      const brandA = brandARes.body as BrandSummary;

      // Company B lists brands: Brand A should not be visible
      const listB = await companyB.as(app.http.get(MARKETING_PATHS.brands)).expect(200);
      expect((listB.body as BrandListResponse).items.map((i) => i.id)).not.toContain(brandA.id);

      // Company B cannot read Brand A by id
      await companyB.as(app.http.get(MARKETING_PATHS.brand(brandA.id))).expect(404);

      // Company B cannot update or delete Brand A
      await companyB
        .as(app.http.patch(MARKETING_PATHS.brand(brandA.id)))
        .send({ name: 'Hacked' })
        .expect(404);
      await companyB.as(app.http.delete(MARKETING_PATHS.brand(brandA.id))).expect(404);
    });

    it('updates brand settings and manages members', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant.as(app.http.post(MARKETING_PATHS.brands)).send({ name: 'Adidas' }).expect(201)
      ).body as BrandSummary;

      const updated = (
        await tenant
          .as(app.http.patch(MARKETING_PATHS.brand(brand.id)))
          .send({ timezone: 'Europe/Berlin', customDomain: 'social.adidas.test' })
          .expect(200)
      ).body as BrandSummary;

      expect(updated.timezone).toBe('Europe/Berlin');
      expect(updated.customDomain).toBe('social.adidas.test');

      // Add new member
      const otherUser = await tenant.session.user.id; // use valid id
      const member = await tenant
        .as(app.http.post(MARKETING_PATHS.brandMembers(brand.id)))
        .send({ userId: '00000000-0000-0000-0000-000000000001', role: 'editor' })
        .expect(201);

      expect(member.body.role).toBe('editor');

      // List members
      const members = await tenant
        .as(app.http.get(MARKETING_PATHS.brandMembers(brand.id)))
        .expect(200);
      expect(members.body.length).toBe(2);

      // Remove member
      await tenant
        .as(
          app.http.delete(
            MARKETING_PATHS.brandMember(brand.id, '00000000-0000-0000-0000-000000000001'),
          ),
        )
        .expect(204);
    });
  });

  describe('Social Accounts & Encrypted OAuth Vault', () => {
    it('initiates OAuth redirect flow with signed tamper-proof state', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Puma Global' })
          .expect(201)
      ).body as BrandSummary;

      const authRes = await tenant
        .as(app.http.post(MARKETING_PATHS.authorizeOAuth(brand.id)))
        .send({
          platform: 'instagram',
          redirectUri: 'https://erp.test/callback',
        })
        .expect(200);

      const { authorizationUrl, state } = authRes.body as OAuthAuthorizeResponse;
      expect(authorizationUrl).toContain('instagram');
      expect(authorizationUrl).toContain(encodeURIComponent(state));
      expect(state.length).toBeGreaterThan(20);
    });

    it('exchanges code, encrypts tokens at rest, and provides masked safe API responses', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Tesla Motors' })
          .expect(201)
      ).body as BrandSummary;

      // Initiate OAuth to get valid signed state
      const { state } = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.authorizeOAuth(brand.id)))
          .send({
            platform: 'linkedin',
            redirectUri: 'https://erp.test/callback',
          })
          .expect(200)
      ).body as OAuthAuthorizeResponse;

      // Exchange callback
      const exchangeRes = await tenant
        .as(app.http.post(MARKETING_PATHS.oauthCallback))
        .send({
          code: 'valid_auth_code_123',
          state,
          redirectUri: 'https://erp.test/callback',
        })
        .expect(200);

      const account = exchangeRes.body as SocialAccountResponse;
      expect(account.platform).toBe('linkedin');
      expect(account.accountName).toContain('LINKEDIN');
      expect(account.status).toBe('active');
      expect(account.hasRefreshToken).toBe(true);

      // CRITICAL: Safe API response never leaks plaintext access token or refresh token!
      expect(account.maskedAccessToken).toBe('••••••••_123');
      expect((account as unknown as Record<string, unknown>).accessToken).toBeUndefined();
      expect((account as unknown as Record<string, unknown>).encryptedAccessToken).toBeUndefined();
      expect((account as unknown as Record<string, unknown>).encryptedRefreshToken).toBeUndefined();

      // VERIFY AT REST IN DATABASE: Tokens are genuinely encrypted with AES-256-GCM ciphertexts
      const rawDbRow = await app.prisma.socialAccount.findUnique({
        where: { id: account.id },
      });
      expect(rawDbRow).not.toBeNull();
      expect(rawDbRow?.encryptedAccessToken).not.toContain('valid_auth_code_123');
      expect(rawDbRow?.encryptedAccessToken).not.toContain('stub_access');
      expect(rawDbRow?.encryptedAccessToken.split('.').length).toBe(4); // kid.iv.ciphertext.tag
      expect(rawDbRow?.encryptedRefreshToken?.split('.').length).toBe(4);

      // In-memory internal decryption check (for publishers). Reaching a company-owned table
      // from a test means saying which company, the same as any job or script would.
      const socialAccountsService = app.nest.get(SocialAccountsService);
      const decrypted = await app.tenancy.runInCompany(
        { companyId: tenant.session.company.id, grants: 'all' },
        () => socialAccountsService.getDecryptedTokens(account.id),
      );
      expect(decrypted.accessToken).toBe('stub_access_linkedin_valid_auth_code_123');
      expect(decrypted.refreshToken).toBe('stub_refresh_linkedin_valid_auth_code_123');
    });

    it('connects a social account directly (for sandbox/manual token connect)', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Apple Inc' })
          .expect(201)
      ).body as BrandSummary;

      const connectRes = await tenant
        .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
        .send({
          platform: 'x',
          accountName: '@apple',
          platformAccountId: 'x_12345678',
          accessToken: 'super_secret_x_access_token_xyz999',
          refreshToken: 'super_secret_x_refresh_token_xyz999',
          expiresIn: 3600 * 24 * 30, // 30 days
          metadata: { handle: '@apple', verified: true },
        })
        .expect(201);

      const account = connectRes.body as SocialAccountResponse;
      expect(account.platform).toBe('x');
      expect(account.accountName).toBe('@apple');
      expect(account.maskedAccessToken).toBe('••••••••z999');
      expect(account.daysUntilExpiration).toBeGreaterThanOrEqual(29);
      expect(account.isTokenExpired).toBe(false);

      // List accounts for brand
      const listRes = await tenant
        .as(app.http.get(MARKETING_PATHS.brandSocialAccounts(brand.id)))
        .expect(200);
      const list = listRes.body as SocialAccountListResponse;
      expect(list.items.length).toBe(1);
      expect(list.items[0]?.maskedAccessToken).toBe('••••••••z999');
    });

    it('monitors 7-day token expiration and updates status to expiring/expired', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Spotify' })
          .expect(201)
      ).body as BrandSummary;

      // Account 1: expiring in 3 days (< 7 days)
      const expiringSoonRes = await tenant
        .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
        .send({
          platform: 'facebook',
          accountName: 'Spotify FB Page',
          platformAccountId: 'fb_1',
          accessToken: 'fb_token_123',
          expiresIn: 3 * 24 * 3600, // 3 days
        })
        .expect(201);
      const expiringAccount = expiringSoonRes.body as SocialAccountResponse;

      // Account 2: expiring in 30 days (> 7 days)
      await tenant
        .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
        .send({
          platform: 'youtube',
          accountName: 'Spotify YT',
          platformAccountId: 'yt_1',
          accessToken: 'yt_token_123',
          expiresIn: 30 * 24 * 3600, // 30 days
        })
        .expect(201);

      // Check expiring tokens endpoint
      const expiringRes = await tenant
        .as(app.http.get(MARKETING_PATHS.expiringAccounts(brand.id)))
        .expect(200);
      const expiringData = expiringRes.body as ExpiringAccountsResponse;
      expect(expiringData.thresholdDays).toBe(7);
      expect(expiringData.accounts.map((a) => a.id)).toContain(expiringAccount.id);

      // Verify status updated to 'expiring'
      const updatedAcc = (
        await tenant.as(app.http.get(MARKETING_PATHS.socialAccount(expiringAccount.id))).expect(200)
      ).body as SocialAccountResponse;
      expect(updatedAcc.status).toBe('expiring');
    });

    it('refreshes token using encrypted refresh token and updates database', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Netflix' })
          .expect(201)
      ).body as BrandSummary;

      const connectRes = await tenant
        .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
        .send({
          platform: 'tiktok',
          accountName: '@netflix',
          platformAccountId: 'tiktok_netflix_1',
          accessToken: 'old_tiktok_access_token_1111',
          refreshToken: 'old_tiktok_refresh_token_2222',
          expiresIn: 3600, // 1 hour
        })
        .expect(201);

      const account = connectRes.body as SocialAccountResponse;

      // Call refresh
      const refreshRes = await tenant
        .as(app.http.post(MARKETING_PATHS.refreshAccount(account.id)))
        .expect(200);

      const refreshData = refreshRes.body as RefreshTokenResponse;
      expect(refreshData.refreshed).toBe(true);
      expect(refreshData.account.status).toBe('active');
      expect(refreshData.account.daysUntilExpiration).toBeGreaterThan(80); // stub returns 90 days

      // Internal check that decrypted token changed
      const socialAccountsService = app.nest.get(SocialAccountsService);
      const decrypted = await app.tenancy.runInCompany(
        { companyId: tenant.session.company.id, grants: 'all' },
        () => socialAccountsService.getDecryptedTokens(account.id),
      );
      expect(decrypted.accessToken).toContain('refreshed_access');
    });

    it('disconnects an account', async () => {
      const tenant = await signUp();
      const brand = (
        await tenant.as(app.http.post(MARKETING_PATHS.brands)).send({ name: 'Hulu' }).expect(201)
      ).body as BrandSummary;

      const account = (
        await tenant
          .as(app.http.post(MARKETING_PATHS.connectAccount(brand.id)))
          .send({
            platform: 'pinterest',
            accountName: 'Hulu Pins',
            platformAccountId: 'pins_1',
            accessToken: 'token_pins_1234',
          })
          .expect(201)
      ).body as SocialAccountResponse;

      await tenant.as(app.http.delete(MARKETING_PATHS.socialAccount(account.id))).expect(204);

      const fetched = (
        await tenant.as(app.http.get(MARKETING_PATHS.socialAccount(account.id))).expect(200)
      ).body as SocialAccountResponse;
      expect(fetched.status).toBe('disconnected');
    });

    it('prevents cross-tenant access to social accounts', async () => {
      const companyA = await signUp({ companyName: 'Company A', email: 'owner_a@test.local' });
      const companyB = await signUp({ companyName: 'Company B', email: 'owner_b@test.local' });

      const brandA = (
        await companyA
          .as(app.http.post(MARKETING_PATHS.brands))
          .send({ name: 'Brand A' })
          .expect(201)
      ).body as BrandSummary;

      const accountA = (
        await companyA
          .as(app.http.post(MARKETING_PATHS.connectAccount(brandA.id)))
          .send({
            platform: 'threads',
            accountName: 'Threads A',
            platformAccountId: 'th_1',
            accessToken: 'secret_token_123',
          })
          .expect(201)
      ).body as SocialAccountResponse;

      // Company B cannot see or refresh Company A's account
      await companyB.as(app.http.get(MARKETING_PATHS.socialAccount(accountA.id))).expect(404);
      await companyB.as(app.http.post(MARKETING_PATHS.refreshAccount(accountA.id))).expect(404);
      await companyB.as(app.http.delete(MARKETING_PATHS.socialAccount(accountA.id))).expect(404);
    });
  });
});
