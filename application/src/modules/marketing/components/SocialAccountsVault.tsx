import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  SOCIAL_PLATFORMS,
  type BrandSummary,
  type ConnectSocialAccountRequest,
  type ExpiringAccountsResponse,
  type RefreshTokenResponse,
  type SocialAccountListResponse,
  type SocialAccountResponse,
  type SocialAccountSummary,
  type SocialPlatform,
} from '@erp/shared';
import { Button, Field, FormError, Modal } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';

interface SocialAccountsVaultProps {
  brand: BrandSummary;
}

const PLATFORM_CONFIG: Record<
  SocialPlatform,
  { label: string; icon: string; bgColor: string; textColor: string }
> = {
  instagram: {
    label: 'Instagram',
    icon: '📸',
    bgColor: 'bg-pink-50 border-pink-200',
    textColor: 'text-pink-700',
  },
  facebook: {
    label: 'Facebook',
    icon: '👥',
    bgColor: 'bg-blue-50 border-blue-200',
    textColor: 'text-blue-700',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: '💼',
    bgColor: 'bg-sky-50 border-sky-200',
    textColor: 'text-sky-700',
  },
  tiktok: {
    label: 'TikTok',
    icon: '🎵',
    bgColor: 'bg-slate-50 border-slate-300',
    textColor: 'text-slate-900',
  },
  x: {
    label: 'X (Twitter)',
    icon: '𝕏',
    bgColor: 'bg-zinc-50 border-zinc-200',
    textColor: 'text-zinc-900',
  },
  youtube: {
    label: 'YouTube',
    icon: '▶️',
    bgColor: 'bg-red-50 border-red-200',
    textColor: 'text-red-700',
  },
  google_business: {
    label: 'Google Business',
    icon: '📍',
    bgColor: 'bg-amber-50 border-amber-200',
    textColor: 'text-amber-700',
  },
  pinterest: {
    label: 'Pinterest',
    icon: '📌',
    bgColor: 'bg-rose-50 border-rose-200',
    textColor: 'text-rose-700',
  },
  threads: {
    label: 'Threads',
    icon: '🧵',
    bgColor: 'bg-purple-50 border-purple-200',
    textColor: 'text-purple-700',
  },
  bluesky: {
    label: 'Bluesky',
    icon: '🦋',
    bgColor: 'bg-cyan-50 border-cyan-200',
    textColor: 'text-cyan-700',
  },
};

export function SocialAccountsVault({ brand }: SocialAccountsVaultProps) {
  const queryClient = useQueryClient();
  const [connectModalPlatform, setConnectModalPlatform] = useState<SocialPlatform | null>(null);
  const [accountName, setAccountName] = useState('');
  const [platformAccountId, setPlatformAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [expiresDays, setExpiresDays] = useState(60);
  const [error, setError] = useState<string | null>(null);

  // Fetch connected accounts
  const accountsQuery = useQuery({
    queryKey: ['marketing', 'brand-accounts', brand.id],
    queryFn: () =>
      api.get<SocialAccountListResponse>(MARKETING_PATHS.brandSocialAccounts(brand.id)),
  });

  // Fetch 7-day expiring tokens
  const expiringQuery = useQuery({
    queryKey: ['marketing', 'expiring-accounts', brand.id],
    queryFn: () =>
      api.get<ExpiringAccountsResponse>(MARKETING_PATHS.expiringAccounts(brand.id)),
  });

  const connectMutation = useMutation({
    mutationFn: (data: ConnectSocialAccountRequest) =>
      api.post<SocialAccountResponse>(MARKETING_PATHS.connectAccount(brand.id), data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brand-accounts', brand.id] });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'expiring-accounts', brand.id] });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brands'] });
      setConnectModalPlatform(null);
      setAccountName('');
      setPlatformAccountId('');
      setAccessToken('');
      setRefreshToken('');
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiFailure ? err.message : 'Connection failed.');
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => api.post<RefreshTokenResponse>(MARKETING_PATHS.refreshAccount(id), {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brand-accounts', brand.id] });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'expiring-accounts', brand.id] });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => api.delete(MARKETING_PATHS.socialAccount(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brand-accounts', brand.id] });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'expiring-accounts', brand.id] });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'brands'] });
    },
  });

  const accountsByPlatform = new Map<SocialPlatform, SocialAccountSummary>();
  (accountsQuery.data?.items ?? []).forEach((acc) => {
    if (acc.status !== 'disconnected') {
      accountsByPlatform.set(acc.platform, acc);
    }
  });

  const expiringList = expiringQuery.data?.accounts ?? [];

  const submitConnect = () => {
    if (!connectModalPlatform || !accountName.trim() || !platformAccountId.trim() || !accessToken.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    connectMutation.mutate({
      platform: connectModalPlatform,
      accountName: accountName.trim(),
      platformAccountId: platformAccountId.trim(),
      accessToken: accessToken.trim(),
      refreshToken: refreshToken.trim() || undefined,
      expiresIn: expiresDays * 24 * 3600,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 7-Day Token Expiration Alert Banner */}
      {expiringList.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-sm text-amber-900">
                  {expiringList.length} Connected Account{expiringList.length > 1 ? 's' : ''} Expiring Soon
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  OAuth access tokens for{' '}
                  {expiringList.map((a) => `${PLATFORM_CONFIG[a.platform]?.label} (${a.accountName})`).join(', ')}{' '}
                  will expire within 7 days or need re-authentication.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {expiringList.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => refreshMutation.mutate(acc.id)}
                  disabled={refreshMutation.isPending}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 transition"
                >
                  Refresh {PLATFORM_CONFIG[acc.platform]?.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Vault Info Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🔐</span>
            <h2 className="text-base font-semibold text-slate-900">Encrypted OAuth Credential Vault</h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              AES-256-GCM
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Social network access and refresh tokens for <strong>{brand.name}</strong> are encrypted at rest with unique IVs and HMAC authentication tags.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div>Timezone: <span className="font-medium text-slate-800">{brand.timezone}</span></div>
          <span>•</span>
          <div>Connected: <span className="font-medium text-slate-800">{accountsByPlatform.size}</span> / {SOCIAL_PLATFORMS.length}</div>
        </div>
      </div>

      {/* Social Network Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SOCIAL_PLATFORMS.map((platform) => {
          const cfg = PLATFORM_CONFIG[platform];
          const connected = accountsByPlatform.get(platform);
          const isExpiringSoon = connected?.daysUntilExpiration !== null && (connected?.daysUntilExpiration ?? 99) <= 7;

          return (
            <div
              key={platform}
              className={`flex flex-col justify-between rounded-xl border p-4 shadow-xs transition hover:shadow-sm ${
                connected ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{cfg.icon}</span>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">{cfg.label}</h4>
                      <p className="text-xs text-slate-500">
                        {connected ? connected.accountName : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {connected ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        isExpiringSoon
                          ? 'bg-amber-100 text-amber-800'
                          : connected.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {isExpiringSoon ? 'Expiring Soon' : connected.status}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      Inactive
                    </span>
                  )}
                </div>

                {connected && (
                  <div className="mt-3.5 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Token Vault:</span>
                      <span className="font-mono text-slate-800">{connected.maskedAccessToken}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Expires:</span>
                      <span
                        className={`font-medium ${
                          isExpiringSoon ? 'text-amber-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        {connected.daysUntilExpiration !== null
                          ? `${connected.daysUntilExpiration} days remaining`
                          : 'Never'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Refresh Capability:</span>
                      <span className="text-emerald-700 font-medium">
                        {connected.hasRefreshToken ? '✓ Supported' : 'Manual Reconnect'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {connected ? (
                  <>
                    <button
                      type="button"
                      onClick={() => refreshMutation.mutate(connected.id)}
                      disabled={refreshMutation.isPending}
                      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                    >
                      {refreshMutation.isPending ? 'Refreshing…' : 'Refresh Token'}
                    </button>
                    <button
                      type="button"
                      onClick={() => disconnectMutation.mutate(connected.id)}
                      disabled={disconnectMutation.isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConnectModalPlatform(platform);
                      setAccountName(`${brand.name} ${cfg.label}`);
                      setPlatformAccountId(`${platform}_${Date.now()}`);
                      setAccessToken(`mock_oauth_token_${platform}_${Math.random().toString(36).substring(2, 9)}`);
                      setRefreshToken(`mock_refresh_token_${platform}_${Math.random().toString(36).substring(2, 9)}`);
                      setError(null);
                    }}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition"
                  >
                    Connect Channel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Connect Account Modal */}
      {connectModalPlatform && (
        <Modal
          onClose={() => setConnectModalPlatform(null)}
          title={`Connect ${PLATFORM_CONFIG[connectModalPlatform].label} to ${brand.name}`}
          description="Tokens entered here are encrypted at rest with AES-256-GCM. Production environments use automated OAuth 2.0 PKCE redirects."
          icon={PLATFORM_CONFIG[connectModalPlatform].icon}
          size="lg"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConnectModalPlatform(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => submitConnect()}
                disabled={connectMutation.isPending}
              >
                {connectMutation.isPending ? 'Connecting…' : 'Encrypt & Connect'}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitConnect();
            }}
            className="flex flex-col gap-4"
          >
            {error && <FormError>{error}</FormError>}

            <Field
              id="vault-account-name"
              label="Channel / account name"
              value={accountName}
              onChange={setAccountName}
            />

            <Field
              id="vault-platform-account-id"
              label="Platform account ID"
              value={platformAccountId}
              onChange={setPlatformAccountId}
            />

            <Field
              id="vault-access-token"
              label="OAuth access token"
              type="password"
              value={accessToken}
              onChange={setAccessToken}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                id="vault-refresh-token"
                label="OAuth refresh token"
                type="password"
                value={refreshToken}
                onChange={setRefreshToken}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="vault-expires-days" className="text-sm font-medium text-slate-700">
                  Expires in (days)
                </label>
                <input
                  id="vault-expires-days"
                  type="number"
                  min="1"
                  max="365"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
                />
              </div>
            </div>

            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </Modal>
      )}
    </div>
  );
}
