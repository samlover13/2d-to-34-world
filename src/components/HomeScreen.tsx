import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Film,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Sun,
  Upload,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import {
  ConversionJob,
  VISUAL_STYLE_OPTIONS,
  VisualStyleId,
  formatBytes,
  formatDuration,
} from '../types';

const SAMPLE_2D_IMG = '/src/assets/images/sample_2d_cartoon_frame_1795248082485.jpg';
const SAMPLE_3D_IMG = '/src/assets/images/sample_3d_anime_frame_1795248082337.jpg';
const CHAR_SHEET_IMG = '/src/assets/images/character_sheet_3d_anime_1795248079417.jpg';

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

export function HomeScreen({
  recentJobs,
  isDark,
  fileInputRef,
  onToggleTheme,
  onJobStarted,
  onOpenJob,
  onViewAllHistory,
}: HomeScreenProps) {
  const [selectedVideo, setSelectedVideo] = useState<LocalVideoSelection | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<VisualStyleId>('pixar_3d');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isPreparingSample, setIsPreparingSample] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const activeStyleOption =
    VISUAL_STYLE_OPTIONS.find((opt) => opt.id === selectedStyle) ?? VISUAL_STYLE_OPTIONS[0];

  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

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
    if (!selectedVideo || isUploading) return;
    setValidationError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('video', selectedVideo.file);
      formData.append('visual_style', selectedStyle);

      const createdJob = await new Promise<ConversionJob>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/jobs');

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setUploadProgress(Math.round((evt.loaded / evt.total) * 100));
          }
        };

        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && parsed.job) {
              resolve(parsed.job as ConversionJob);
            } else {
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

      onJobStarted(createdJob);
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Failed to upload video and start conversion.'
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

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
            2D Cartoon to 3D Anime Video Converter
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-zinc-600 dark:text-zinc-400 max-w-2xl">
            Upload a 2D cartoon clip up to 60 seconds. Gemini analyzes every scene and character,
            locks consistent 3D character profiles, and renders one synchronized MP4 with Veo.
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

      {/* Main 2-Column Studio Workspace */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Dominant Focal Anchor: Video Upload + Preview + Convert CTA */}
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
                    <span>Duration {formatDuration(selectedVideo.durationSec)} ({selectedVideo.durationSec.toFixed(1)}s)</span>
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

          {/* 3D Cartoon Visual Style Selector */}
          <div className="mt-6 pt-5 border-t border-zinc-200 dark:border-white/8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  3D Cartoon Visual Style
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Applied consistently across Gemini character sheets and every Veo scene
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
              Style: {activeStyleOption.name} · H.264 MP4 · AAC original audio · Automatic character lock
            </div>

            <button
              type="button"
              onClick={handleStartConversion}
              disabled={!selectedVideo || isUploading}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 disabled:text-zinc-500 dark:disabled:text-zinc-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span className="tabular-nums">Uploading {uploadProgress}%</span>
                </>
              ) : (
                <>
                  <span>Convert to 3D</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </section>

        {/* Right Column: Interactive Before/After Showcase & Character Consistency Engine */}
        <aside className="lg:col-span-5 space-y-6">
          <div className="bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
                2D Cartoon vs 3D Anime Output
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
                  alt="3D Anime rendered hilltop scene"
                  referrerPolicy="no-referrer"
                  onError={() => setImgErrors((prev) => ({ ...prev, after: true }))}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-blue-950 to-zinc-900 flex items-center justify-center text-xs text-zinc-400">
                  3D Anime Render Preview
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
                <span>Converted 3D Anime</span>
              </div>

              <input
                type="range"
                min={5}
                max={95}
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                aria-label="Compare 2D cartoon source and 3D anime output"
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
              />
            </div>

            {/* Character Consistency Preview */}
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/8 flex items-center gap-4">
              <div className="w-24 aspect-[4/3] rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-900 shrink-0 border border-zinc-200 dark:border-white/10">
                {!imgErrors.charSheet ? (
                  <img
                    src={CHAR_SHEET_IMG}
                    alt="3D Anime Character Reference Turnaround"
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
                  Persistent Character Consistency Engine
                </h3>
                <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Locks every character&apos;s face, hairstyle, eyes, outfit, and color palette into
                  reusable 3D reference portraits fed into every Veo scene segment.
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
          {recentJobs.length > 0 && (
            <button
              type="button"
              onClick={onViewAllHistory}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              View all ({recentJobs.length})
            </button>
          )}
        </div>

        {recentJobs.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No conversions yet. Upload a 2D cartoon video or load the 6-second sample above to run
            the automated Gemini + Veo pipeline.
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
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    ) : job.status === 'failed' ? (
                      <RefreshCw className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                    ) : (
                      <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {job.originalFilename}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                      <span>{formatDuration(job.metadata.durationSec)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {job.metadata.width}x{job.metadata.height}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">{job.visualStyleLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-sans">
                        {job.status === 'completed'
                          ? 'Completed'
                          : job.status === 'failed'
                            ? `Failed at Stage ${job.currentStage} (Resumable)`
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
