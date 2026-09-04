import type { LeadFieldSummary, LeadSubmissionSummary } from '@erp/shared';
import { answerLabel, answerParts, firstUrlIn } from './survey-answers';

/**
 * Turning a pile of survey answers into a merchant a salesperson can size up.
 *
 * The Survey tab and the workspace rail were both handing back the raw answers in whatever order
 * the form happened to ask them — a research form's "does the merchant have a Facebook page",
 * "how many followers", and the Facebook link itself landing three unrelated rows apart. A person
 * opening a lead wants the opposite: the merchant's category, whether they have a site and an app,
 * their social presence as one clickable set, what the usability review found, and the free-text
 * notes kept apart from the facts. So the answers are read *once*, here, into that shape.
 *
 * The classification is by meaning, not by a fixed form: a value that is a `facebook.com` URL is
 * a Facebook link whatever the question was titled, and a question mentioning "followers" is a
 * follower count. That keeps it working when the form is reworded, and degrades to a plain fact
 * when nothing recognises an answer, rather than dropping it.
 */

export type SocialPlatform = 'Facebook' | 'Instagram' | 'YouTube' | 'TikTok';

export interface SocialPresence {
  platform: SocialPlatform;
  /** The profile/page URL, when the form collected one. */
  url?: string;
  /** A handle or page name given as text rather than a link. */
  handle?: string;
  /** A follower/subscriber count, verbatim ("314k"). */
  followers?: string;
  /** A yes/no answer to "do they have a … page", when that is all the form asked. */
  present?: string;
}

export interface UsabilityAnswer {
  question: string;
  answer: string;
}

export interface ProfileFact {
  label: string;
  value: string;
  raw: unknown;
}

export interface ProfileNote {
  label: string;
  text: string;
}

export interface MerchantProfile {
  category?: string;
  website: { present?: string; url?: string };
  app: { present?: string };
  socials: SocialPresence[];
  usability: UsabilityAnswer[];
  notes: ProfileNote[];
  facts: ProfileFact[];
  /** Whether anything was recognised at all — the panels hide themselves when nothing was. */
  hasAnything: boolean;
}

export const DEFAULT_USABILITY_QUESTIONS = [
  'Is the website mobile-responsive/phone view optimized?',
  'Is the user experience (UI/UX) intuitive?',
  'Are products easily searchable?',
];

const YES_NO = /^(yes|no|n\/?a|not applicable|true|false|maybe|unknown|none)$/i;

/** The platforms we group a social presence under, matched by URL host or by question wording. */
const PLATFORMS: { platform: SocialPlatform; host: RegExp; label: RegExp }[] = [
  { platform: 'Facebook', host: /(^|\.)(facebook\.com|fb\.(com|me))$/i, label: /facebook|\bfb\b/i },
  { platform: 'Instagram', host: /(^|\.)instagram\.com$/i, label: /instagram|\binsta\b/i },
  { platform: 'YouTube', host: /(^|\.)(youtube\.com|youtu\.be)$/i, label: /youtube|you tube/i },
  { platform: 'TikTok', host: /(^|\.)tiktok\.com$/i, label: /tiktok|tik tok/i },
];

function isYesNo(value: string): boolean {
  return YES_NO.test(value.trim());
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function platformFromUrl(url: string): SocialPlatform | undefined {
  const host = hostOf(url);
  return PLATFORMS.find((entry) => entry.host.test(host))?.platform;
}

function platformFromLabel(label: string): SocialPlatform | undefined {
  return PLATFORMS.find((entry) => entry.label.test(label))?.platform;
}

export function buildMerchantProfile(
  submissions: LeadSubmissionSummary[],
  definitions: LeadFieldSummary[],
): MerchantProfile {
  const profile: MerchantProfile = {
    website: {},
    app: {},
    socials: [],
    usability: [],
    notes: [],
    facts: [],
    hasAnything: false,
  };

  /**
   * Every answer, newest submission first, one row per question. A merchant who answered twice
   * told us the newer thing last, so the first time a question is seen wins and later repeats are
   * dropped — the profile shows what we most recently know, not a pile of duplicates.
   */
  const seen = new Set<string>();
  const answers: { label: string; parts: string[]; raw: unknown }[] = [];
  for (const submission of submissions) {
    for (const [key, raw] of Object.entries(submission.rawPayload)) {
      const label = answerLabel(key, submission, definitions);
      const normalised = label.trim().toLowerCase();
      if (seen.has(normalised)) continue;
      const parts = answerParts(raw);
      if (parts.length === 0) continue;
      seen.add(normalised);
      answers.push({ label, parts, raw });
    }
  }

  const socialFor = (platform: SocialPlatform): SocialPresence => {
    let entry = profile.socials.find((social) => social.platform === platform);
    if (!entry) {
      entry = { platform };
      profile.socials.push(entry);
    }
    return entry;
  };

  for (const { label, parts, raw } of answers) {
    const labelL = label.toLowerCase();
    const joined = parts.join(', ');
    // Pull the URL token out of the answer even if it arrived with a stray newline or word beside
    // it — a value that isn't cleanly a URL used to be kept as raw text and overflow the layout.
    const urlPart = parts.map((part) => firstUrlIn(part)).find((url): url is string => Boolean(url));

    // Identity — already at the top of the workspace beside the name, so never repeated here.
    if (/^(name|merchant name|business name|shop name|contact|email|phone|organi[sz]ation)/.test(labelL)) {
      continue;
    }

    // Merchant category.
    if (!profile.category && /category|industry|vertical|segment/.test(labelL)) {
      profile.category = joined;
      continue;
    }

    // Social presence — a recognised URL host is decisive; the question wording is the fallback.
    const platform = (urlPart && platformFromUrl(urlPart)) || platformFromLabel(labelL);
    if (platform) {
      const social = socialFor(platform);
      if (urlPart && !social.url) social.url = urlPart;
      if (/follower|subscriber|likes/.test(labelL)) social.followers = joined;
      else if (!urlPart) {
        if (isYesNo(joined)) {
          if (!social.present) social.present = joined;
        } else if (!social.handle) {
          social.handle = joined;
        }
      }
      continue;
    }

    // Website usability review — a grid of sub-questions. A better Apps Script sends each row as
    // "Group — Sub-question", which we split so the sub-question is the row; the older script sent
    // only the grid title with a bare list of answers, which we keep, mapped to the standard questions rather than lose.
    if (/usability|assessment|user experience|ui\/ux|responsive|searchable|intuitive|navigat/.test(labelL)) {
      const dash = label.split(/\s+[—–-]\s+/);
      if (dash.length > 1) {
        profile.usability.push({ question: dash.slice(1).join(' — '), answer: joined });
      } else if (parts.length > 1) {
        parts.forEach((part, index) => {
          const defaultQ = DEFAULT_USABILITY_QUESTIONS[index];
          profile.usability.push({
            question: defaultQ || `${label} #${index + 1}`,
            answer: part,
          });
        });
      } else {
        const numMatch = label.match(/#(\d+)/);
        const qIdx = numMatch?.[1] ? parseInt(numMatch[1], 10) - 1 : -1;
        if (qIdx >= 0 && DEFAULT_USABILITY_QUESTIONS[qIdx]) {
          profile.usability.push({
            question: DEFAULT_USABILITY_QUESTIONS[qIdx]!,
            answer: joined,
          });
        } else {
          profile.usability.push({ question: label, answer: joined });
        }
      }
      continue;
    }

    // Mobile app.
    if (/mobile app|mobile application|application\s*\(app\)|\bapp\b/.test(labelL)) {
      if (!profile.app.present) profile.app.present = joined;
      continue;
    }

    // Website — a yes/no presence, or the store/site link itself.
    if (/dedicated website|have (a )?(dedicated )?website|website\?/.test(labelL) && isYesNo(joined)) {
      if (!profile.website.present) profile.website.present = joined;
      continue;
    }
    if (urlPart && /store|business website|primary|website|web ?site|shop|site link/.test(labelL)) {
      if (!profile.website.url) {
        profile.website.url = urlPart;
        continue;
      }
    }
    if (urlPart) {
      // A link that named no platform is, on a merchant-research form, almost always the store.
      if (!profile.website.url) {
        profile.website.url = urlPart;
        continue;
      }
      profile.facts.push({ label, value: joined, raw });
      continue;
    }

    // Free-text observations, and anything long enough to read as prose rather than a value.
    if (/note|observation|comment|remark|research|detail|describe|feedback|summary/.test(labelL) || joined.length > 120) {
      profile.notes.push({ label, text: joined });
      continue;
    }

    profile.facts.push({ label, value: joined, raw });
  }

  // A social we recognised but learned nothing about is an empty row — drop it.
  profile.socials = profile.socials.filter(
    (social) => social.url || social.handle || social.present || social.followers,
  );

  profile.hasAnything =
    Boolean(profile.category) ||
    Boolean(profile.website.present || profile.website.url) ||
    Boolean(profile.app.present) ||
    profile.socials.length > 0 ||
    profile.usability.length > 0 ||
    profile.notes.length > 0 ||
    profile.facts.length > 0;

  return profile;
}
