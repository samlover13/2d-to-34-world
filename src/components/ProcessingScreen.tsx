import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ConversionJob,
  PIPELINE_STAGES,
  buildMediaUrl,
  formatDuration,
  formatTimeShort,
} from '../types';

interface ProcessingScreenProps {
  job: ConversionJob;
  onBackHome: () => void;
  onOpenResult: () => void;
  onResumeJob: (jobId: string) => Promise<string | null>;
}

export function ProcessingScreen({
  job,
  onBackHome,
  onOpenResult,
  onResumeJob,
}: ProcessingScreenProps) {
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const isNanoBananaFrames = job.conversionMode === 'nano_banana_frames';

  useEffect(() => {
    const startMs = new Date(job.createdAt).getTime();
    const updateElapsed = () => {
      const endMs =
        job.status === 'completed' || job.status === 'failed'
          ? new Date(job.updatedAt).getTime()
          : Date.now();
      setElapsedSec(Math.max(0, Math.floor((endMs - startMs) / 1000)));
    };
    updateElapsed();
    if (job.status !== 'processing' && job.status !== 'queued') return;
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [job.createdAt, job.updatedAt, job.status]);

  const handleResume = async () => {
    setIsResuming(true);
    setResumeError(null);
    try {
      const err = await onResumeJob(job.jobId);
      if (err) {
        setResumeError(err);
      }
    } finally {
      setIsResuming(false);
    }
  };

  const getStageLabel = (stageId: number, fallback: string): string => {
    if (stageId === 7) {
      return isNanoBananaFrames
        ? 'Nano Banana generating 3D frames'
        : 'Veo generating 3D scenes';
    }
    if (stageId === 8) {
      return isNanoBananaFrames
        ? 'Stitching 3D frame sequence'
        : 'Combining generated scenes';
    }
    return fallback;
  };

  const completedFramesCount = job.frames.filter((f) => f.status === 'completed').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-200 dark:border-white/8">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackHome}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#131720] flex items-center justify-center text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-[#1A1F2B] shrink-0"
            aria-label="Back to Studio Home"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50 truncate">
              Converting to {job.visualStyleLabel}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums truncate">
              {job.originalFilename} ·{' '}
              <span className="font-sans">
                {isNanoBananaFrames ? 'Nano Banana Frame-by-Frame' : 'Veo Scene Synthesis'}
              </span>{' '}
              · {formatDuration(job.metadata.durationSec)} · {job.metadata.width}x
              {job.metadata.height} ({job.metadata.orientation})
              {job.nanoBananaImagesUsed > 0
                ? ` · ${job.nanoBananaImagesUsed} Nano Banana images used`
                : ''}
            </p>
          </div>
        </div>

        {job.status === 'completed' && (
          <button
            type="button"
            onClick={onOpenResult}
            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>Open Result Screen</span>
          </button>
        )}
      </div>

      {/* Real Progress Header Card */}
      <section className="mt-6 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Stage {job.currentStage} of 10
            </p>
            <h2 className="font-display text-xl font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
              {job.currentStageLabel}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">{job.stageDetail}</p>
          </div>

          <div className="text-left sm:text-right shrink-0">
            <p className="font-display text-3xl font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
              {job.progress}%
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
              Elapsed {formatDuration(elapsedSec)}
              {job.estimatedSecondsRemaining !== null && job.status === 'processing'
                ? ` · Est. remaining ~${formatDuration(job.estimatedSecondsRemaining)}`
                : ''}
            </p>
          </div>
        </div>

        {/* Real Progress Bar */}
        <div className="mt-4 h-2.5 w-full rounded-full bg-zinc-200 dark:bg-white/8 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              job.status === 'failed'
                ? 'bg-red-500'
                : job.status === 'completed'
                  ? 'bg-emerald-500'
                  : 'bg-blue-600'
            }`}
            style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
          />
        </div>

        {/* Error & Resumable Checkpoint Alert */}
        {job.status === 'failed' && job.errorMessage && (
          <div
            role="alert"
            className="mt-5 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-sm text-red-800 dark:text-red-200">
                <p className="font-semibold">Processing paused with an error</p>
                <p className="mt-0.5">{job.errorMessage}</p>
                <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">
                  Last completed checkpoint: Stage {job.lastCompletedStage} of 10. Resuming keeps
                  all extracted frames, character profiles, and{' '}
                  {isNanoBananaFrames
                    ? `${completedFramesCount} completed Nano Banana 3D frame(s).`
                    : 'all completed Veo scenes.'}
                </p>
                {resumeError && (
                  <p className="mt-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
                    {resumeError}
                  </p>
                )}
              </div>
            </div>

            {job.resumable && (
              <button
                type="button"
                onClick={handleResume}
                disabled={isResuming}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {isResuming ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                )}
                <span>Resume from Stage {Math.min(10, job.lastCompletedStage + 1)}</span>
              </button>
            )}
          </div>
        )}
      </section>

      {/* Main Grid: 10-Stage Checklist + Live Character, Frame & Scene Proof-of-Work */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: All 10 Pipeline Stages */}
        <section className="lg:col-span-5 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
          <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Pipeline Stages
          </h3>
          <ol className="space-y-2.5">
            {PIPELINE_STAGES.map((stage) => {
              const isCompleted =
                job.status === 'completed' || stage.id <= job.lastCompletedStage;
              const isCurrent =
                job.status !== 'completed' && stage.id === job.currentStage;
              const isFailedHere = job.status === 'failed' && isCurrent;

              return (
                <li
                  key={stage.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                    isCurrent
                      ? isFailedHere
                        ? 'border-red-300 dark:border-red-500/30 bg-red-50/70 dark:bg-red-500/10'
                        : 'border-blue-300 dark:border-blue-500/40 bg-blue-50/70 dark:bg-blue-500/10'
                      : 'border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isCompleted ? (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : isFailedHere ? (
                      <XCircle
                        className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0"
                        aria-hidden="true"
                      />
                    ) : isCurrent ? (
                      <Loader2
                        className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <Circle
                        className="w-4 h-4 text-zinc-300 dark:text-zinc-700 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`text-sm truncate ${
                        isCompleted
                          ? 'text-zinc-900 dark:text-zinc-100 font-medium'
                          : isCurrent
                            ? 'text-zinc-950 dark:text-white font-semibold'
                            : 'text-zinc-500 dark:text-zinc-500'
                      }`}
                    >
                      {stage.id}. {getStageLabel(stage.id, stage.label)}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 shrink-0">
                    {isCompleted ? 'Done' : isFailedHere ? 'Paused' : isCurrent ? 'Active' : 'Queued'}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Right: Character Consistency Registry + Nano Banana Frames + Scene Timeline */}
        <div className="lg:col-span-7 space-y-6">
          {/* Live Nano Banana Frame-by-Frame Queue */}
          {isNanoBananaFrames && (
            <section className="bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    Nano Banana Frame-by-Frame Render Queue
                  </h3>
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                  {completedFramesCount} / {job.frames.length} frames · {job.targetFps} FPS
                </span>
              </div>

              {job.frames.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
                  Sequential 2D frames will appear here once Stage 2 finishes extracting frames
                  within your daily Nano Banana limit.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                  {job.frames.map((frame) => {
                    const srcUrl = buildMediaUrl(
                      `/api/jobs/${job.jobId}/assets/${frame.sourceAsset}`,
                      job.mediaToken
                    );
                    const renderedUrl = frame.renderedAsset
                      ? buildMediaUrl(
                          `/api/jobs/${job.jobId}/assets/${frame.renderedAsset}`,
                          job.mediaToken
                        )
                      : null;

                    return (
                      <div
                        key={frame.frameIndex}
                        className="p-3 rounded-xl bg-zinc-50 dark:bg-[#0E1118] border border-zinc-200/80 dark:border-white/6 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300 font-medium">
                            Frame #{frame.frameIndex + 1} · {formatTimeShort(frame.timestampSec)}
                          </span>
                          <span
                            className={`font-medium ${
                              frame.status === 'completed'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : frame.status === 'generating'
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : frame.status === 'failed'
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-zinc-500'
                            }`}
                          >
                            {frame.status === 'completed'
                              ? '3D Rendered'
                              : frame.status === 'generating'
                                ? 'Nano Banana...'
                                : frame.status === 'failed'
                                  ? 'Paused'
                                  : 'Queued'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="relative aspect-video rounded-lg overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-white/10">
                            <img
                              src={srcUrl}
                              alt={`Frame ${frame.frameIndex + 1} 2D source`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] font-medium text-white">
                              2D
                            </span>
                          </div>

                          <div className="relative aspect-video rounded-lg overflow-hidden bg-zinc-900 border border-zinc-200 dark:border-white/10 flex items-center justify-center">
                            {renderedUrl ? (
                              <>
                                <img
                                  src={renderedUrl}
                                  alt={`Frame ${frame.frameIndex + 1} 3D Nano Banana output`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-blue-600/90 text-[10px] font-medium text-white">
                                  3D
                                </span>
                              </>
                            ) : frame.status === 'generating' ? (
                              <Loader2
                                className="w-4 h-4 text-blue-400 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <span className="text-[11px] text-zinc-500 font-mono">Waiting</span>
                            )}
                          </div>
                        </div>

                        {frame.errorMessage && (
                          <p className="text-[11px] text-red-600 dark:text-red-400 line-clamp-2">
                            {frame.errorMessage}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Character Consistency Engine */}
          <section className="bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Character Consistency Registry
                </h3>
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                {job.characters.length} profile{job.characters.length === 1 ? '' : 's'}
              </span>
            </div>

            {job.characters.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
                Waiting for Gemini full-video analysis to identify characters and lock consistent
                3D reference profiles...
              </p>
            ) : (
              <div className="space-y-4">
                {job.characters.map((char) => (
                  <div
                    key={char.characterId}
                    className="p-4 rounded-xl bg-zinc-50 dark:bg-[#0E1118] border border-zinc-200/80 dark:border-white/6 flex flex-col sm:flex-row gap-4"
                  >
                    <div className="flex gap-2 shrink-0">
                      {char.sourceFaceAsset && (
                        <div className="w-20 h-20 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10">
                          <img
                            src={buildMediaUrl(
                              `/api/jobs/${job.jobId}/assets/${char.sourceFaceAsset}`,
                              job.mediaToken
                            )}
                            alt={`${char.name} 2D source frame`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      {char.animeRefAsset && (
                        <div className="w-20 h-20 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-900 border border-blue-500/40">
                          <img
                            src={buildMediaUrl(
                              `/api/jobs/${job.jobId}/assets/${char.animeRefAsset}`,
                              job.mediaToken
                            )}
                            alt={`${char.name} 3D reference portrait`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                          {char.name}
                        </span>
                        <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                          · {char.characterId} · Ref @ {formatTimeShort(char.bestFrameTimestampSec)}
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div>
                          <dt className="inline text-zinc-500 dark:text-zinc-400">Hair: </dt>
                          <dd className="inline text-zinc-800 dark:text-zinc-200">
                            {char.hairStyleAndColor}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-zinc-500 dark:text-zinc-400">Eyes: </dt>
                          <dd className="inline text-zinc-800 dark:text-zinc-200">
                            {char.eyeShapeAndColor}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-zinc-500 dark:text-zinc-400">Outfit: </dt>
                          <dd className="inline text-zinc-800 dark:text-zinc-200">
                            {char.clothingAndAccessories}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline text-zinc-500 dark:text-zinc-400">Palette: </dt>
                          <dd className="inline text-zinc-800 dark:text-zinc-200">
                            {char.colorPalette}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Scene Breakdown */}
          <section className="bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h3 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {isNanoBananaFrames ? 'Detected Scene Context' : 'Scene-by-Scene Veo Queue'}
              </h3>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                {isNanoBananaFrames
                  ? `${job.scenes.length} scene${job.scenes.length === 1 ? '' : 's'} analyzed`
                  : `${job.scenes.filter((s) => s.status === 'completed').length} / ${job.scenes.length} scenes`}
              </span>
            </div>

            {job.scenes.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
                Scene boundaries and conversion instructions will appear once Stage 6 completes.
              </p>
            ) : (
              <div className="space-y-3">
                {job.scenes.map((scene) => (
                  <div
                    key={scene.sceneIndex}
                    className="p-3.5 rounded-xl bg-zinc-50 dark:bg-[#0E1118] border border-zinc-200/80 dark:border-white/6 flex items-start gap-3.5"
                  >
                    {scene.keyframeAsset && (
                      <div className="w-20 aspect-video rounded-lg overflow-hidden bg-zinc-900 shrink-0 border border-zinc-200 dark:border-white/10">
                        <img
                          src={buildMediaUrl(
                            `/api/jobs/${job.jobId}/assets/${scene.keyframeAsset}`,
                            job.mediaToken
                          )}
                          alt={`Scene ${scene.sceneIndex + 1} starting keyframe`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                          Scene {scene.sceneIndex + 1} · {formatTimeShort(scene.startSec)} –{' '}
                          {formatTimeShort(scene.endSec)}
                        </p>
                        {!isNanoBananaFrames && (
                          <span
                            className={`text-xs font-medium ${
                              scene.status === 'completed'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : scene.status === 'generating'
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : scene.status === 'failed'
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-zinc-500'
                            }`}
                          >
                            {scene.status === 'completed'
                              ? 'Rendered'
                              : scene.status === 'generating'
                                ? 'Veo Generating...'
                                : scene.status === 'failed'
                                  ? 'Failed'
                                  : 'Pending'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                        {scene.summary}
                      </p>
                      {scene.characterIds.length > 0 && (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono">
                          Locked characters: {scene.characterIds.join(', ')}
                        </p>
                      )}
                      {scene.errorMessage && (
                        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                          {scene.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
