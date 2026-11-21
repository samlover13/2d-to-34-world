import { CheckCircle2, ChevronRight, Clock, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { ProcessingScreen } from './components/ProcessingScreen';
import { ProjectDeliverablesView } from './components/ProjectDeliverablesView';
import { ResultScreen } from './components/ResultScreen';
import { TopBar } from './components/TopBar';
import { AppScreen, ConversionJob, formatDuration } from './types';

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('home');
  const [isDark, setIsDark] = useState(true);
  const [recentJobs, setRecentJobs] = useState<ConversionJob[]>([]);
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs');
      if (!res.ok) return;
      const data = await res.json();
      setRecentJobs((data.jobs ?? []) as ConversionJob[]);
    } catch {
      // Transient fetch errors will retry on next poll
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Poll active job every 2.5s while queued or processing
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status !== 'queued' && activeJob.status !== 'processing') return;

    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${activeJob.jobId}`);
        if (!res.ok) return;
        const updated = (await res.json()) as ConversionJob;
        setActiveJob(updated);

        if (updated.status === 'completed') {
          fetchHistory();
          setScreen('result');
        } else if (updated.status === 'failed') {
          fetchHistory();
        }
      } catch {
        // Keep polling gracefully on transient network hiccups
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [activeJob, fetchHistory]);

  const handleJobStarted = (job: ConversionJob) => {
    setActiveJob(job);
    setScreen('processing');
    fetchHistory();
  };

  const handleOpenJob = (job: ConversionJob) => {
    setActiveJob(job);
    if (job.status === 'completed' && job.hasOutputVideo) {
      setScreen('result');
    } else {
      setScreen('processing');
    }
  };

  const handleResumeJob = async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}/resume`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.job) {
      setActiveJob(data.job as ConversionJob);
      fetchHistory();
    }
  };

  const handleTriggerUpload = () => {
    setScreen('home');
    window.setTimeout(() => {
      fileInputRef.current?.click();
    }, 60);
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0B0D12] text-zinc-900 dark:text-zinc-100 transition-colors">
      <TopBar
        activeScreen={screen}
        hasActiveJob={Boolean(activeJob)}
        onNavigate={(next) => {
          if (next === 'processing' && activeJob?.status === 'completed') {
            setScreen('result');
          } else {
            setScreen(next);
          }
        }}
        onTriggerUpload={handleTriggerUpload}
      />

      <main>
        {screen === 'home' && (
          <HomeScreen
            recentJobs={recentJobs}
            isDark={isDark}
            fileInputRef={fileInputRef}
            onToggleTheme={() => setIsDark((prev) => !prev)}
            onJobStarted={handleJobStarted}
            onOpenJob={handleOpenJob}
            onViewAllHistory={() => setScreen('history')}
          />
        )}

        {screen === 'processing' && activeJob && (
          <ProcessingScreen
            job={activeJob}
            onBackHome={() => setScreen('home')}
            onOpenResult={() => setScreen('result')}
            onResumeJob={handleResumeJob}
          />
        )}

        {screen === 'result' && activeJob && (
          <ResultScreen
            job={activeJob}
            onConvertAnother={() => {
              setScreen('home');
            }}
          />
        )}

        {screen === 'history' && (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
            <div className="pb-5 border-b border-zinc-200 dark:border-white/8 flex items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                  Conversion History
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Persistent SQLite history of all uploaded 2D cartoon videos and resumable jobs.
                </p>
              </div>
              <button
                type="button"
                onClick={fetchHistory}
                className="min-h-[44px] px-4 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#131720] text-sm font-medium inline-flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="mt-6 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl overflow-hidden divide-y divide-zinc-200/80 dark:divide-white/6">
              {recentJobs.length === 0 ? (
                <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  No conversion jobs recorded yet.
                </div>
              ) : (
                recentJobs.map((job) => (
                  <button
                    key={job.jobId}
                    type="button"
                    onClick={() => handleOpenJob(job)}
                    className="w-full text-left px-5 py-4 min-h-[68px] hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-white/6 flex items-center justify-center shrink-0">
                        {job.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        ) : job.status === 'failed' ? (
                          <RefreshCw className="w-4 h-4 text-red-600 dark:text-red-400" />
                        ) : (
                          <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {job.originalFilename}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
                          {formatDuration(job.metadata.durationSec)} · {job.metadata.width}x
                          {job.metadata.height} · {job.characters.length} character(s) ·{' '}
                          {job.scenes.length} scene(s) ·{' '}
                          <span className="font-sans">
                            {job.status === 'completed'
                              ? 'Completed'
                              : job.status === 'failed'
                                ? `Failed at Stage ${job.currentStage} (Resumable)`
                                : `${job.currentStageLabel} (${job.progress}%)`}
                          </span>
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {screen === 'deliverables' && <ProjectDeliverablesView />}
      </main>
    </div>
  );
}
