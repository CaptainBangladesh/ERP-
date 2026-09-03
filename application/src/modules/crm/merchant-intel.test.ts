import { describe, expect, it } from 'vitest';
import type { LeadSubmissionSummary } from '@erp/shared';
import { buildMerchantProfile } from './merchant-intel';

function submission(
  rawPayload: Record<string, unknown>,
  mappedFields: Record<string, string> = {},
): LeadSubmissionSummary {
  return {
    id: 'sub-1',
    leadId: 'lead-1',
    captureSourceId: 'cs-1',
    formName: 'Merchant Research',
    rawPayload: rawPayload as LeadSubmissionSummary['rawPayload'],
    mappedFields,
    submittedAt: '2026-09-01T09:00:00.000Z',
  };
}

describe('buildMerchantProfile', () => {
  it('reads a merchant-research form into its dimensions', () => {
    const profile = buildMerchantProfile(
      [
        submission(
          {
            Name: 'bddream menz',
            'Merchant Category': 'Fashion and Clothing',
            'Website Usability Assessment': ['Yes', 'Yes', 'Yes'],
            'Provide a link for Instagram page': '',
            'Does the merchant have a Facebook page?': 'Yes',
            'Additional Observations or Research Notes':
              'the Facebook link on their website does not lead to their official page',
            'Does the merchant have a dedicated website?': 'Yes',
            'Does the merchant have a mobile application(App)?': 'No',
            'If yes, approximately how many Facebook followers do they have?': '314k',
            'Provide a link to the merchant primary store or business website': 'bddream.shop',
            'Provide a link for TikTok page': 'https://www.tiktok.com/@believersofficial?_r=1&_d=x',
          },
          { Name: 'name' },
        ),
      ],
      [],
    );

    expect(profile.category).toBe('Fashion and Clothing');
    expect(profile.website.present).toBe('Yes');
    expect(profile.website.url).toBe('bddream.shop');
    expect(profile.app.present).toBe('No');

    const facebook = profile.socials.find((s) => s.platform === 'Facebook');
    expect(facebook?.present).toBe('Yes');
    expect(facebook?.followers).toBe('314k');

    const tiktok = profile.socials.find((s) => s.platform === 'TikTok');
    expect(tiktok?.url).toContain('tiktok.com');

    // The grid arrived as a bare list (old script) — kept, numbered, rather than dropped.
    expect(profile.usability).toHaveLength(3);

    expect(profile.notes).toHaveLength(1);
    expect(profile.notes[0]!.text).toContain('official page');

    // The identifying answer already shown beside the name is not repeated as a fact.
    expect(profile.facts.some((f) => f.value === 'bddream menz')).toBe(false);
    expect(profile.hasAnything).toBe(true);
  });

  it('splits a flattened grid into its sub-questions (new script)', () => {
    const profile = buildMerchantProfile(
      [
        submission({
          'Website Usability Assessment — Is the website mobile-responsive/phone view optimized?': 'Yes',
          'Website Usability Assessment — Is the user experience (UI/UX) intuitive?': 'No',
          'Website Usability Assessment — Are products easily searchable?': 'Not Applicable',
        }),
      ],
      [],
    );

    expect(profile.usability).toEqual([
      { question: 'Is the website mobile-responsive/phone view optimized?', answer: 'Yes' },
      { question: 'Is the user experience (UI/UX) intuitive?', answer: 'No' },
      { question: 'Are products easily searchable?', answer: 'Not Applicable' },
    ]);
  });

  it('groups a social link by its URL host even when the question does not name the platform', () => {
    const profile = buildMerchantProfile(
      [submission({ 'Their main page': 'https://facebook.com/some.merchant' })],
      [],
    );
    const facebook = profile.socials.find((s) => s.platform === 'Facebook');
    expect(facebook?.url).toBe('https://facebook.com/some.merchant');
  });

  it('extracts a clean URL even when the answer has junk beside it (the overflow bug)', () => {
    // A pasted TikTok share link with a trailing newline used to fail isUrl and be kept as raw
    // text, which is what ran off the side of the page. The URL token must be pulled out cleanly.
    const messy = `https://www.tiktok.com/@believersofficial?_r=1&_d=sec${'x'.repeat(200)}\n`;
    const profile = buildMerchantProfile(
      [submission({ 'Provide a link for TikTok page': messy })],
      [],
    );
    const tiktok = profile.socials.find((s) => s.platform === 'TikTok');
    expect(tiktok?.url).toBe(messy.trim());
    expect(tiktok?.handle).toBeUndefined();
  });

  it('keeps the newest answer when the same question is asked twice', () => {
    const profile = buildMerchantProfile(
      [
        submission({ 'Merchant Category': 'Electronics' }), // newest first
        submission({ 'Merchant Category': 'Fashion' }),
      ],
      [],
    );
    expect(profile.category).toBe('Electronics');
  });

  it('has nothing to show for a lead with no submissions', () => {
    expect(buildMerchantProfile([], []).hasAnything).toBe(false);
  });
});
