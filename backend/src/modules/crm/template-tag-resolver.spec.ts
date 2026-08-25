import {
  htmlToPlainText,
  parseTemplateTags,
  resolveTemplate,
  validateTemplateTags,
} from './template-tag-resolver';

describe('template-tag-resolver', () => {
  it('parses tags with and without fallbacks', () => {
    const text = 'Hello {{lead.name|there}}, your industry is {{custom.industry}} from {{sender.displayName}}.';
    const tags = parseTemplateTags(text);

    expect(tags).toEqual([
      { raw: '{{lead.name|there}}', namespace: 'lead', field: 'name', fallback: 'there' },
      { raw: '{{custom.industry}}', namespace: 'custom', field: 'industry', fallback: undefined },
      { raw: '{{sender.displayName}}', namespace: 'sender', field: 'displayName', fallback: undefined },
    ]);
  });

  it('validates template tags against allowed namespaces and active custom field keys', () => {
    const activeCustomKeys = new Set(['industry', 'budget']);

    // Valid
    expect(() => {
      validateTemplateTags(
        'Hi {{lead.name|friend}}, working at {{lead.organisationName|your company}} in {{custom.industry|tech}} by {{sender.displayName}}',
        activeCustomKeys,
      );
    }).not.toThrow();

    // Invalid namespace
    expect(() => {
      validateTemplateTags('Hi {{user.name}}', activeCustomKeys);
    }).toThrow("Unknown tag namespace 'user'.");

    // Invalid lead field
    expect(() => {
      validateTemplateTags('Hi {{lead.secretField}}', activeCustomKeys);
    }).toThrow("Unknown field 'lead.secretField'.");

    // Invalid custom field key
    expect(() => {
      validateTemplateTags('Hi {{custom.unknownField}}', activeCustomKeys);
    }).toThrow("Unknown custom field key 'custom.unknownField'.");
  });

  it('resolves tags using context and applies fallbacks when values are missing', () => {
    const template = 'Hi {{lead.name|there}},\n\nWelcome to {{lead.organisationName|our platform}}! Your contact is {{sender.displayName|Sales Team}} ({{sender.emailAddress}}). Industry: {{custom.industry|General}}.';

    const context = {
      lead: {
        name: null, // Should trigger fallback 'there'
        organisationName: 'Acme Corp',
        email: 'alice@example.com',
      },
      custom: {
        industry: 'Software',
      },
      sender: {
        displayName: 'John Smith',
        emailAddress: 'john@mycompany.com',
      },
    };

    const resolved = resolveTemplate(template, context);

    expect(resolved).toContain('Hi there,');
    expect(resolved).toContain('Welcome to Acme Corp!');
    expect(resolved).toContain('Your contact is John Smith (john@mycompany.com).');
    expect(resolved).toContain('Industry: Software.');
  });

  it('converts HTML to plain text', () => {
    const html = '<h1>Welcome!</h1><p>Thank you for signing up.<br>We are excited to work with you.</p>';
    const text = htmlToPlainText(html);

    expect(text).toBe('Welcome!\nThank you for signing up.\nWe are excited to work with you.');
  });
});
