import React, { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  NETWORK_LIMITS,
  validateForNetworks,
  type BestTimeResponse,
  type BrandSummary,
  type CreateScheduledPostRequest,
  type ScheduledPostResponse,
  type SocialAccountListResponse,
  type SocialAccountSummary,
  type AiAllowanceResponse,
  type AiComposeResponse,
  type AiComposeVariant,
  type SnippetListResponse,
  type SnippetSummary,
  type SocialPlatform,
} from '@erp/shared';
import { Button, Modal } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';
import { lastPublishedBrandId, rememberPublishedBrand } from '../brand-context';
import { lintDraft } from '../composer-lint';
import { HOOK_FORMULAS, applyTemplate, appendTemplate } from '../hook-templates';
import { CharacterMeter, PlatformChip } from './MarketingPrimitives';

export interface PostComposerModalProps {
  brand: BrandSummary;
  accounts: SocialAccountSummary[];
  isOpen: boolean;
  onClose: () => void;
  initialDate?: string;
  initialContent?: string;
  onPostCreated?: (post: ScheduledPostResponse) => void;
}

/**
 * How each network *looks* in the composer — nothing about what it accepts.
 *
 * The caps, media counts, aspect ratios and link handling used to live here as a second copy
 * of numbers the server also held. They now come from `NETWORK_LIMITS` in `@erp/shared`,
 * which the publisher imports too, so the meter the writer sees and the rule the server
 * enforces are the same table (14m).
 */
const PLATFORM_META: Record<
  string,
  {
    icon: string;
    label: string;
    color: string;
    formats: string[];
    placeholder: string;
  }
> = {
  instagram: {
    icon: '📸',
    label: 'Instagram',
    color: 'text-pink-600 bg-pink-50 border-pink-200',
    formats: ['Feed Post', 'Carousel', 'Reel', 'Story'],
    placeholder: 'Write your Instagram caption... First 125 chars appear before "...more". Add up to 30 hashtags.',
  },
  facebook: {
    icon: '📘',
    label: 'Facebook',
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    formats: ['Standard Post', 'Photo Album', 'Reel', 'Story'],
    placeholder: 'Share an update, link, or announcement with your Facebook community...',
  },
  linkedin: {
    icon: '💼',
    label: 'LinkedIn',
    color: 'text-sky-700 bg-sky-50 border-sky-200',
    formats: ['Text & Image', 'PDF Document Carousel', 'Article Link'],
    placeholder: 'Craft a thought-leadership insight or company milestone for professionals...',
  },
  x: {
    icon: '🐦',
    label: 'X (Twitter)',
    color: 'text-slate-800 bg-slate-100 border-slate-300',
    formats: ['Tweet', 'Thread Starter', 'Media Tweet'],
    placeholder: 'What is happening? Keep it punchy (280 characters)...',
  },
  tiktok: {
    icon: '🎵',
    label: 'TikTok',
    color: 'text-neutral-900 bg-neutral-100 border-neutral-300',
    formats: ['TikTok Video', 'Photo Slideshow'],
    placeholder: 'Add video description, catchy hook, and #fyp hashtags...',
  },
  youtube: {
    icon: '▶️',
    label: 'YouTube',
    color: 'text-red-600 bg-red-50 border-red-200',
    formats: ['Video Upload', 'YouTube Short'],
    placeholder: 'Video description, timestamp chapter links, and search keywords...',
  },
  pinterest: {
    icon: '📌',
    label: 'Pinterest',
    color: 'text-rose-600 bg-rose-50 border-rose-200',
    formats: ['Standard Pin', 'Idea Pin'],
    placeholder: 'Pin title, inspirational description, and destination URL...',
  },
  threads: {
    icon: '🧵',
    label: 'Threads',
    color: 'text-slate-900 bg-slate-100 border-slate-300',
    formats: ['Thread', 'Image Carousel'],
    placeholder: 'Start an open conversation or commentary...',
  },
  bluesky: {
    icon: '🦋',
    label: 'Bluesky',
    color: 'text-sky-500 bg-sky-50 border-sky-200',
    formats: ['Skeet Post', 'Media Post'],
    placeholder: 'Post a concise thought to the AT Protocol network...',
  },
  google_business: {
    icon: '📍',
    label: 'Google Business',
    color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    formats: ['Update', 'Offer / Deal', 'Event'],
    placeholder: 'Local store announcement, special offer, or event details...',
  },
};

// Curated stock / brand assets for instant 1-click demonstration
const SAMPLE_BRAND_ASSETS = [
  {
    id: 'asset-1',
    title: 'Minimalist Workspace & Tech Setup',
    url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80',
    category: 'Lifestyle',
    tag: 'Tech',
  },
  {
    id: 'asset-2',
    title: 'Modern Architecture & Clean Geometry',
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80',
    category: 'Design',
    tag: 'Aesthetics',
  },
  {
    id: 'asset-3',
    title: 'Abstract Gradient Wave Pattern',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    category: 'Branding',
    tag: 'Creative',
  },
  {
    id: 'asset-4',
    title: 'Team Brainstorm & Whiteboard Session',
    url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
    category: 'Team',
    tag: 'Culture',
  },
  {
    id: 'asset-5',
    title: 'Luxury Retail & Premium Goods',
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=80',
    category: 'Products',
    tag: 'Launch',
  },
  {
    id: 'asset-6',
    title: 'Coffee & Creative Journaling',
    url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=800&q=80',
    category: 'Community',
    tag: 'Daily',
  },
];

/**
 * What a recommendation's provenance is called on screen.
 *
 * Derived from the response's `source` and `sampleSize`, never decided here (14j): a global
 * median presented as this brand's own audience is the failure the field exists to prevent.
 */
function sourceLabel(best: BestTimeResponse): string {
  if (best.source === 'tenant') {
    return `From this brand's own history — ${best.sampleSize} posts, last 90 days`;
  }
  if (best.source === 'cohort') {
    return `Not enough history for this brand yet — showing your other brands on this network (${best.sampleSize} posts)`;
  }
  return 'Not enough history yet — showing general posting times, not this brand’s own data';
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function bucketLabel(dayOfWeek: number, hour: number): string {
  const day = WEEKDAY_NAMES[dayOfWeek] ?? 'Sunday';
  return `${day.slice(0, 3)} ${String(hour).padStart(2, '0')}:00`;
}


/** The text the linter reads, for whichever tab is in front of the user. */
function currentTabContentForLint(
  activeTab: 'base' | SocialPlatform,
  baseContent: string,
  customizations: Record<string, { content?: string }>,
): string {
  if (activeTab === 'base') return baseContent;
  return customizations[activeTab]?.content ?? baseContent;
}

export function PostComposerModal({
  brand,
  accounts,
  isOpen,
  onClose,
  initialDate,
  initialContent = '',
  onPostCreated,
}: PostComposerModalProps) {
  const queryClient = useQueryClient();

  // Multi-Account Selection: default to all accounts
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(() => {
    return accounts.map((a) => a.id);
  });

  // Sync selected accounts when accounts load or modal opens
  React.useEffect(() => {
    if (accounts.length > 0 && selectedAccountIds.length === 0) {
      setSelectedAccountIds(accounts.map((a) => a.id));
    }
  }, [accounts, isOpen]);

  // Base content shared across networks
  const [baseContent, setBaseContent] = useState(initialContent);

  // Network-specific customization state
  const [activeTab, setActiveTab] = useState<'base' | SocialPlatform>('base');
  const [platformCustomizations, setPlatformCustomizations] = useState<
    Record<
      string,
      {
        content?: string;
        firstComment?: string;
        format?: string;
      }
    >
  >({});

  // Media attachments
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [customMediaUrl, setCustomMediaUrl] = useState('');

  // Scheduled date & time
  const [scheduledAtTime, setScheduledAtTime] = useState<string>(() => {
    if (initialDate) {
      const d = new Date(initialDate);
      if (!isNaN(d.getTime())) {
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 16);
      }
    }
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  // Mode: SCHEDULED vs PUBLISH_NOW vs DRAFT
  const [postStatus, setPostStatus] = useState<'SCHEDULED' | 'DRAFT'>('SCHEDULED');
  const [confirming, setConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Filter selected accounts
  const selectedAccounts = useMemo(
    () => accounts.filter((a) => selectedAccountIds.includes(a.id)),
    [accounts, selectedAccountIds],
  );

  // Unique platforms selected
  const selectedPlatforms = useMemo(() => {
    const set = new Set<SocialPlatform>();
    selectedAccounts.forEach((a) => set.add(a.platform as SocialPlatform));
    return Array.from(set);
  }, [selectedAccounts]);

  /**
   * The network the recommendation is about.
   *
   * One network at a time, because "best time to post" is a different answer per network and
   * an average across four of them is an answer to nobody's question.
   */
  const insightPlatform: SocialPlatform =
    activeTab !== 'base' ? activeTab : selectedPlatforms[0] ?? 'instagram';

  const { data: bestTimes } = useQuery({
    queryKey: ['marketing-best-times', brand.id, insightPlatform],
    queryFn: () =>
      api.get<BestTimeResponse>(
        `${MARKETING_PATHS.bestTimes}?brandId=${encodeURIComponent(brand.id)}&platform=${encodeURIComponent(insightPlatform)}`,
      ),
    enabled: isOpen,
  });

  const { data: snippetList } = useQuery({
    queryKey: ['marketing-snippets', brand.id],
    queryFn: () =>
      api.get<SnippetListResponse>(
        `${MARKETING_PATHS.snippets}?filter.brandId=${encodeURIComponent(brand.id)}&pageSize=50`,
      ),
    enabled: isOpen,
  });

  const snippets: SnippetSummary[] = snippetList?.items ?? [];

  /**
   * The writing assistant (14.6-14.9).
   *
   * The allowance is read *before* anything is generated, so the number of generations left
   * is on screen while the user decides — not learned from a refusal (14q). The request says
   * nothing about the model, the token budget or the cost: the server picks all of them, and
   * a body that tried would be refused rather than trimmed.
   */
  const { data: aiAllowance } = useQuery({
    queryKey: ['marketing-ai-allowance'],
    queryFn: () => api.get<AiAllowanceResponse>(MARKETING_PATHS.aiAllowance),
    enabled: isOpen,
  });

  const [aiVariants, setAiVariants] = useState<AiComposeVariant[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const composeWithAi = useMutation({
    mutationFn: () =>
      api.post<AiComposeResponse>(MARKETING_PATHS.aiCompose, {
        brandId: brand.id,
        draft: currentTabContent,
        platform: insightPlatform,
        variants: 3,
      }),
    onSuccess: (result) => {
      setAiVariants([...result.variants]);
      setAiError(null);
      void queryClient.invalidateQueries({ queryKey: ['marketing-ai-allowance'] });
    },
    onError: (err) => {
      setAiVariants([]);
      setAiError(
        err instanceof ApiFailure ? err.message : 'The writing assistant is unavailable.',
      );
    },
  });

  /**
   * Accepting a variant is the only way one reaches a post (14c).
   *
   * Nothing generated is applied, scheduled, published or sent on its own: a variant sits in
   * a read-only preview until a person presses this, and even then it only fills the editable
   * draft field they are still free to rewrite.
   */
  const acceptVariant = (variant: AiComposeVariant) => {
    handleContentChange(variant.text);
    setAiVariants([]);
  };

  /**
   * The one validator, run against the selected channels before publish is enabled (14.1).
   *
   * The same call the server makes over the same table, so the sentence shown here is the
   * sentence the refusal would carry. The client check is UX; it is the publisher's copy that
   * is the limit.
   */
  const limitViolations = useMemo(() => {
    return selectedPlatforms.flatMap((platform) => {
      const content = platformCustomizations[platform]?.content?.trim()
        ? (platformCustomizations[platform]?.content as string)
        : baseContent;
      return validateForNetworks([platform], { content, mediaCount: mediaUrls.length });
    });
  }, [selectedPlatforms, platformCustomizations, baseContent, mediaUrls]);

  /** Warnings, and only warnings — nothing here can stop a publish (14n). */
  const lintWarnings = useMemo(
    () => lintDraft(currentTabContentForLint(activeTab, baseContent, platformCustomizations), selectedPlatforms),
    [activeTab, baseContent, platformCustomizations, selectedPlatforms],
  );

  const [hookSubject, setHookSubject] = useState('');

  const applyHook = (skeleton: string) => {
    const filled = applyTemplate(skeleton, {
      subject: hookSubject,
      brand: brand.name,
      cta: 'Link in bio',
    });
    handleContentChange(appendTemplate(currentTabContent, filled));
  };

  const insertSnippet = (snippet: SnippetSummary) => {
    const filled = applyTemplate(snippet.body, {
      subject: hookSubject,
      brand: brand.name,
      cta: 'Link in bio',
    });
    if (snippet.kind === 'first_comment' && activeTab !== 'base') {
      handleFirstCommentChange(
        currentTabFirstComment ? `${currentTabFirstComment} ${filled}` : filled,
      );
      return;
    }
    handleContentChange(appendTemplate(currentTabContent, filled));
  };

  // Active platform metadata
  const currentPlatformMeta = activeTab === 'base' ? null : PLATFORM_META[activeTab];

  // Active content for current tab
  const currentTabContent =
    activeTab === 'base'
      ? baseContent
      : platformCustomizations[activeTab]?.content ?? baseContent;

  const currentTabFirstComment =
    activeTab === 'base' ? '' : platformCustomizations[activeTab]?.firstComment ?? '';

  // Handle content change in current tab
  const handleContentChange = (val: string) => {
    if (activeTab === 'base') {
      setBaseContent(val);
    } else {
      setPlatformCustomizations((prev) => ({
        ...prev,
        [activeTab]: {
          ...prev[activeTab],
          content: val,
        },
      }));
    }
  };

  const handleFirstCommentChange = (val: string) => {
    if (activeTab === 'base') return;
    setPlatformCustomizations((prev) => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        firstComment: val,
      },
    }));
  };

  const handleFormatChange = (fmt: string) => {
    if (activeTab === 'base') return;
    setPlatformCustomizations((prev) => ({
      ...prev,
      [activeTab]: {
        ...prev[activeTab],
        format: fmt,
      },
    }));
  };

  // Toggle account selection
  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAllAccounts = () => {
    setSelectedAccountIds(accounts.map((a) => a.id));
  };

  const clearAllAccounts = () => {
    setSelectedAccountIds([]);
  };

  // Apply a recommended bucket to the schedule field.
  const applyBestTime = (bucket: { dayOfWeek: number; hour: number }) => {
    const date = new Date();
    const currentDayIndex = date.getDay();
    let daysToAdd = (bucket.dayOfWeek - currentDayIndex + 7) % 7;
    if (daysToAdd === 0 && date.getHours() >= bucket.hour) {
      daysToAdd = 7;
    }
    date.setDate(date.getDate() + daysToAdd);
    date.setHours(bucket.hour, 0, 0, 0);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setScheduledAtTime(date.toISOString().slice(0, 16));
  };

  // Schedule / Create Mutation
  const createPostsMutation = useMutation({
    mutationFn: async () => {
      if (selectedAccountIds.length === 0) {
        throw new Error('Please select at least one social channel.');
      }
      if (!baseContent.trim()) {
        throw new Error('Post content cannot be empty.');
      }

      const scheduledAtIso = new Date(scheduledAtTime).toISOString();
      const results: ScheduledPostResponse[] = [];

      for (const accountId of selectedAccountIds) {
        const account = accounts.find((a) => a.id === accountId);
        const platform = account?.platform ?? 'instagram';
        const custom = platformCustomizations[platform];

        const payload: CreateScheduledPostRequest = {
          brandId: brand.id,
          socialAccountId: accountId,
          content: custom?.content && custom.content.trim() ? custom.content : baseContent,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
          platformConfig: {
            format: custom?.format,
            firstComment: custom?.firstComment,
          },
          scheduledAt: scheduledAtIso,
          status: postStatus,
        };

        const res = await api.post<ScheduledPostResponse>(MARKETING_PATHS.posts, payload);
        results.push(res);
      }

      return results;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['scheduled-posts', brand.id] });
      // What "the brand you last published to" means, recorded at the only moment it changes.
      rememberPublishedBrand(brand.id);
      setSuccessToast(`Successfully scheduled ${created.length} post(s)!`);
      if (created[0] && onPostCreated) {
        onPostCreated(created[0]);
      }
      setTimeout(() => {
        onClose();
      }, 700);
    },
    onError: (err) => {
      setErrorMessage(err instanceof ApiFailure ? err.message : String(err));
    },
  });

  if (!isOpen) return null;

  /**
   * 13.2d — the publish button says whose account it is about to post to.
   *
   * A confirmation is required whenever the target brand is not the brand this session last
   * published to, which is the shape the mistake actually takes: you were working on one client,
   * you switched, and the composer looked identical either way. The dialog renders the account
   * handles from `confirmation.accounts` — the list the *server* returned for this brand, fetched
   * when the dialog opens — rather than from the props this component is holding, because a
   * confirmation built from client state only confirms the same mistake back at you. The server
   * re-checks every `socialAccountId` against the brand and the caller's company regardless; this
   * is a guard on top of that check, never in place of it.
   */
  const needsConfirmation =
    lastPublishedBrandId() !== null && lastPublishedBrandId() !== brand.id;

  const startPublish = () => {
    if (needsConfirmation) setConfirming(true);
    else createPostsMutation.mutate();
  };

  return (
    <Modal
      onClose={onClose}
      title="Multi-Network Post Composer"
      description={
        <>
          Workspace: <span className="font-semibold text-slate-700">{brand.name}</span> — broadcast
          across channels with custom formatting.
        </>
      }
      icon="✍️"
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-slate-500">
            Broadcasting to <strong className="text-slate-800">{selectedAccountIds.length}</strong>{' '}
            social account(s) for <strong className="text-slate-800">{brand.name}</strong>
          </span>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              createPostsMutation.isPending ||
              selectedAccountIds.length === 0 ||
              limitViolations.length > 0
            }
            onClick={startPublish}
          >
            {createPostsMutation.isPending
              ? 'Publishing & Scheduling…'
              : `${postStatus === 'SCHEDULED' ? 'Schedule Broadcast' : 'Save as Draft'} to ${brand.name}`}
          </Button>
        </>
      }
    >
        {/* Modal Body */}
        <div className="flex flex-col lg:flex-row flex-1 overflow-y-auto divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left Column: Accounts & Composer Inputs */}
          <div className="flex-1 flex flex-col gap-5 p-6 overflow-y-auto">
            {/* Feedback Alerts */}
            {errorMessage && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-center justify-between">
                <span>⚠️ {errorMessage}</span>
                <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-500 font-bold">
                  ✕
                </button>
              </div>
            )}
            {successToast && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 flex items-center gap-2">
                <span>✅</span>
                <span>{successToast}</span>
              </div>
            )}

            {/* 1. Multi-Account Channel Selector */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Target Social Channels ({selectedAccountIds.length}/{accounts.length})
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={selectAllAccounts}
                    className="text-blue-600 hover:underline font-semibold"
                  >
                    Select All
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={clearAllAccounts}
                    className="text-slate-500 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {accounts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                  No connected accounts found. Visit Brand & OAuth Vault to link Instagram, LinkedIn, or X channels.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {accounts.map((acc) => {
                    const isSelected = selectedAccountIds.includes(acc.id);
                    const meta = PLATFORM_META[acc.platform] ?? {
                      icon: '📱',
                      label: acc.platform,
                      color: 'text-slate-700 bg-slate-50 border-slate-200',
                    };

                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => toggleAccount(acc.id)}
                        className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                          isSelected
                            ? 'border-blue-600 bg-blue-50/60 shadow-xs ring-1 ring-blue-500'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="h-4 w-4 rounded-md text-blue-600 border-slate-300 pointer-events-none"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="flex items-center gap-1 text-xs font-semibold text-slate-900 truncate">
                            <span>{meta.icon}</span>
                            <span className="truncate">{acc.accountName}</span>
                          </span>
                          <span className="text-[10px] text-slate-500 capitalize">{meta.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Platform-Specific Customization Tabs */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Content & Platform Tailoring
                </label>
                {activeTab !== 'base' && (
                  <span className="text-[11px] font-medium text-blue-600">
                    Customizing for {PLATFORM_META[activeTab]?.label}
                  </span>
                )}
              </div>

              {/* Tab Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 pb-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveTab('base')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                    activeTab === 'base'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span>🌐</span>
                  <span>Base (All Channels)</span>
                </button>

                {selectedPlatforms.map((platform) => {
                  const meta = PLATFORM_META[platform] ?? { icon: '📱', label: platform };
                  const isCustomized = Boolean(platformCustomizations[platform]?.content);

                  return (
                    <button
                      key={platform}
                      type="button"
                      aria-label={`Customize ${meta.label}`}
                      onClick={() => setActiveTab(platform)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${
                        activeTab === platform
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{meta.icon}</span>
                      <span>{meta.label}</span>
                      {isCustomized && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Customized" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Format guide, read from the one shared limits table */}
              {activeTab !== 'base' && NETWORK_LIMITS[activeTab] && (
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-900">📐 Format Guide:</span>
                  <span>
                    {NETWORK_LIMITS[activeTab].aspectRatios.map((r) => r.label).join(' · ')} ·{' '}
                    up to {NETWORK_LIMITS[activeTab].maxMedia} attachment(s) ·{' '}
                    {NETWORK_LIMITS[activeTab].linkNote}
                  </span>
                </div>
              )}

              {/* Textarea */}
              <div className="relative flex flex-col">
                <textarea
                  rows={5}
                  value={currentTabContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder={
                    currentPlatformMeta?.placeholder ??
                    'Write your primary post caption. All selected social networks receive this message unless customized above...'
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white p-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
                />

                {/* Character & Hashtag Counter Meter */}
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                  <div className="flex items-center gap-3">
                    {/* Hashtag counter */}
                    {activeTab === 'instagram' && (
                      <span>
                        🏷️ Hashtags:{' '}
                        <strong className="text-slate-700">
                          {(currentTabContent.match(/#[a-zA-Z0-9_]+/g) ?? []).length} /{' '}
                          {NETWORK_LIMITS.instagram.maxHashtags}
                        </strong>
                      </span>
                    )}
                    {activeTab === 'linkedin' && (
                      <span>📄 Supports PDF Slide Deck upload</span>
                    )}
                  </div>

                  <CharacterMeter
                    used={currentTabContent.length}
                    budget={activeTab === 'base' ? undefined : NETWORK_LIMITS[activeTab]?.characterLimit}
                  />
                </div>
              </div>

              {/* Per-network limits — the same check the publisher re-runs (14.1 / 14m) */}
              {limitViolations.length > 0 && (
                <div
                  data-testid="limit-violations"
                  role="alert"
                  className="flex flex-col gap-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-800"
                >
                  <span className="font-bold">This post cannot be published as written:</span>
                  <ul className="flex flex-col gap-0.5 pl-4 list-disc">
                    {limitViolations.map((violation, idx) => (
                      <li key={`${violation.platform}-${violation.code}-${idx}`}>
                        {violation.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Lint — warnings only. Nothing here blocks a publish (14n). */}
              {lintWarnings.length > 0 && (
                <div
                  data-testid="lint-warnings"
                  className="flex flex-col gap-1 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-900"
                >
                  <span className="font-bold">Worth a second look — none of these stop you publishing:</span>
                  <ul className="flex flex-col gap-0.5 pl-4 list-disc">
                    {lintWarnings.map((warning) => (
                      <li key={warning.code + warning.message}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The writing assistant — metered, and nothing it returns takes an action (14c) */}
              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Writing assistant
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {aiAllowance
                      ? `${aiAllowance.remainingGenerations} left this month · resets ${aiAllowance.resetsAt.slice(0, 10)}`
                      : 'Checking your allowance…'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => composeWithAi.mutate()}
                    disabled={
                      composeWithAi.isPending ||
                      !currentTabContent.trim() ||
                      (aiAllowance?.remainingGenerations ?? 0) < 1
                    }
                    className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {composeWithAi.isPending ? 'Writing…' : `Suggest ${3} rewrites`}
                  </button>
                  <span className="text-[11px] text-slate-500">
                    Suggestions fill the draft only when you accept one.
                  </span>
                </div>
                {aiError && (
                  <p className="text-[11px] font-medium text-rose-700">{aiError}</p>
                )}
                {aiVariants.length > 0 && (
                  <ul className="flex flex-col gap-1.5">
                    {aiVariants.map((variant, index) => (
                      <li
                        key={`${index}-${variant.characters}`}
                        className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2"
                      >
                        {/* A textarea value, never HTML and never markdown-with-HTML (14s). */}
                        <textarea
                          readOnly
                          value={variant.text}
                          rows={3}
                          aria-label={`Suggestion ${index + 1}`}
                          className="w-full resize-none border-0 bg-transparent text-[11px] text-slate-700 focus:outline-hidden"
                        />
                        <button
                          type="button"
                          onClick={() => acceptVariant(variant)}
                          className="shrink-0 rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50"
                        >
                          Use this
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Hook formulas — literal substitution over three keys, no template engine */}
              <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="composer-hook-subject"
                    className="text-xs font-bold uppercase tracking-wider text-slate-600"
                  >
                    Hook formulas
                  </label>
                  <input
                    id="composer-hook-subject"
                    type="text"
                    value={hookSubject}
                    onChange={(e) => setHookSubject(e.target.value)}
                    placeholder="Your subject, e.g. stock counts"
                    className="flex-1 max-w-[220px] rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] text-slate-900 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {HOOK_FORMULAS.map((formula) => (
                    <button
                      key={formula.id}
                      type="button"
                      title={formula.description}
                      onClick={() => applyHook(formula.skeleton)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {formula.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Snippet library — bodies are text, inserted as a textarea value (14o) */}
              {snippets.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Saved snippets
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {snippets.map((snippet) => (
                      <button
                        key={snippet.id}
                        type="button"
                        title={snippet.body}
                        onClick={() => insertSnippet(snippet)}
                        className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        {snippet.kind === 'first_comment' ? '💬' : '🎯'} {snippet.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* First-Comment Scheduling (Instagram / LinkedIn) */}
              {(activeTab === 'instagram' || activeTab === 'linkedin') && (
                <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-800">
                      💬 Schedule First Comment
                    </label>
                    <span className="text-[10px] text-slate-500">
                      Auto-posted upon publication (great for #hashtags & links)
                    </span>
                  </div>
                  <input
                    type="text"
                    value={currentTabFirstComment}
                    onChange={(e) => handleFirstCommentChange(e.target.value)}
                    placeholder="#brand #marketing #innovation #growth"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
                  />
                </div>
              )}

              {/* Content Format selector for specific platforms */}
              {currentPlatformMeta && currentPlatformMeta.formats.length > 1 && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-slate-500 font-medium">Post Format:</span>
                  <div className="flex gap-1.5">
                    {currentPlatformMeta.formats.map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => handleFormatChange(fmt)}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                          (platformCustomizations[activeTab]?.format ?? currentPlatformMeta.formats[0]) === fmt
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Media Upload & Curated Brand Asset Selector */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Media & Visual Attachments ({mediaUrls.length})
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAssetLibraryOpen(!isAssetLibraryOpen)}
                    className="flex items-center gap-1 rounded-md bg-purple-50 border border-purple-200 px-2.5 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100"
                  >
                    <span>🖼️</span>
                    <span>Brand Asset Library</span>
                  </button>
                </div>
              </div>

              {/* Asset Library Picker Drawer */}
              {isAssetLibraryOpen && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/30 p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-900">
                      Select High-Resolution Curated Assets:
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAssetLibraryOpen(false)}
                      className="text-purple-600 text-xs hover:underline"
                    >
                      Close Library
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
                    {SAMPLE_BRAND_ASSETS.map((asset) => {
                      const isSelected = mediaUrls.includes(asset.url);
                      return (
                        <div
                          key={asset.id}
                          onClick={() => {
                            if (isSelected) {
                              setMediaUrls(mediaUrls.filter((u) => u !== asset.url));
                            } else {
                              setMediaUrls([...mediaUrls, asset.url]);
                            }
                          }}
                          className={`group relative cursor-pointer overflow-hidden rounded-lg border text-left transition ${
                            isSelected
                              ? 'border-purple-600 ring-2 ring-purple-500'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <img
                            src={asset.url}
                            alt={asset.title}
                            className="h-16 w-full object-cover transition group-hover:scale-105"
                          />
                          <div className="p-1 bg-white">
                            <p className="truncate text-[10px] font-semibold text-slate-800">
                              {asset.title}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom Image URL / File input */}
              <div className="flex gap-2">
                <input
                  type="url"
                  value={customMediaUrl}
                  onChange={(e) => setCustomMediaUrl(e.target.value)}
                  placeholder="Paste direct image or video URL (https://...)..."
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (customMediaUrl.trim()) {
                      setMediaUrls([...mediaUrls, customMediaUrl.trim()]);
                      setCustomMediaUrl('');
                    }
                  }}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Add Media
                </button>
              </div>

              {/* Attached Media Thumbnails */}
              {mediaUrls.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {mediaUrls.map((url, idx) => (
                    <div
                      key={idx}
                      className="group relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 shadow-xs"
                    >
                      <img src={url} alt={`Media ${idx + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setMediaUrls(mediaUrls.filter((_, i) => i !== idx))}
                        className="absolute inset-0 flex items-center justify-center bg-rose-900/70 text-white text-xs opacity-0 group-hover:opacity-100 transition"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Scheduling Date, Best-Times Heatmap & Simulator */}
          <div className="w-full lg:w-80 flex flex-col gap-5 p-6 bg-slate-50/50 overflow-y-auto">
            {/* Scheduling Date & Time Picker */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Scheduled Publishing Time
              </label>
              <input
                type="datetime-local"
                value={scheduledAtTime}
                onChange={(e) => setScheduledAtTime(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-hidden"
                required
              />
            </div>

            {/* Best Times to Post — from this tenant's own data, and it says so */}
            <div className="flex flex-col gap-2.5 rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <span>⚡</span>
                  <span>Best times to post</span>
                </span>
                {bestTimes && (
                  <span
                    data-testid="best-time-source"
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                  >
                    {bestTimes.source === 'tenant' ? 'Your data' : bestTimes.source === 'cohort' ? 'Your other brands' : 'General average'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600" data-testid="best-time-provenance">
                {bestTimes
                  ? `${sourceLabel(bestTimes)} · times shown in ${bestTimes.timezone}`
                  : 'Loading posting-time history…'}
              </p>

              <div className="flex flex-col gap-1.5">
                {(bestTimes?.recommendations ?? []).slice(0, 3).map((bucket, idx) => (
                  <div
                    key={`${bucket.dayOfWeek}-${bucket.hour}-${idx}`}
                    className="flex items-center justify-between rounded-lg bg-white p-2 border border-amber-100 text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">
                        {bucketLabel(bucket.dayOfWeek, bucket.hour)}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600">
                        score {bucket.score}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyBestTime(bucket)}
                      className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-600 transition"
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Card Preview Simulator */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Feed Preview Simulator
              </span>
              <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 text-white font-bold text-xs">
                    {brand.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-slate-900 truncate">{brand.name}</span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(scheduledAtTime).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Media Preview inside card */}
                {mediaUrls.length > 0 && (
                  <div className="mt-2.5 overflow-hidden rounded-lg bg-slate-100">
                    <img
                      src={mediaUrls[0]}
                      alt="Post preview"
                      className="max-h-36 w-full object-cover"
                    />
                  </div>
                )}

                {/* Content snippet */}
                <p className="mt-2.5 line-clamp-3 text-xs text-slate-800">
                  {currentTabContent || (
                    <span className="italic text-slate-400">Post caption will render here...</span>
                  )}
                </p>

                {/* Simulated engagement stats */}
                <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                  <span>❤️ 0 likes</span>
                  <span>💬 0 comments</span>
                  <span>🚀 Scheduled</span>
                </div>
              </div>
            </div>

            {/* Publishing Status Toggle */}
            <div className="flex items-center justify-between rounded-xl bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setPostStatus('SCHEDULED')}
                className={`flex-1 rounded-lg py-1.5 text-center transition ${
                  postStatus === 'SCHEDULED'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🗓️ Schedule
              </button>
              <button
                type="button"
                onClick={() => setPostStatus('DRAFT')}
                className={`flex-1 rounded-lg py-1.5 text-center transition ${
                  postStatus === 'DRAFT'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📝 Save Draft
              </button>
            </div>
          </div>
        </div>

      {confirming && (
        <ConfirmCrossBrandPublish
          brand={brand}
          accountIds={selectedAccountIds}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            createPostsMutation.mutate();
          }}
        />
      )}
    </Modal>
  );
}

/**
 * "You were on another client a moment ago. This is going to *these* accounts."
 *
 * Fetches the brand's accounts itself so the handles on screen are the server's answer for the
 * brand being published to, not the composer's copy — the props could be stale, or could be the
 * previous brand's, which is precisely the failure being guarded against. While the list is in
 * flight there is nothing to confirm, so confirming is disabled rather than optimistic.
 */
function ConfirmCrossBrandPublish({
  brand,
  accountIds,
  onCancel,
  onConfirm,
}: {
  brand: BrandSummary;
  accountIds: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accountsQuery = useQuery({
    queryKey: ['marketing', 'brand-accounts', brand.id],
    queryFn: () =>
      api.get<SocialAccountListResponse>(MARKETING_PATHS.brandSocialAccounts(brand.id)),
  });

  const targets = (accountsQuery.data?.items ?? []).filter((account) =>
    accountIds.includes(account.id),
  );

  return (
    <Modal
      onClose={onCancel}
      title={`Publish to ${brand.name}?`}
      description="This is not the brand you last published to in this session."
      icon="⚠️"
      footer={
        <>
          {/* Cancelling leaves the active brand exactly as it was. */}
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={accountsQuery.isPending}>
            Yes, publish to {brand.name}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-slate-700">
        <p>
          These posts go to <strong>{brand.name}</strong>&apos;s connected accounts:
        </p>

        {accountsQuery.isPending ? (
          <p className="text-xs text-slate-500">Checking with the server which accounts these are…</p>
        ) : targets.length === 0 ? (
          <p className="text-xs text-rose-700">
            The server does not list any of the selected accounts under this brand. Close this and
            choose the channels again.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {targets.map((account) => (
              <li key={account.id}>
                <PlatformChip platform={account.platform} handle={account.accountName} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
