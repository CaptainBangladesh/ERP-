import { describe, expect, it } from 'vitest';
import { answerParts, hrefFor, humanise, isEmail, isUrl, prettyUrl } from './survey-answers';

describe('humanise', () => {
  it('rewrites a machine key but leaves a spaced question title as it reads', () => {
    expect(humanise('entry_104')).toBe('Entry 104');
    expect(humanise('fleet_size')).toBe('Fleet Size');
    // A webhook posts the full question title; title-casing would mangle "UI/UX".
    expect(humanise('Is the user experience (UI/UX) intuitive?')).toBe(
      'Is the user experience (UI/UX) intuitive?',
    );
  });
});

describe('answerParts', () => {
  it('splits a multi-value answer into its parts, and drops the blanks', () => {
    expect(answerParts(['Yes', 'No', '', 'N/A'])).toEqual(['Yes', 'No', 'N/A']);
  });

  it('renders a boolean as Yes/No and an empty answer as nothing', () => {
    expect(answerParts(true)).toEqual(['Yes']);
    expect(answerParts('')).toEqual([]);
    expect(answerParts(null)).toEqual([]);
  });

  it('keeps a single value whole', () => {
    expect(answerParts('bddream.shop')).toEqual(['bddream.shop']);
  });
});

describe('isUrl', () => {
  it('accepts full URLs, www, and bare domains', () => {
    expect(isUrl('https://www.tiktok.com/@believersofficial?_r=1')).toBe(true);
    expect(isUrl('www.facebook.com/Believerssignofficial')).toBe(true);
    expect(isUrl('bddream.shop')).toBe(true);
  });

  it('does not mistake numbers, prose, or emails for links', () => {
    expect(isUrl('3.5')).toBe(false);
    expect(isUrl('314k')).toBe(false);
    expect(isUrl('Fashion and Clothing')).toBe(false);
    expect(isUrl('Yes, Yes, Yes')).toBe(false);
    expect(isUrl('cc.believerssign@gmail.com')).toBe(false);
  });
});

describe('isEmail', () => {
  it('recognises an address and rejects a URL', () => {
    expect(isEmail('cc.believerssign@gmail.com')).toBe(true);
    expect(isEmail('bddream.shop')).toBe(false);
  });
});

describe('hrefFor', () => {
  it('fills in a protocol for a bare domain and mailto for an email', () => {
    expect(hrefFor('bddream.shop')).toBe('https://bddream.shop');
    expect(hrefFor('https://x.com/a')).toBe('https://x.com/a');
    expect(hrefFor('cc.believerssign@gmail.com')).toBe('mailto:cc.believerssign@gmail.com');
  });
});

describe('prettyUrl', () => {
  it('strips the protocol, www and query, keeping host and path', () => {
    expect(prettyUrl('https://www.facebook.com/Believerssignofficial')).toBe(
      'facebook.com/Believerssignofficial',
    );
  });

  it('drops the query string that makes a share link unreadable', () => {
    expect(prettyUrl('https://www.tiktok.com/@believersofficial?_r=1&_d=secABC123')).toBe(
      'tiktok.com/@believersofficial',
    );
  });

  it('truncates a link whose path alone is long enough to break the layout', () => {
    const shown = prettyUrl(`https://example.com/${'a'.repeat(300)}`);
    expect(shown.length).toBeLessThanOrEqual(48);
    expect(shown.endsWith('…')).toBe(true);
  });

  it('leaves an email address as it is', () => {
    expect(prettyUrl('cc.believerssign@gmail.com')).toBe('cc.believerssign@gmail.com');
  });
});
