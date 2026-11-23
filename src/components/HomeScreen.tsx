import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Film,
  Layers,
  Loader2,
  LogOut,
  Moon,
  Play,
  RefreshCw,
  Sun,
  Upload,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConversionJob,
  ConversionMode,
  NanoBananaQuota,
  VISUAL_STYLE_OPTIONS,
  VisualStyleId,
  formatBytes,
  formatDuration,
} from '../types';
import { useAuth } from './AuthContext';

const SAMPLE_2D_IMG = '/src/assets/images/sample_2d_cartoon_frame_1795248082485.jpg';
const SAMPLE_3D_IMG = '/src/assets/images/sample_3d_anime_frame_1795248082337.jpg';
const CHAR_SHEET_IMG = '/src/assets/images/character_sheet_3d_anime_1795248079417.jpg';

const FPS_OPTIONS: Array<{ value: 'auto' | '1' | '2' | '3' | '4'; label: string }> = [
  { value: 'auto', label: 'Auto (Fit Limit)' },
  { value: '1', label: '1 FPS' },
  { value: '2', label: '2 FPS' },
  { value: '3', label: '3 FPS' },
  { value: '4', label: '4 FPS' },
];

interface LocalVideoSelection {
  file: File;
  previewUrl: string;
  durationSec: number;
  width: number;
  height: number;
}

interface HomeScreenProps {
  recentJobs: ConversionJob[];
  isDark: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleTheme: () => void;
  onJobStarted: (job: ConversionJob) => void;
  onOpenJob: (job: ConversionJob) => void;
  onViewAllHistory: () => void;
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.29A7.18 7.18 0 0 1 4.91 12c0-.79.14-1.56.38-2.29v-3.1H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.1C6.23 6.87 8.88 4.76 12 4.76Z"
      />
    </svg>
  );
}

export function HomeScreen({
  recentJobs,
  isDark,
  fileInputRef,
  onToggleTheme,
  onJobStarted,
  onOpenJob,
  onViewAllHistory,
}: HomeScreenProps) {
  const {
    user,
    authReady,
    isSigningIn,
    authError,
    quota,
    signInWithGoogle,
    signOutGoogle,
    getIdToken,
    updateQuota,
    savePreferences,
  } = useAuth();

  const [selectedVideo, setSelectedVideo] = useState<LocalVideoSelection | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<VisualStyleId>('pixar_3d');
  const [conversionMode, setConversionMode] = useState<ConversionMode>('nano_banana_frames');
  const [targetFpsOption, setTargetFpsOption] = useState<'auto' | '1' | '2' | '3' | '4'>('auto');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isPreparingSample, setIsPreparingSample] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [avatarError, setAvatarError] = useState(false);

  const activeStyleOption =
    VISUAL_STYLE_OPTIONS.find((opt) => opt.id === selectedStyle) ?? VISUAL_STYLE_OPTIONS[0];

  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.photoURL]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const frameBudgetPreview = useMemo(() => {
    const remaining = quota?.imagesRemaining ?? 100;
    const duration = selectedVideo?.durationSec ?? 6;
    if (conversionMode !== 'nano_banana_frames') return null;

    let effectiveFps: number;
    if (targetFpsOption === 'auto') {
      const fitBudget = Math.max(2, Math.min(36, remaining - 2));
      const computed = fitBudget / Math.max(1, duration);
      effectiveFps = Math.max(0.5, Math.min(4, Math.round(computed * 2) / 2));
    } else {
      effectiveFps = Number(targetFpsOption);
    }

    const desiredFrames = Math.max(2, Math.round(duration * effectiveFps));
    const cappedFrames = Math.max(0, Math.min(desiredFrames, Math.max(0, remaining)));
    const wasCapped = desiredFrames > remaining;
    return {
      effectiveFps,
      desiredFrames,
      cappedFrames,
      wasCapped,
      remaining,
    };
  }, [conversionMode, quota, selectedVideo, targetFpsOption]);

  const inspectSelectedFile = (file: File) => {
    setValidationError(null);
    const lowerName = file.name.toLowerCase();
    const isAllowedExt = lowerName.endsWith('.mp4') || lowerName.endsWith('.mov');
    const isAllowedMime =
      file.type === 'video/mp4' ||
      file.type === 'video/quicktime' ||
      file.type === '' ||
      file.type === 'application/octet-stream';

    if (!isAllowedExt && !isAllowedMime) {
      setValidationError('Unsupported format. Please select an MP4 or MOV cartoon video.');
      return;
    }

    if (file.size > 150 * 1024 * 1024) {
      setValidationError('Video file exceeds the 150 MB upload size limit.');
      return;
    }

    const url = URL.createObjectURL(file);
    const probeEl = document.createElement('video');
    probeEl.preload = 'metadata';
    probeEl.src = url;

    probeEl.onloadedmetadata = () => {
      const durationSec = probeEl.duration;
      const width = probeEl.videoWidth;
      const height = probeEl.videoHeight;

      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        URL.revokeObjectURL(url);
        setValidationError('Could not read video duration. Please upload a valid MP4 or MOV file.');
        return;
      }

      if (durationSec > 60.5) {
        URL.revokeObjectURL(url);
        setValidationError(
          `Selected video is ${durationSec.toFixed(1)}s long. Maximum supported duration is 60 seconds.`
        );
        return;
      }

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = url;
      setSelectedVideo({
        file,
        previewUrl: url,
        durationSec,
        width,
        height,
      });
    };

    probeEl.onerror = () => {
      URL.revokeObjectURL(url);
      setValidationError('Browser could not decode this video file. Please select an H.264 MP4 or MOV.');
    };
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) inspectSelectedFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) inspectSelectedFile(file);
  };

  const handleLoadSampleVideo = async () => {
    setValidationError(null);
    setIsPreparingSample(true);
    try {
      const res = await fetch('/api/sample-video', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not prepare sample 2D cartoon video.');
      }
      const videoRes = await fetch(data.url);
      if (!videoRes.ok) {
        throw new Error('Failed to fetch sample 2D cartoon MP4.');
      }
      const blob = await videoRes.blob();
      const sampleFile = new File([blob], data.filename || 'sample_2d_cartoon_6s.mp4', {
        type: 'video/mp4',
      });
      inspectSelectedFile(sampleFile);
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Unable to prepare sample video.'
      );
    } finally {
      setIsPreparingSample(false);
    }
  };

  const handleStartConversion = async () => {
    if (!user) {
      await signInWithGoogle();
      return;
    }
    if (!selectedVideo || isUploading) return;
    setValidationError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const idToken = await getIdToken();
      if (!idToken) {
        throw new Error('Your Google session expired. Please sign in with Google again.');
      }

      const formData = new FormData();
      formData.append('video', selectedVideo.file);
      formData.append('visual_style', selectedStyle);
      formData.append('conversion_mode', conversionMode);
      formData.append('target_fps', targetFpsOption);

      const responsePayload = await new Promise<{
        job: ConversionJob;
        quota?: NanoBananaQuota;
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/jobs');
        xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        };

        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && parsed.job) {
              resolve({
                job: parsed.job as ConversionJob,
                quota: parsed.quota as NanoBananaQuota | undefined,
              });
            } else {
              if (parsed.quota) {
                updateQuota(parsed.quota as NanoBananaQuota);
              }
              reject(new Error(parsed.error || `Upload rejected (${xhr.status}).`));
            }
          } catch {
            reject(new Error(`Server returned an unexpected response (${xhr.status}).`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error while uploading video. Please try again.'));
        };

        xhr.send(formData);
      });

      savePreferences(selectedStyle, conversionMode);
      if (responsePayload.quota) {
        updateQuota(responsePayload.quota, responsePayload.job.jobId);
      }
      onJobStarted(responsePayload.job);
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Failed to upload video and start conversion.'
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const quotaPct = quota
    ? Math.max(0, Math.min(100, Math.round((quota.imagesRemaining / Math.max(1, quota.dailyLimit)) * 100)))
    : 100;
  const quotaDepleted =
    Boolean(user) &&
    conversionMode === 'nano_banana_frames' &&
    quota !== null &&
    quota.imagesRemaining < 2;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      {/* Hidden File Input shared with TopBar CTA */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Select 2D cartoon video file"
      />

      {/* Workspace Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-white/8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 text-balance">
            2D Cartoon to 3D Video Converter
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-zinc-600 dark:text-zinc-400 max-w-2xl">
            Sign in with Google to use your daily Nano Banana image generation limit for
            frame-by-frame 3D conversion with locked character consistency and original audio sync.
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-3.5 py-2 min-h-[44px] rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#131720] text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-[#1A1F2B] text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {isDark ? (
            <>
              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
              <span>Light Theme</span>
            </>
          ) : (
            <>
              <Moon className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <span>Dark Theme</span>
            </>
          )}
        </button>
      </div>

      {/* Front-Page Google Login & Nano Banana Daily Limit Bar */}
      <section className="mt-6 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-4 sm:p-5">
        {!authReady ? (
          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 py-1">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            <span>Checking Google sign-in session...</span>
          </div>
        ) : !user ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                Login with Google to Activate Nano Banana Frame-by-Frame Quota
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Each signed-in Google account gets a tracked daily Nano Banana image limit (100
                frames/day) used to render your 2D cartoon frame by frame with automatic checkpoint
                resume if you pause or reach today&apos;s limit.
              </p>
              {authError && (
                <p
                  role="alert"
                  className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1.5"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{authError}</span>
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={isSigningIn}
              className="w-full md:w-auto inline-flex items-center justify-center gap-2.5 px-5 py-2.5 min-h-[46px] rounded-xl bg-white dark:bg-zinc-100 hover:bg-zinc-50 dark:hover:bg-white text-zinc-900 border border-zinc-300 dark:border-zinc-200 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 shadow-xs disabled:opacity-60"
            >
              {isSigningIn ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-700" aria-hidden="true" />
              ) : (
                <GoogleMark />
              )}
              <span>{isSigningIn ? 'Signing in...' : 'Continue with Google'}</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Signed-in Google Profile */}
            <div className="flex items-center gap-3 min-w-0">
              {user.photoURL && !avatarError ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Google user avatar'}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-white/10 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-semibold text-sm flex items-center justify-center shrink-0">
                  {(user.displayName || user.email || 'G').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {user.displayName || 'Google Account'}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Live Nano Banana Daily Image Limit Meter */}
            <div className="flex-1 lg:max-w-md">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Nano Banana Daily Image Limit
                </span>
                <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100 font-semibold">
                  {quota ? `${quota.imagesRemaining} / ${quota.dailyLimit} left today` : 'Loading...'}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-full bg-zinc-200 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    quotaPct <= 10
                      ? 'bg-red-500'
                      : quotaPct <= 30
                        ? 'bg-amber-500'
                        : 'bg-blue-600'
                  }`}
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
              {quota && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                  Used {quota.imagesUsed} images · Model {quota.modelName} · Resets daily UTC
                </p>
              )}
            </div>

            {/* Sign out */}
            <button
              type="button"
              onClick={signOutGoogle}
              className="self-start lg:self-auto inline-flex items-center gap-2 px-3.5 py-2 min-h-[44px] rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1118] hover:bg-zinc-100 dark:hover:bg-white/5 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </section>

      {/* Main 2-Column Studio Workspace */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Dominant Focal Anchor: Video Upload + Engine + Style + Convert CTA */}
        <section className="lg:col-span-7 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Source 2D Cartoon Video
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                MP4 or MOV · Portrait or Landscape · Max 60 seconds · Zero manual prompts
              </p>
            </div>
            {selectedVideo && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 min-h-[44px] px-2"
              >
                Replace video
              </button>
            )}
          </div>

          {!selectedVideo ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-xl border-2 border-dashed p-8 sm:p-10 text-center transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-500/10'
                  : 'border-zinc-300 dark:border-white/15 bg-zinc-50/70 dark:bg-[#0E1118]'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-blue-600/10 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                <Film className="w-6 h-6" aria-hidden="true" />
              </div>
              <p className="mt-4 font-display text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Drop your 2D cartoon video here
              </p>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Supports MP4 and MOV up to 60 seconds (portrait 9:16 or landscape 16:9)
              </p>

              <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  <span>Select Video File</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadSampleVideo}
                  disabled={isPreparingSample}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-zinc-300 dark:border-white/12 bg-white dark:bg-[#161B26] hover:bg-zinc-50 dark:hover:bg-[#1C2230] text-zinc-800 dark:text-zinc-200 text-sm font-medium transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {isPreparingSample ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="w-4 h-4" aria-hidden="true" />
                  )}
                  <span>{isPreparingSample ? 'Preparing Sample...' : 'Load 6s Sample Cartoon'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Video Preview Player */}
              <div className="relative rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-white/10">
                <video
                  src={selectedVideo.previewUrl}
                  controls
                  playsInline
                  className="w-full max-h-[380px] object-contain mx-auto"
                />
              </div>

              {/* Clean Unboxed Metadata Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {selectedVideo.file.name}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                    <span>
                      Duration {formatDuration(selectedVideo.durationSec)} (
                      {selectedVideo.durationSec.toFixed(1)}s)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(selectedVideo.file.size)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {selectedVideo.width}x{selectedVideo.height} (
                      {selectedVideo.height > selectedVideo.width ? 'Portrait' : 'Landscape'})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Conversion Engine & Nano Banana Frame Budget */}
          <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-white/8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <h3 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Conversion Engine
                </h3>
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {conversionMode === 'nano_banana_frames'
                  ? 'Uses your Google daily Nano Banana limit'
                  : 'Uses Veo video scene synthesis'}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Select conversion engine"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={conversionMode === 'nano_banana_frames'}
                disabled={isUploading}
                onClick={() => setConversionMode('nano_banana_frames')}
                className={`text-left p-3.5 min-h-[44px] rounded-xl border transition-colors flex flex-col justify-between gap-1 disabled:opacity-60 ${
                  conversionMode === 'nano_banana_frames'
                    ? 'border-blue-600 dark:border-blue-500 bg-blue-50/80 dark:bg-blue-500/12'
                    : 'border-zinc-200 dark:border-white/10 bg-zinc-50/60 dark:bg-[#0E1118] hover:border-zinc-300 dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span
                    className={`text-sm font-semibold ${
                      conversionMode === 'nano_banana_frames'
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    Nano Banana Frame-by-Frame
                  </span>
                  <span
                    aria-hidden="true"
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      conversionMode === 'nano_banana_frames'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-zinc-300 dark:border-white/20'
                    }`}
                  >
                    {conversionMode === 'nano_banana_frames' && (
                      <Check className="w-3 h-3 stroke-[2.75]" />
                    )}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Converts every extracted 2D frame into 3D with previous-frame continuity and
                  assembles the sequence with original audio.
                </p>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={conversionMode === 'veo_scenes'}
                disabled={isUploading}
                onClick={() => setConversionMode('veo_scenes')}
                className={`text-left p-3.5 min-h-[44px] rounded-xl border transition-colors flex flex-col justify-between gap-1 disabled:opacity-60 ${
                  conversionMode === 'veo_scenes'
                    ? 'border-blue-600 dark:border-blue-500 bg-blue-50/80 dark:bg-blue-500/12'
                    : 'border-zinc-200 dark:border-white/10 bg-zinc-50/60 dark:bg-[#0E1118] hover:border-zinc-300 dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span
                    className={`text-sm font-semibold ${
                      conversionMode === 'veo_scenes'
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    Veo Scene-by-Scene
                  </span>
                  <span
                    aria-hidden="true"
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      conversionMode === 'veo_scenes'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-zinc-300 dark:border-white/20'
                    }`}
                  >
                    {conversionMode === 'veo_scenes' && (
                      <Check className="w-3 h-3 stroke-[2.75]" />
                    )}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Generates animated 3D scene video segments with Google Veo using locked character
                  portraits and starting keyframes.
                </p>
              </button>
            </div>

            {/* Frame Density Selector for Nano Banana Frame-by-Frame */}
            {conversionMode === 'nano_banana_frames' && (
              <div className="mt-3.5 rounded-xl bg-zinc-50 dark:bg-[#0E1118] border border-zinc-200/80 dark:border-white/8 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Frame Sampling Density
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {FPS_OPTIONS.map((opt) => {
                      const active = targetFpsOption === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isUploading}
                          onClick={() => setTargetFpsOption(opt.value)}
                          className={`px-2.5 py-1.5 min-h-[34px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-[#161B26] border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {frameBudgetPreview && (
                  <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 font-mono tabular-nums">
                    {selectedVideo ? (
                      <>
                        Estimated ~{frameBudgetPreview.cappedFrames} Nano Banana frames (
                        {frameBudgetPreview.effectiveFps} FPS × {selectedVideo.durationSec.toFixed(1)}s)
                        {user && quota ? ` · ${quota.imagesRemaining} remaining today` : ''}
                        {frameBudgetPreview.wasCapped
                          ? ' · auto-capped to remaining daily limit'
                          : ''}
                      </>
                    ) : (
                      <>
                        Select a video to calculate exact frame count · Auto fits inside your
                        remaining daily Nano Banana limit
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 3D Cartoon Visual Style Selector */}
          <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-white/8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  3D Cartoon Visual Style
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {conversionMode === 'nano_banana_frames'
                    ? 'Applied consistently across every Nano Banana 3D frame and character portrait'
                    : 'Applied consistently across character reference portraits and every Veo scene'}
                </p>
              </div>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {activeStyleOption.name}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Select 3D Cartoon Visual Style"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              {VISUAL_STYLE_OPTIONS.map((styleOpt) => {
                const isSelected = styleOpt.id === selectedStyle;
                return (
                  <button
                    key={styleOpt.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isUploading}
                    onClick={() => setSelectedStyle(styleOpt.id)}
                    className={`text-left p-3.5 min-h-[44px] rounded-xl border transition-colors flex flex-col justify-between gap-1.5 disabled:opacity-60 ${
                      isSelected
                        ? 'border-blue-600 dark:border-blue-500 bg-blue-50/80 dark:bg-blue-500/12'
                        : 'border-zinc-200 dark:border-white/10 bg-zinc-50/60 dark:bg-[#0E1118] hover:border-zinc-300 dark:hover:border-white/20 hover:bg-zinc-50 dark:hover:bg-[#161B26]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span
                        className={`text-sm font-semibold leading-snug ${
                          isSelected
                            ? 'text-blue-700 dark:text-blue-300'
                            : 'text-zinc-900 dark:text-zinc-100'
                        }`}
                      >
                        {styleOpt.name}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-zinc-300 dark:border-white/20 bg-transparent'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[2.75]" />}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {styleOpt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {validationError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3.5 flex items-start gap-2.5 text-sm text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Primary Convert CTA */}
          <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-white/8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {conversionMode === 'nano_banana_frames'
                ? `Nano Banana Frame-by-Frame · ${activeStyleOption.name} · H.264 MP4 · Original AAC audio`
                : `Veo Scene Synthesis · ${activeStyleOption.name} · H.264 MP4 · Original AAC audio`}
            </div>

            {!user ? (
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={isSigningIn}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {isSigningIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <GoogleMark />
                )}
                <span>Sign in with Google to Convert</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartConversion}
                disabled={!selectedVideo || isUploading || quotaDepleted}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 dark:disabled:text-zinc-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span className="tabular-nums">Uploading {uploadProgress}%</span>
                  </>
                ) : quotaDepleted ? (
                  <span>Daily Nano Banana Limit Reached</span>
                ) : (
                  <>
                    <span>
                      {conversionMode === 'nano_banana_frames'
                        ? 'Convert Frame-by-Frame'
                        : 'Convert to 3D'}
                    </span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </>
                )}
              </button>
            )}
          </div>
        </section>

        {/* Right Column: Interactive Before/After Showcase & Character Consistency Engine */}
        <aside className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                2D Cartoon vs 3D Output
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                Drag slider
              </span>
            </div>

            {/* Interactive Split Comparison Frame */}
            <div className="relative aspect-video rounded-xl overflow-hidden bg-zinc-900 select-none">
              {!imgErrors.after ? (
                <img
                  src={SAMPLE_3D_IMG}
                  alt="3D rendered hilltop scene"
                  referrerPolicy="no-referrer"
                  onError={() => setImgErrors((prev) => ({ ...prev, after: true }))}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-blue-950 to-zinc-900 flex items-center justify-center text-xs text-zinc-400">
                  3D Render Preview
                </div>
              )}

              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                {!imgErrors.before ? (
                  <img
                    src={SAMPLE_2D_IMG}
                    alt="Original 2D cartoon hilltop scene"
                    referrerPolicy="no-referrer"
                    onError={() => setImgErrors((prev) => ({ ...prev, before: true }))}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 flex items-center justify-center text-xs text-zinc-400">
                    2D Cartoon Source
                  </div>
                )}
              </div>

              {/* Divider handle */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
                style={{ left: `${sliderPos}%` }}
              >
                <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white text-zinc-900 shadow-md flex items-center justify-center text-xs font-bold">
                  ⇄
                </div>
              </div>

              {/* Measured scrim labels */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 py-2 flex items-center justify-between text-xs font-medium text-white pointer-events-none">
                <span>Original 2D</span>
                <span>Converted 3D</span>
              </div>

              <input
                type="range"
                min={5}
                max={95}
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                aria-label="Compare 2D cartoon source and 3D output"
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
              />
            </div>

            {/* Character Consistency Preview */}
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/8 flex items-center gap-4">
              <div className="w-24 aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-900 shrink-0 border border-zinc-200 dark:border-white/10">
                {!imgErrors.charSheet ? (
                  <img
                    src={CHAR_SHEET_IMG}
                    alt="3D Character Reference Turnaround"
                    referrerPolicy="no-referrer"
                    onError={() => setImgErrors((prev) => ({ ...prev, charSheet: true }))}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-400">
                    Character Ref
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Frame-by-Frame Temporal Consistency
                </h3>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Every Nano Banana frame receives the locked 3D character portraits plus the
                  previous rendered 3D frame so faces, outfits, and lighting stay consistent from
                  start to finish.
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Recent Conversion History */}
      <section className="mt-8 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-zinc-200 dark:border-white/8 flex items-center justify-between gap-4">
          <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Recent Conversion History
          </h2>
          {user && recentJobs.length > 0 && (
            <button
              type="button"
              onClick={onViewAllHistory}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              View all ({recentJobs.length})
            </button>
          )}
        </div>

        {!user ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Sign in with Google above to view your personal conversion history and track your daily
            Nano Banana frame budget.
          </div>
        ) : recentJobs.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No conversions yet. Upload a 2D cartoon video or load the 6-second sample above to run
            Nano Banana frame-by-frame conversion.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200/80 dark:divide-white/6">
            {recentJobs.slice(0, 5).map((job) => (
              <button
                key={job.jobId}
                type="button"
                onClick={() => onOpenJob(job)}
                className="w-full text-left px-5 sm:px-6 py-4 min-h-[64px] hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-white/6 flex items-center justify-center shrink-0">
                    {job.status === 'completed' ? (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                    ) : job.status === 'failed' ? (
                      <RefreshCw
                        className="w-4 h-4 text-red-600 dark:text-red-400"
                        aria-hidden="true"
                      />
                    ) : (
                      <Clock
                        className="w-4 h-4 text-blue-600 dark:text-blue-400"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {job.originalFilename}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      <span className="font-sans">
                        {job.conversionMode === 'nano_banana_frames'
                          ? `Nano Banana (${job.frames.length} frames)`
                          : `Veo (${job.scenes.length} scenes)`}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(job.metadata.durationSec)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">{job.visualStyleLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">
                        {job.status === 'completed'
                          ? 'Completed'
                          : job.status === 'failed'
                            ? `Paused at Stage ${job.currentStage} (Resumable)`
                            : `${job.currentStageLabel} (${job.progress}%)`}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
