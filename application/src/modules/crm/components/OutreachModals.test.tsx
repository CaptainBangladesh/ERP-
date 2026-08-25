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

      // Trigger connect url
      (api.post as any).mockResolvedValueOnce({
        url: '/auth/url',
        stateToken: 'mbs_123',
      });
      (api.get as any).mockResolvedValueOnce({ success: true, mailboxId: 'mb_2' });
      (api.get as any).mockResolvedValueOnce({ items: [] });

      fireEvent.click(screen.getByText('Connect Gmail'));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api/crm/mailboxes/connect-url', {
          provider: 'gmail',
        });
      });
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
      expect(screen.getByText(/New Template/i)).toBeInTheDocument();

      // Click New Template
      fireEvent.click(screen.getByText(/New Template/i));

      expect(screen.getByText('New Template')).toBeInTheDocument();

      // Fill out form
      fireEvent.change(screen.getByPlaceholderText('e.g. Sales Intro & Demo Pitch'), {
        target: { value: 'Follow Up' },
      });
      fireEvent.change(screen.getByPlaceholderText('Subject line with {{lead.name}}...'), {
        target: { value: 'Checking in {{lead.name}}' },
      });
      fireEvent.change(
        screen.getByPlaceholderText('<p>Hi {{lead.name}},</p><p>Welcome to our platform!</p>'),
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

      fireEvent.click(screen.getByText('Save Template'));

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
      (api.get as any)
        .mockResolvedValueOnce({
          items: [
            {
              id: 'mb_1',
              displayName: 'Sales Rep',
              emailAddress: 'rep@company.com',
              status: 'connected',
            },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: 'tpl_1',
              name: 'Intro Pitch',
              subject: 'Hello {{lead.name}}',
              body: '<p>Hi {{lead.name}}, nice to meet you!</p>',
            },
          ],
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

      expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Sales Rep (rep@company.com)')).toBeInTheDocument();

      // Select template
      fireEvent.change(screen.getByLabelText(/Select Template/i), {
        target: { value: 'tpl_1' },
      });

      // Click Send
      (api.post as any).mockResolvedValueOnce({
        success: true,
        activityId: 'act_99',
      });

      fireEvent.click(screen.getByText('Send Email'));

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
