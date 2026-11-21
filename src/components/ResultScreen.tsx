import {
  Check,
  Columns2,
  Download,
  Film,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConversionJob, formatBytes, formatDuration } from '../types';

interface ResultScreenProps {
  job: ConversionJob;
  onConvertAnother: () => void;
}

export function ResultScreen({ job, onConvertAnother }: ResultScreenProps) {
  const [viewMode, setViewMode] = useState<'converted' | 'side-by-side'>('side-by-side');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(
    job.outputMetadata?.durationSec ?? job.metadata.durationSec
  );
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const originalRef = useRef<HTMLVideoElement | null>(null);
  const convertedRef = useRef<HTMLVideoElement | null>(null);

  const convertedStreamUrl = `/api/jobs/${job.jobId}/download?inline=1`;
  const convertedDownloadUrl = `/api/jobs/${job.jobId}/download`;
  const originalStreamUrl = `/api/jobs/${job.jobId}/original`;

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, [viewMode, job.jobId]);

  const showToast = (msg: string) => {
    setActionFeedback(msg);
    window.setTimeout(() => setActionFeedback(null), 3500);
  };

  const togglePlaySync = async () => {
    const conv = convertedRef.current;
    const orig = originalRef.current;
    if (!conv) return;

    if (isPlaying) {
      conv.pause();
      orig?.pause();
      setIsPlaying(false);
    } else {
      if (orig) {
        orig.currentTime = conv.currentTime;
        orig.muted = true; // Play audio from converted MP4 (which carries original synced audio)
      }
      conv.muted = isMuted;
      try {
        await Promise.all([conv.play(), orig ? orig.play() : Promise.resolve()]);
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const handleRestart = () => {
    if (convertedRef.current) convertedRef.current.currentTime = 0;
    if (originalRef.current) originalRef.current.currentTime = 0;
    setCurrentTime(0);
  };

  const handleSeek = (value: number) => {
    setCurrentTime(value);
    if (convertedRef.current) convertedRef.current.currentTime = value;
    if (originalRef.current) originalRef.current.currentTime = value;
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (convertedRef.current) convertedRef.current.muted = next;
  };

  const triggerDownload = (label: string) => {
    const link = document.createElement('a');
    link.href = convertedDownloadUrl;
    link.download = `${job.originalFilename.replace(/\.[^.]+$/, '')}_3d_anime.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(label);
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${convertedDownloadUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Cartoon AI Studio — 3D Anime Conversion',
          text: `Watch ${job.originalFilename} converted to 3D Anime.`,
          url: shareUrl,
        });
        showToast('Shared video link.');
        return;
      } catch {
        // User canceled native share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Download link copied to clipboard.');
    } catch {
      showToast('Use Download MP4 to save and share the video file.');
    }
  };

  const outMeta = job.outputMetadata ?? job.metadata;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      {/* Top Result Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-zinc-200 dark:border-white/8">
        <div>
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Conversion Complete · H.264 / AAC MP4 Ready
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-50 mt-0.5">
            3D Anime Video Ready
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
            <span>{outMeta.width}x{outMeta.height}</span>
            <span aria-hidden="true">·</span>
            <span>{outMeta.durationSec.toFixed(1)}s</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(outMeta.fileSizeBytes)}</span>
            <span aria-hidden="true">·</span>
            <span>{job.characters.length} character profile(s)</span>
            <span aria-hidden="true">·</span>
            <span>{job.scenes.length} scene(s)</span>
          </div>
        </div>

        {/* View Mode Segmented Control */}
        <div className="inline-flex items-center p-1 rounded-xl bg-zinc-200/80 dark:bg-white/8 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('side-by-side')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'side-by-side'
                ? 'bg-white dark:bg-[#1A1F2B] text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Side by Side</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('converted')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              viewMode === 'converted'
                ? 'bg-white dark:bg-[#1A1F2B] text-zinc-900 dark:text-white shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5" aria-hidden="true" />
            <span>3D Anime Only</span>
          </button>
        </div>
      </div>

      {/* Video Player Workspace */}
      <section className="mt-6 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-4 sm:p-6">
        <div
          className={
            viewMode === 'side-by-side'
              ? 'grid grid-cols-1 md:grid-cols-2 gap-4'
              : 'max-w-4xl mx-auto'
          }
        >
          {viewMode === 'side-by-side' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Original 2D Cartoon
                </span>
                <span className="font-mono tabular-nums">
                  {job.metadata.width}x{job.metadata.height}
                </span>
              </div>
              <div className="rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-white/10">
                <video
                  ref={originalRef}
                  src={originalStreamUrl}
                  playsInline
                  muted
                  className="w-full max-h-[420px] object-contain mx-auto"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">
                Converted 3D Anime
              </span>
              <span className="font-mono tabular-nums">
                {outMeta.width}x{outMeta.height} · H.264 / AAC
              </span>
            </div>
            <div className="rounded-xl overflow-hidden bg-black border border-blue-500/30">
              <video
                ref={convertedRef}
                src={convertedStreamUrl}
                playsInline
                onLoadedMetadata={(e) => {
                  const vidDur = e.currentTarget.duration;
                  if (Number.isFinite(vidDur) && vidDur > 0) setDuration(vidDur);
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onEnded={() => setIsPlaying(false)}
                className="w-full max-h-[420px] object-contain mx-auto"
              />
            </div>
          </div>
        </div>

        {/* Synchronized Transport Controls */}
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/8 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={togglePlaySync}
            className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 text-sm font-medium shrink-0"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" aria-hidden="true" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                <span>Play {viewMode === 'side-by-side' ? 'Synced' : ''}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center shrink-0"
            aria-label="Restart playback"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
          </button>

          <div className="flex-1 min-w-[160px] flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 w-10">
              {formatDuration(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.05}
              value={Math.min(currentTime, duration)}
              onChange={(e) => handleSeek(Number(e.target.value))}
              aria-label="Seek video timeline"
              className="flex-1 accent-blue-600"
            />
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 w-10 text-right">
              {formatDuration(duration)}
            </span>
          </div>

          <button
            type="button"
            onClick={handleToggleMute}
            className="min-h-[44px] min-w-[44px] rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center justify-center shrink-0"
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Volume2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Result Action Buttons */}
        <div className="mt-5 pt-5 border-t border-zinc-200 dark:border-white/8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => triggerDownload('Downloading converted 3D Anime MP4...')}
            className="min-h-[48px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Download MP4</span>
          </button>

          <button
            type="button"
            onClick={() =>
              triggerDownload(
                'MP4 saved. On Android app, MediaStore inserts directly into Movies/CartoonAIStudio.'
              )
            }
            className="min-h-[48px] px-4 rounded-xl border border-zinc-300 dark:border-white/12 bg-white dark:bg-[#161B26] hover:bg-zinc-50 dark:hover:bg-[#1C2230] text-zinc-900 dark:text-zinc-100 text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Smartphone className="w-4 h-4" aria-hidden="true" />
            <span>Save to Gallery</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="min-h-[48px] px-4 rounded-xl border border-zinc-300 dark:border-white/12 bg-white dark:bg-[#161B26] hover:bg-zinc-50 dark:hover:bg-[#1C2230] text-zinc-900 dark:text-zinc-100 text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" aria-hidden="true" />
            <span>Share Video</span>
          </button>

          <button
            type="button"
            onClick={onConvertAnother}
            className="min-h-[48px] px-4 rounded-xl border border-zinc-300 dark:border-white/12 bg-zinc-100 dark:bg-white/6 hover:bg-zinc-200/70 dark:hover:bg-white/10 text-zinc-900 dark:text-zinc-100 text-sm font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Convert Another Video</span>
          </button>
        </div>

        {actionFeedback && (
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{actionFeedback}</span>
          </div>
        )}
      </section>

      {/* Preserved Character Consistency Profiles Summary */}
      {job.characters.length > 0 && (
        <section className="mt-6 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-4">
            Characters Maintained Across All {job.scenes.length} Scene(s)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {job.characters.map((char) => (
              <div
                key={char.characterId}
                className="p-4 rounded-xl bg-zinc-50 dark:bg-[#0E1118] border border-zinc-200/80 dark:border-white/6 flex items-start gap-3.5"
              >
                {char.animeRefAsset && (
                  <img
                    src={`/api/jobs/${job.jobId}/assets/${char.animeRefAsset}`}
                    alt={`${char.name} 3D Anime portrait`}
                    referrerPolicy="no-referrer"
                    className="w-16 h-16 rounded-lg object-cover shrink-0 border border-zinc-200 dark:border-white/10"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {char.name}
                  </p>
                  <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                    {char.characterId}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                    {char.clothingAndAccessories} · {char.hairStyleAndColor}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
