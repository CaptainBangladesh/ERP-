import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MARKETING_JOB_TYPES,
  MARKETING_PATHS,
  type CancelJobResponse,
  type MarketingJobListResponse,
  type MarketingJobResponse,
  type MarketingJobStatus,
  type MarketingJobSummary,
  type MarketingJobType,
  type RetryJobResponse,
  type ScheduleJobRequest,
} from '@erp/shared';
import { Button, Modal, Select } from '@erp/shared/ui';
import { api, ApiFailure } from '../../../api/client';

const STATUS_BADGES: Record<MarketingJobStatus, { bg: string; text: string; label: string; icon: string }> = {
  PENDING: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-800', label: 'Pending', icon: '⏳' },
  PROCESSING: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800', label: 'Processing', icon: '⚙️' },
  COMPLETED: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-800', label: 'Completed', icon: '✅' },
  FAILED: { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-800', label: 'Failed', icon: '⚠️' },
  CANCELLED: { bg: 'bg-zinc-100 border-zinc-200', text: 'text-zinc-600', label: 'Cancelled', icon: '🚫' },
};

const TYPE_LABELS: Record<string, string> = {
  publish_social_post: 'Publish Social Post',
  cycle_autolist: 'Cycle Autolist Queue',
  sync_ad_metrics: 'Sync Ad Metrics',
  sync_social_inbox: 'Sync Social Inbox',
  send_drip_email: 'Send Drip Nurture Email',
  sync_social_account_tokens: 'Refresh Expiring Tokens',
};

export function JobQueueMonitor() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [newJobType, setNewJobType] = useState<string>('publish_social_post');
  const [newJobPayloadText, setNewJobPayloadText] = useState('{"message": "Scheduled test post"}');
  const [newJobDelayMinutes, setNewJobDelayMinutes] = useState(0);

  // Poll job list every 4 seconds to provide real-time queue visibility
  const { data: jobList, isLoading, refetch } = useQuery<MarketingJobListResponse>({
    queryKey: ['marketing-jobs'],
    queryFn: async () => {
      return api.get<MarketingJobListResponse>(MARKETING_PATHS.jobs);
    },
    refetchInterval: 4000,
  });

  const jobs = jobList?.items ?? [];

  // Mutations
  const scheduleMutation = useMutation({
    mutationFn: async (payload: ScheduleJobRequest) => {
      return api.post<MarketingJobResponse>(MARKETING_PATHS.jobs, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-jobs'] });
      setIsScheduleOpen(false);
      setNewJobPayloadText('{"message": "Scheduled test post"}');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return api.post<CancelJobResponse>(MARKETING_PATHS.cancelJob(jobId), {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-jobs'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      return api.post<RetryJobResponse>(MARKETING_PATHS.retryJob(jobId), {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-jobs'] });
    },
  });

  const filteredJobs = jobs.filter((j) => {
    if (statusFilter === 'ALL') return true;
    return j.status === statusFilter;
  });

  // Aggregate stats
  const stats = {
    total: jobs.length,
    pending: jobs.filter((j) => j.status === 'PENDING').length,
    processing: jobs.filter((j) => j.status === 'PROCESSING').length,
    completed: jobs.filter((j) => j.status === 'COMPLETED').length,
    failed: jobs.filter((j) => j.status === 'FAILED').length,
  };

  const submitSchedule = () => {
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = JSON.parse(newJobPayloadText);
    } catch {
      alert('Payload must be valid JSON');
      return;
    }

    const scheduledAt =
      newJobDelayMinutes > 0
        ? new Date(Date.now() + newJobDelayMinutes * 60 * 1000).toISOString()
        : new Date().toISOString();

    scheduleMutation.mutate({
      type: newJobType,
      payload: parsedPayload,
      scheduledAt,
      maxAttempts: 3,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            <span>⚡</span> Postgres Background Task Queue
          </h2>
          <p className="text-sm text-zinc-500 mt-1">
            Concurrency-protected queue powered by PostgreSQL atomic row locks and partial indexes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors shadow-sm"
          >
            <span>🔄</span> Refresh
          </button>
          <button
            type="button"
            onClick={() => setIsScheduleOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm shadow-indigo-200"
          >
            <span>➕</span> Schedule Task
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Tasks</span>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm">
          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
            <span>⏳</span> Pending
          </span>
          <p className="text-2xl font-bold text-amber-900 mt-1">{stats.pending}</p>
        </div>
        <div className="bg-blue-50/70 p-4 rounded-xl border border-blue-200 shadow-sm">
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-1">
            <span>⚙️</span> Processing
          </span>
          <p className="text-2xl font-bold text-blue-900 mt-1">{stats.processing}</p>
        </div>
        <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm">
          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
            <span>✅</span> Completed
          </span>
          <p className="text-2xl font-bold text-emerald-900 mt-1">{stats.completed}</p>
        </div>
        <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm">
          <span className="text-xs font-semibold text-rose-700 uppercase tracking-wider flex items-center gap-1">
            <span>⚠️</span> Failed
          </span>
          <p className="text-2xl font-bold text-rose-900 mt-1">{stats.failed}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-200 pb-2">
        <span className="text-xs font-medium text-zinc-400 mr-2">Filter status:</span>
        {['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === status
                ? 'bg-zinc-900 text-white shadow-sm'
                : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Jobs Table */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-zinc-500">
            <span className="animate-spin text-2xl inline-block mb-2">⚙️</span>
            <p>Loading queue tasks...</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <span className="text-3xl block mb-2">📭</span>
            <p className="font-medium text-zinc-700">No jobs match the current filter</p>
            <p className="text-xs text-zinc-400 mt-1">
              Tasks scheduled by social publishers, autolists, and drip campaigns will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-600">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Task Type</th>
                  <th className="px-6 py-3">Scheduled At</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Attempts</th>
                  <th className="px-6 py-3">Payload Preview</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {filteredJobs.map((job) => {
                  const badge = STATUS_BADGES[job.status] || STATUS_BADGES.PENDING;
                  const isPending = job.status === 'PENDING';
                  const isRetriable = job.status === 'FAILED' || job.status === 'CANCELLED';

                  return (
                    <tr key={job.id} className="hover:bg-zinc-50/60 transition-colors">
                      <td className="px-6 py-4 font-medium text-zinc-900">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-400">{job.id.slice(0, 8)}</span>
                          <span>{TYPE_LABELS[job.type] || job.type}</span>
                        </div>
                        {job.lastError && (
                          <p className="text-xs text-rose-600 font-mono mt-1 truncate max-w-xs" title={job.lastError}>
                            Error: {job.lastError}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-zinc-500">
                        {new Date(job.scheduledAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full border ${badge.bg} ${badge.text}`}
                        >
                          <span>{badge.icon}</span>
                          <span>{badge.label}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-zinc-600">
                        <span className="font-semibold">{job.attempts}</span> / {job.maxAttempts}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-zinc-500 max-w-xs truncate">
                        {JSON.stringify(job.payload)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                        {isPending && (
                          <button
                            type="button"
                            onClick={() => cancelMutation.mutate(job.id)}
                            disabled={cancelMutation.isPending}
                            className="text-rose-600 hover:text-rose-800 font-semibold px-2.5 py-1 bg-rose-50 hover:bg-rose-100 rounded-md border border-rose-200 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                        {isRetriable && (
                          <button
                            type="button"
                            onClick={() => retryMutation.mutate(job.id)}
                            disabled={retryMutation.isPending}
                            className="text-indigo-600 hover:text-indigo-800 font-semibold px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 transition-colors"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule Job Modal */}
      {isScheduleOpen && (
        <Modal
          onClose={() => setIsScheduleOpen(false)}
          title="Schedule Task"
          description="Puts one job on the queue this module owns. It runs on the next worker poll tick, or after the delay."
          icon="⚡"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsScheduleOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => submitSchedule()}
                disabled={scheduleMutation.isPending}
              >
                {scheduleMutation.isPending ? 'Scheduling…' : 'Confirm Schedule'}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitSchedule();
            }}
            className="flex flex-col gap-4"
          >
            <Select
              id="job-type"
              label="Task type"
              value={newJobType}
              onChange={setNewJobType}
              options={MARKETING_JOB_TYPES.map((type) => ({
                value: type,
                label: TYPE_LABELS[type] || type,
              }))}
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="job-delay" className="text-sm font-medium text-slate-700">
                Delay execution (minutes)
              </label>
              <input
                id="job-delay"
                type="number"
                min="0"
                max="1440"
                value={newJobDelayMinutes}
                onChange={(e) => setNewJobDelayMinutes(Number(e.target.value))}
                aria-describedby="job-delay-hint"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              />
              <span id="job-delay-hint" className="text-xs text-slate-500">
                {newJobDelayMinutes === 0
                  ? 'Executes on next worker poll tick'
                  : `Executes at ${new Date(Date.now() + newJobDelayMinutes * 60 * 1000).toLocaleTimeString()}`}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="job-payload" className="text-sm font-medium text-slate-700">
                JSON payload
              </label>
              <textarea
                id="job-payload"
                rows={4}
                value={newJobPayloadText}
                onChange={(e) => setNewJobPayloadText(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
              />
            </div>

            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </Modal>
      )}
    </div>
  );
}
