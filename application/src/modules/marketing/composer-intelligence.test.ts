import { describe, expect, it } from 'vitest';
import { validateForNetwork, validateForNetworks, NETWORK_LIMITS } from '@erp/shared';
import { lintDraft } from './composer-lint';
import { HOOK_FORMULAS, applyTemplate, appendTemplate } from './hook-templates';

/**
 * Ticket 14 phase 1, the browser half.
 *
 * The server half — the publisher re-running the limits, and the best-time fallback labelling
 * itself — is in `backend/test/marketing-composer-intelligence.spec.ts`, because that is where
 * the claim can actually be tested.
 */
describe('composer intelligence', () => {
  describe('per-network limits', () => {
    /**
     * The case the ticket names. A draft over the limit for one selected network and inside it
     * for another must say so about the first and stay quiet about the second — a validator
     * that flagged both would pass a laxer version of this test.
     */
    it('flags one selected network and not the other', () => {
      const draft = { content: 'a'.repeat(NETWORK_LIMITS.x.characterLimit + 40), mediaCount: 0 };

      const violations = validateForNetworks(['x', 'facebook'], draft);

      expect(violations).toHaveLength(1);
      expect(violations[0]?.platform).toBe('x');
      expect(violations[0]?.code).toBe('character_limit');
      expect(violations[0]?.message).toContain('280');
    });

    it('counts media, mentions and hashtags against the network that caps them', () => {
      expect(
        validateForNetwork('x', { content: 'ok', mediaCount: 5 }).map((v) => v.code),
      ).toEqual(['media_count']);

      expect(
        validateForNetwork('google_business', { content: 'Visit https://halcyon.test today' }).map(
          (v) => v.code,
        ),
      ).toContain('link_unsupported');
    });
  });

  describe('linting', () => {
    it('warns and never blocks', () => {
      const warnings = lintDraft(
        'ACT NOW — LIMITED TIME GUARANTEED WINNER OFFER FOR EVERY SINGLE CUSTOMER TODAY',
        [],
      );

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.every((warning) => warning.severity === 'warning')).toBe(true);
      expect(warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining(['spam_words', 'all_caps']),
      );
    });

    it('says when a link will be stripped or de-prioritised on a selected network', () => {
      const warnings = lintDraft('Read the whole thing at https://halcyon.test/post', [
        'linkedin',
        'facebook',
      ]);

      const links = warnings.filter((warning) => warning.code === 'link_handling');
      expect(links).toHaveLength(1);
      expect(links[0]?.message).toContain('LinkedIn');
    });

    it('stays quiet on a short, ordinary caption', () => {
      expect(lintDraft('New colours land on Friday. Come and have a look.', ['instagram'])).toEqual(
        [],
      );
    });
  });

  describe('hook formulas and snippets', () => {
    /**
     * The case the ticket names: a template applied to a draft that already has text. The
     * existing draft survives — eating what somebody typed is the one thing a composer must
     * never do.
     */
    it('appends to a draft that already has text rather than replacing it', () => {
      const existing = 'Half-written thought I want to keep.';
      const formula = HOOK_FORMULAS.find((entry) => entry.id === 'pas');
      expect(formula).toBeDefined();

      const filled = applyTemplate(formula!.skeleton, {
        subject: 'stock counts',
        brand: 'Halcyon',
        cta: 'Link in bio',
      });
      const result = appendTemplate(existing, filled);

      expect(result.startsWith(existing)).toBe(true);
      expect(result).toContain('stock counts');
      expect(result).toContain('Halcyon');
      expect(result).toContain('Link in bio');
      expect(result).not.toContain('{subject}');
    });

    it('substitutes literally, over a closed key set, and touches nothing else', () => {
      const filled = applyTemplate('{subject} · {brand} · {cta} · {secret} · {{subject}}', {
        subject: '{brand}',
        brand: 'Halcyon',
        cta: 'Buy',
      });

      // `{secret}` is not a key, so it survives verbatim: there is no dynamic lookup here.
      expect(filled).toContain('{secret}');
      // The value that looks like a placeholder is inserted as text, not re-expanded.
      expect(filled.startsWith('{brand} · Halcyon')).toBe(true);
    });

    it('leaves a placeholder in place when the user has given it no value', () => {
      expect(applyTemplate('Hello {subject}', {})).toBe('Hello {subject}');
    });

    it('uses the filled skeleton whole when the draft is empty', () => {
      expect(appendTemplate('   ', 'Filled')).toBe('Filled');
    });
  });
});
