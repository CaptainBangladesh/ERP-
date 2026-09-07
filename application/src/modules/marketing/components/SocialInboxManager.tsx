import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_PATHS,
  type ConvertConversationToLeadRequest,
  type ConvertConversationToLeadResponse,
  type CreateDmAutomationFlowRequest,
  type DmAutomationFlowListResponse,
  type DmAutomationFlowSummary,
  type SendSocialMessageRequest,
  type SocialConversationListResponse,
  type SocialConversationSummary,
  type SocialMessageListResponse,
  type SocialMessageStatus,
} from '@erp/shared';
import { api } from '../../../api/client';

export function SocialInboxManager({
  brandId,
  brandName,
}: {
  brandId: string;
  brandName: string;
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'inbox' | 'flows'>('inbox');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // Outbound Reply State
  const [replyText, setReplyText] = useState('');

  // Convert to CRM Lead State
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadOrganisation, setLeadOrganisation] = useState('');
  const [convertResult, setConvertResult] = useState<ConvertConversationToLeadResponse | null>(null);

  // New DM Automation Flow State
  const [showFlowModal, setShowFlowModal] = useState(false);
  const [newFlow, setNewFlow] = useState<Partial<CreateDmAutomationFlowRequest>>({
    name: '',
    triggerKeyword: '',
    matchType: 'EXACT',
    responseTemplate: 'Thanks for reaching out! Grab your free guide here: {{leadMagnetUrl}}',
    leadMagnetUrl: '',
    isActive: true,
  });

  // 1. Fetch Conversations
  const conversationsQuery = useQuery({
    queryKey: ['marketing', 'inbox', 'conversations', brandId, selectedStatus],
    queryFn: () =>
      api.get<SocialConversationListResponse>(
        `${MARKETING_PATHS.inboxConversations}?brandId=${brandId}${
          selectedStatus !== 'all' ? `&status=${selectedStatus}` : ''
        }`,
      ),
  });

  const conversations = conversationsQuery.data?.items ?? [];
  const activeConversation: SocialConversationSummary | null =
    conversations.find((c) => c.conversationId === selectedConversationId) ??
    conversations[0] ??
    null;

  // 2. Fetch Messages in active thread
  const messagesQuery = useQuery({
    queryKey: ['marketing', 'inbox', 'messages', brandId, activeConversation?.conversationId],
    queryFn: () => {
      if (!activeConversation) return { items: [], page: { number: 1, size: 0, total: 0, pages: 0 } };
      return api.get<SocialMessageListResponse>(
        `${MARKETING_PATHS.inboxMessages}?brandId=${brandId}&conversationId=${activeConversation.conversationId}`,
      );
    },
    enabled: !!activeConversation,
  });

  const messages = messagesQuery.data?.items ?? [];

  // 3. Fetch DM Automation Flows
  const flowsQuery = useQuery({
    queryKey: ['marketing', 'dm-flows', brandId],
    queryFn: () =>
      api.get<DmAutomationFlowListResponse>(`${MARKETING_PATHS.dmFlows}?brandId=${brandId}`),
  });

  const flows = flowsQuery.data?.items ?? [];

  // Mutations
  const sendReplyMutation = useMutation({
    mutationFn: (req: SendSocialMessageRequest) =>
      api.post(MARKETING_PATHS.inboxReply, req),
    onSuccess: () => {
      setReplyText('');
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'inbox'] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ conversationId, status }: { conversationId: string; status: SocialMessageStatus }) =>
      api.patch(MARKETING_PATHS.inboxConversationStatus(conversationId), {
        status,
        brandId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'inbox'] });
    },
  });

  const convertToLeadMutation = useMutation({
    mutationFn: (req: ConvertConversationToLeadRequest) =>
      api.post<ConvertConversationToLeadResponse>(MARKETING_PATHS.inboxConvertToLead, req),
    onSuccess: (data) => {
      setConvertResult(data);
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'inbox'] });
    },
  });

  const createFlowMutation = useMutation({
    mutationFn: (req: CreateDmAutomationFlowRequest) =>
      api.post(MARKETING_PATHS.dmFlows, req),
    onSuccess: () => {
      setShowFlowModal(false);
      setNewFlow({
        name: '',
        triggerKeyword: '',
        matchType: 'EXACT',
        responseTemplate: 'Thanks for reaching out! Grab your free guide here: {{leadMagnetUrl}}',
        leadMagnetUrl: '',
        isActive: true,
      });
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'dm-flows', brandId] });
    },
  });

  const deleteFlowMutation = useMutation({
    mutationFn: (flowId: string) =>
      api.delete(MARKETING_PATHS.dmFlow(flowId)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketing', 'dm-flows', brandId] });
    },
  });

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !activeConversation) return;

    sendReplyMutation.mutate({
      brandId,
      conversationId: activeConversation.conversationId,
      content: replyText.trim(),
      recipientId: activeConversation.senderId,
      socialAccountId: activeConversation.socialAccountId ?? undefined,
    });
  };

  const handleOpenConvertModal = () => {
    if (!activeConversation) return;
    setLeadName(activeConversation.senderName || '');
    setLeadEmail('');
    setLeadPhone('');
    setLeadOrganisation('');
    setConvertResult(null);
    setShowConvertModal(true);
  };

  const handleConvertSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation) return;

    convertToLeadMutation.mutate({
      brandId,
      conversationId: activeConversation.conversationId,
      name: leadName.trim() || undefined,
      email: leadEmail.trim() || undefined,
      phone: leadPhone.trim() || undefined,
      organisationName: leadOrganisation.trim() || undefined,
    });
  };

  const cannedResponses = [
    'Thanks for reaching out! How can we assist you today?',
    'Here is our latest product catalog and pricing overview.',
    'Would you like to schedule a 15-minute discovery call?',
    'Feel free to check out our knowledge base for instant answers!',
  ];

  const getPlatformIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('instagram')) return '📸 Instagram';
    if (p.includes('facebook') || p.includes('meta')) return '📘 Meta';
    if (p.includes('twitter') || p.includes('x')) return '🐦 X / Twitter';
    if (p.includes('linkedin')) return '💼 LinkedIn';
    if (p.includes('tiktok')) return '🎵 TikTok';
    return '💬 Direct';
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Subnav & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Unified Social Inbox & DM Automation</h2>
          <p className="text-sm text-slate-600">
            Real-time messages across channels, ManyChat-style keyword auto-replies, and 1-click CRM lead conversion.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'inbox'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📥 Conversations & DMs ({conversations.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('flows')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'flows'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ⚡ Keyword DM Flows ({flows.length})
          </button>
        </div>
      </div>

      {activeTab === 'inbox' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[620px] bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {/* Left Column: Conversation List */}
          <div className="lg:col-span-4 border-r border-slate-200 flex flex-col h-full bg-slate-50/50">
            {/* Filter Bar */}
            <div className="p-3 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto">
              {['all', 'unread', 'pending', 'resolved'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSelectedStatus(st)}
                  className={`capitalize px-2.5 py-1 rounded-md text-xs font-medium transition ${
                    selectedStatus === st
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {conversations.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  <span className="text-3xl block mb-2">💬</span>
                  <p className="text-sm font-medium text-slate-700">No conversations found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Incoming DMs and comments from Meta and X will appear here in real-time.
                  </p>
                </div>
              ) : (
                conversations.map((conv) => {
                  const isSelected = activeConversation?.conversationId === conv.conversationId;
                  return (
                    <button
                      key={conv.conversationId}
                      type="button"
                      onClick={() => setSelectedConversationId(conv.conversationId)}
                      className={`w-full text-left p-3.5 transition flex items-start gap-3 ${
                        isSelected ? 'bg-blue-50/60 border-l-4 border-blue-600' : 'hover:bg-slate-100/70'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-200 to-slate-300 flex items-center justify-center font-bold text-slate-700 text-sm shrink-0">
                        {conv.senderName?.slice(0, 2).toUpperCase() || 'U'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-slate-900 text-sm truncate">
                            {conv.senderName}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {new Date(conv.latestMessageAt).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 truncate mt-0.5">
                          {conv.latestMessageContent}
                        </p>
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            {getPlatformIcon(conv.platform)}
                          </span>
                          {conv.unreadCount > 0 && (
                            <span className="bg-blue-600 text-white rounded-full px-1.5 py-0.2 text-[10px] font-bold">
                              {conv.unreadCount} new
                            </span>
                          )}
                          <span
                            className={`ml-auto text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                              conv.status === 'unread'
                                ? 'bg-amber-100 text-amber-800'
                                : conv.status === 'pending'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {conv.status}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active Thread Transcript & Reply */}
          <div className="lg:col-span-8 flex flex-col h-full bg-white">
            {activeConversation ? (
              <>
                {/* Thread Header */}
                <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-700 text-xs">
                      {activeConversation.senderName?.slice(0, 2).toUpperCase() || 'U'}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        {activeConversation.senderName}
                        <span className="text-xs font-normal text-slate-500">
                          ({getPlatformIcon(activeConversation.platform)})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-400">
                        Thread ID: {activeConversation.conversationId}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Status Dropdown */}
                    <select
                      value={activeConversation.status}
                      onChange={(e) =>
                        updateStatusMutation.mutate({
                          conversationId: activeConversation.conversationId,
                          status: e.target.value as SocialMessageStatus,
                        })
                      }
                      className="text-xs font-medium border border-slate-200 rounded-md px-2.5 py-1.5 bg-white text-slate-700 hover:border-slate-300 focus:outline-none"
                    >
                      <option value="unread">Status: Unread</option>
                      <option value="pending">Status: Pending</option>
                      <option value="resolved">Status: Resolved</option>
                    </select>

                    {/* Convert to CRM Lead Button */}
                    <button
                      type="button"
                      onClick={handleOpenConvertModal}
                      className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500 transition"
                    >
                      🧲 Convert to CRM Lead
                    </button>
                  </div>
                </div>

                {/* Messages Transcript */}
                <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-slate-50/30">
                  {messages.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 text-sm">
                      Loading messages...
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isInbound = msg.direction === 'inbound';
                      const isAutoReply = (msg.metadata as any)?.autoReply;
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
                        >
                          <div
                            className={`max-w-md rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                              isInbound
                                ? 'bg-white border border-slate-200 text-slate-800 rounded-bl-xs'
                                : isAutoReply
                                ? 'bg-indigo-600 text-white rounded-br-xs'
                                : 'bg-blue-600 text-white rounded-br-xs'
                            }`}
                          >
                            {isAutoReply && (
                              <div className="text-[10px] uppercase font-bold text-indigo-200 mb-1 flex items-center gap-1">
                                🤖 Auto-Replied via Keyword Flow
                              </div>
                            )}
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          </div>
                          <span className="text-[10px] text-slate-400 mt-1 px-1">
                            {msg.senderName || (isInbound ? 'Customer' : 'Team')} •{' '}
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Canned Responses Chips */}
                <div className="px-4 pt-2.5 bg-white border-t border-slate-100 flex items-center gap-2 overflow-x-auto">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">
                    Quick Insert:
                  </span>
                  {cannedResponses.map((canned, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setReplyText((prev) => (prev ? `${prev} ${canned}` : canned))}
                      className="shrink-0 text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 px-2.5 py-1 rounded-full border border-slate-200/80 transition"
                    >
                      {canned.slice(0, 28)}...
                    </button>
                  ))}
                </div>

                {/* Reply Form */}
                <form onSubmit={handleSendReply} className="p-4 bg-white border-t border-slate-200">
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply directly to ${activeConversation.senderName}...`}
                      className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    />
                    <button
                      type="submit"
                      disabled={!replyText.trim() || sendReplyMutation.isPending}
                      className="px-5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-50 transition flex items-center justify-center shrink-0"
                    >
                      {sendReplyMutation.isPending ? 'Sending...' : 'Send Reply'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400">
                <span className="text-4xl block mb-2">💬</span>
                <p className="text-base font-semibold text-slate-700">No conversation selected</p>
                <p className="text-xs text-slate-500 max-w-sm mt-1">
                  Select a message from the left to inspect conversation history, trigger canned responses, or convert to a CRM lead.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab 2: Keyword DM Automation Flows */
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Keyword-Triggered DM Flows</h3>
              <p className="text-xs text-slate-500">
                Automatically reply to inbound messages containing specific keywords (e.g. "GUIDE", "PRICING") with links and lead magnets.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFlowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-500 transition"
            >
              ➕ Create Automation Flow
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flows.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 bg-white">
                <span className="text-3xl block mb-2">⚡</span>
                <p className="text-sm font-semibold text-slate-800">No DM flows configured yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Create keyword triggers to deliver instant lead magnets when users comment or DM keywords like "GUIDE" or "DEMO".
                </p>
                <button
                  type="button"
                  onClick={() => setShowFlowModal(true)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  Create Your First Flow
                </button>
              </div>
            ) : (
              flows.map((flow) => (
                <div
                  key={flow.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="rounded-md bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-700 tracking-wide font-mono">
                        #{flow.triggerKeyword}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                        {flow.matchType} Match
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 mb-1">{flow.name}</h4>
                    <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5 border border-slate-100 font-mono text-[11px] leading-relaxed mb-3">
                      "{flow.responseTemplate}"
                    </p>

                    {flow.leadMagnetUrl && (
                      <div className="text-xs text-blue-600 truncate mb-3 flex items-center gap-1">
                        🔗 <span className="underline">{flow.leadMagnetUrl}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Triggered: <strong className="text-slate-800">{flow.triggerCount}</strong> times
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteFlowMutation.mutate(flow.id)}
                      className="text-red-500 hover:text-red-700 font-medium text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Convert to CRM Lead Modal */}
      {showConvertModal && activeConversation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Convert Conversation to CRM Lead</h3>
                <p className="text-xs text-slate-500">
                  Promotes this social conversation into a Sales CRM Lead and attaches the entire message history to its Activity Timeline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConvertModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {convertResult ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl mb-4 text-emerald-800 text-xs">
                <div className="font-bold text-sm mb-1 text-emerald-900">
                  🎉 Successfully Converted to CRM Lead!
                </div>
                <p>
                  <strong>Lead ID:</strong> {convertResult.leadId}
                </p>
                <p>
                  <strong>Lead Name:</strong> {convertResult.leadName}
                </p>
                <p>
                  <strong>Messages Attached to Activity:</strong> {convertResult.messageCount}
                </p>
                <div className="mt-4 text-right">
                  <button
                    type="button"
                    onClick={() => setShowConvertModal(false)}
                    className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConvertSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Contact / Lead Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={leadEmail}
                      onChange={(e) => setLeadEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={leadPhone}
                      onChange={(e) => setLeadPhone(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Organization / Company Name
                  </label>
                  <input
                    type="text"
                    value={leadOrganisation}
                    onChange={(e) => setLeadOrganisation(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                  ℹ️ The full message thread (<strong>{messages.length} messages</strong>) will be logged as an Activity Note and attributed to the Social Inbox.
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowConvertModal(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={convertToLeadMutation.isPending}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {convertToLeadMutation.isPending ? 'Converting...' : 'Confirm & Create Lead'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Create DM Flow Modal */}
      {showFlowModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">New Keyword DM Automation Flow</h3>
                <p className="text-xs text-slate-500">
                  Deliver instant replies, links, and lead magnets when audiences message trigger words.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowFlowModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createFlowMutation.mutate({
                  brandId,
                  name: newFlow.name!,
                  triggerKeyword: newFlow.triggerKeyword!,
                  matchType: newFlow.matchType,
                  responseTemplate: newFlow.responseTemplate!,
                  leadMagnetUrl: newFlow.leadMagnetUrl || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Flow Name *
                </label>
                <input
                  type="text"
                  required
                  value={newFlow.name}
                  onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })}
                  placeholder="e.g. Growth Guide Lead Magnet"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Trigger Keyword *
                  </label>
                  <input
                    type="text"
                    required
                    value={newFlow.triggerKeyword}
                    onChange={(e) => setNewFlow({ ...newFlow, triggerKeyword: e.target.value })}
                    placeholder="GUIDE"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Match Rule
                  </label>
                  <select
                    value={newFlow.matchType}
                    onChange={(e) => setNewFlow({ ...newFlow, matchType: e.target.value as any })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="EXACT">Exact Match (single keyword)</option>
                    <option value="CONTAINS">Contains Keyword in text</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Response Template *
                </label>
                <textarea
                  rows={3}
                  required
                  value={newFlow.responseTemplate}
                  onChange={(e) => setNewFlow({ ...newFlow, responseTemplate: e.target.value })}
                  placeholder="Hey! Grab your free guide here: {{leadMagnetUrl}}"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none font-mono text-xs"
                />
                <span className="text-[10px] text-slate-400">
                  Tip: Use <code className="text-indigo-600">{"{{leadMagnetUrl}}"}</code> or <code className="text-indigo-600">{"{{link}}"}</code> to insert the lead magnet URL.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lead Magnet URL / Link (Optional)
                </label>
                <input
                  type="url"
                  value={newFlow.leadMagnetUrl || ''}
                  onChange={(e) => setNewFlow({ ...newFlow, leadMagnetUrl: e.target.value })}
                  placeholder="https://acme.com/ebook.pdf"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFlowModal(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createFlowMutation.isPending}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {createFlowMutation.isPending ? 'Saving...' : 'Create Flow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
