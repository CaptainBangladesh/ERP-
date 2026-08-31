import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';
import { MailboxesModal } from './MailboxesModal';
import { EmailTemplatesModal } from './EmailTemplatesModal';
import { SendEmailModal } from './SendEmailModal';
import { api } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('CRM Outreach Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MailboxesModal', () => {
    it('renders connected mailboxes and initiates connect url flow', async () => {
      (api.get as any).mockResolvedValueOnce({
        items: [
          {
            id: 'mb_1',
            userId: 'user_1',
            provider: 'gmail',
            emailAddress: 'sales@gmail.com',
            displayName: 'Sales Gmail',
            status: 'connected',
            connectedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      render(<MailboxesModal isOpen={true} onClose={vi.fn()} />);

      expect(await screen.findByText('Sales Gmail')).toBeInTheDocument();
      expect(screen.getByText('sales@gmail.com')).toBeInTheDocument();
      expect(screen.getByText('Connect Gmail')).toBeInTheDocument();

      // Connecting sends the popup to the provider's own consent screen — the only way a
      // mailbox gets connected. There is no second path that asks our own callback for one.
      (api.post as any).mockResolvedValueOnce({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=mbs_123',
        stateToken: 'mbs_123',
      });

      const popup = { location: { href: '' }, closed: false, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

      try {
        fireEvent.click(screen.getByText('Connect Gmail'));

        await waitFor(() => {
          expect(api.post).toHaveBeenCalledWith('/api/crm/mailboxes/connect-url', {
            provider: 'gmail',
          });
        });

        await waitFor(() =>
          expect(popup.location.href).toBe(
            'https://accounts.google.com/o/oauth2/v2/auth?state=mbs_123',
          ),
        );

        // Nothing is connected here, so nothing is fetched as though something were.
        expect(api.get).toHaveBeenCalledTimes(1);
      } finally {
        open.mockRestore();
      }
    });

    it('adds a company mailbox from its SMTP settings, with no popup at all', async () => {
      (api.get as any).mockResolvedValueOnce({ items: [] });

      render(<MailboxesModal isOpen={true} onClose={vi.fn()} />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());

      fireEvent.click(screen.getByText(/add company mailbox/i));

      fireEvent.change(screen.getByLabelText('Host'), {
        target: { value: 'mail.privateemail.com' },
      });
      fireEvent.change(screen.getByLabelText('Email address'), {
        target: { value: 'sales@northwind.test' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'a-real-password' },
      });

      (api.post as any).mockResolvedValueOnce({ id: 'mb_2', provider: 'smtp' });
      (api.get as any).mockResolvedValueOnce({ items: [] });

      fireEvent.click(screen.getByRole('button', { name: /^add mailbox$/i }));

      await waitFor(() =>
        expect(api.post).toHaveBeenCalledWith(
          '/api/crm/mailboxes/smtp',
          expect.objectContaining({
            host: 'mail.privateemail.com',
            port: 465,
            secure: true,
            emailAddress: 'sales@northwind.test',
            password: 'a-real-password',
            // Left blank, so it falls back to the address rather than being sent empty.
            username: 'sales@northwind.test',
          }),
        ),
      );
    });

    it('reports a connection the popup says did not happen', async () => {
      (api.get as any).mockResolvedValueOnce({ items: [] });

      render(<MailboxesModal isOpen={true} onClose={vi.fn()} />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());

      const fetchesBefore = (api.get as any).mock.calls.length;

      // What the callback page posts back when the provider would not name the account.
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            type: 'MAILBOX_CONNECTION_RESULT',
            connected: false,
            message: 'The mailbox provider did not confirm the account.',
          },
        }),
      );

      expect(
        await screen.findByText(/did not confirm the account/i),
      ).toBeInTheDocument();
      // A failure is not a reason to re-read the list — there is nothing new in it.
      expect((api.get as any).mock.calls.length).toBe(fetchesBefore);
    });
  });

  describe('EmailTemplatesModal', () => {
    it('renders template list and creates a new template', async () => {
      (api.get as any).mockResolvedValueOnce({
        items: [
          {
            id: 'tpl_1',
            name: 'Welcome Template',
            subject: 'Hello {{lead.name}}',
            body: '<p>Welcome</p>',
            createdByUserId: 'usr_1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      render(<EmailTemplatesModal isOpen={true} onClose={vi.fn()} />);

      expect(await screen.findByText('Welcome Template')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /New template/i }));

      expect(screen.getByRole('heading', { name: 'New template' })).toBeInTheDocument();

      // Fill out form
      fireEvent.change(screen.getByPlaceholderText('e.g. Sales intro and demo pitch'), {
        target: { value: 'Follow Up' },
      });
      fireEvent.change(screen.getByPlaceholderText('Subject line with {{lead.name}}...'), {
        target: { value: 'Checking in {{lead.name}}' },
      });
      fireEvent.change(
        screen.getByPlaceholderText('<p>Hi {{lead.name}},</p><p>Welcome aboard.</p>'),
        { target: { value: '<p>Hi {{lead.name}}</p>' } },
      );

      (api.post as any).mockResolvedValueOnce({
        id: 'tpl_2',
        name: 'Follow Up',
        subject: 'Checking in {{lead.name}}',
        body: '<p>Hi {{lead.name}}</p>',
        createdByUserId: 'usr_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      (api.get as any).mockResolvedValueOnce({ items: [] });

      fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api/crm/email-templates', {
          name: 'Follow Up',
          subject: 'Checking in {{lead.name}}',
          body: '<p>Hi {{lead.name}}</p>',
        });
      });
    });
  });

  describe('SendEmailModal', () => {
    it('selects mailbox and template, then sends 1-on-1 email', async () => {
      (api.get as any).mockImplementation((url: string) => {
        if (url === '/api/crm/mailboxes') {
          return Promise.resolve({
            items: [
              {
                id: 'mb_1',
                displayName: 'Sales Rep',
                emailAddress: 'rep@company.com',
                status: 'connected',
              },
            ],
          });
        }
        if (url === '/api/crm/email-templates') {
          return Promise.resolve({
            items: [
              {
                id: 'tpl_1',
                name: 'Intro Pitch',
                subject: 'Hello {{lead.name}}',
                body: '<p>Hi {{lead.name}}, nice to meet you!</p>',
              },
            ],
          });
        }
        return Promise.resolve({});
      });

      const handleSuccess = vi.fn();
      const handleClose = vi.fn();

      render(
        <SendEmailModal
          isOpen={true}
          leadId="lead_123"
          leadName="Alice Smith"
          leadEmail="alice@smith.test"
          onClose={handleClose}
          onSuccess={handleSuccess}
        />,
      );

      expect(await screen.findByRole('heading', { name: /Email Alice Smith/ })).toBeInTheDocument();
      expect(screen.getByText('Sales Rep (rep@company.com)')).toBeInTheDocument();

      // Select template
      fireEvent.change(screen.getByLabelText('Template'), {
        target: { value: 'tpl_1' },
      });

      // Click Send
      (api.post as any).mockResolvedValueOnce({
        success: true,
        activityId: 'act_99',
      });

      fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api/crm/leads/lead_123/send-email', {
          mailboxConnectionId: 'mb_1',
          templateId: 'tpl_1',
          subject: undefined,
          htmlBody: undefined,
        });
        expect(handleSuccess).toHaveBeenCalled();
        expect(handleClose).toHaveBeenCalled();
      });
    });
  });
});
