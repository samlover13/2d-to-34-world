import { execFile } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { promisify } from 'util';
import { createServer as createViteServer } from 'vite';
import {
  AuthenticatedRequest,
  createMediaToken,
  requireGoogleAuth,
  verifyBearerHeader,
  verifyMediaToken,
} from './server/auth.ts';
import {
  NANO_BANANA_DAILY_LIMIT,
  createJobRecord,
  getJobResponse,
  getRawJob,
  getUserDailyQuota,
  listRecentJobsForUser,
  markInterruptedJobsResumable,
} from './server/db.ts';
import { generateSample2DCartoonVideo, probeVideo } from './server/ffmpeg.ts';
import { enqueueJobPipeline, isJobRunning } from './server/geminiPipeline.ts';
import {
  JobResponse,
  VISUAL_STYLES,
  resolveConversionMode,
  resolveVisualStyle,
} from './server/types.ts';

const execFileAsync = promisify(execFile);

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const MAX_DURATION_SECONDS = 60.5;
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov']);
const ALLOWED_MIMES = new Set(['video/mp4', 'video/quicktime', 'application/octet-stream']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_NAME_REGEX = /^[a-zA-Z0-9._-]+$/;

const JOBS_BASE_DIR = path.resolve(process.cwd(), 'data', 'jobs');
const TEMP_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');
fs.mkdirSync(JOBS_BASE_DIR, { recursive: true });
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

// Ensure any jobs interrupted by a previous server restart can be cleanly resumed
markInterruptedJobsResumable();

const upload = multer({
  dest: TEMP_UPLOAD_DIR,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('Unsupported video format. Please upload an MP4 or MOV video file.'));
      return;
    }
    cb(null, true);
  },
});

function isPathInside(baseDir: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

function attachMediaToken(job: JobResponse, uid: string): JobResponse {
  return {
    ...job,
    mediaToken: createMediaToken(job.jobId, uid),
  };
}

function isJobOwnedByUser(jobUserId: string | null, uid: string): boolean {
  // Legacy jobs created prior to Google Login remain accessible; new jobs strictly require owner UID match
  return jobUserId === null || jobUserId === uid;
}

async function authorizeMediaRequest(
  req: express.Request,
  jobId: string,
  jobUserId: string | null
): Promise<boolean> {
  const bearerUser = await verifyBearerHeader(req.headers.authorization);
  if (bearerUser && isJobOwnedByUser(jobUserId, bearerUser.uid)) {
    return true;
  }
  const tokenParam = typeof req.query.token === 'string' ? req.query.token : '';
  if (tokenParam) {
    const verified = verifyMediaToken(tokenParam, jobId);
    if (verified && isJobOwnedByUser(jobUserId, verified.uid)) {
      return true;
    }
  }
  return false;
}

function collectDeliverableFiles(): Array<{ path: string; group: string; sizeBytes: number }> {
  const roots = [
    { dir: 'android-app', group: 'Native Android (Kotlin / Jetpack Compose)' },
    { dir: 'backend-fastapi', group: 'Python FastAPI Backend' },
    { dir: 'docs', group: 'Google Cloud Setup & API Docs' },
  ];

  const results: Array<{ path: string; group: string; sizeBytes: number }> = [];

  function walk(absDir: string, relPrefix: string, group: string): void {
    if (!fs.existsSync(absDir)) return;
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
      if (entry.name === '__pycache__' || entry.name === 'build' || entry.name === '.gradle') continue;
      const fullPath = path.join(absDir, entry.name);
      const relPath = path.posix.join(relPrefix, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, relPath, group);
      } else if (entry.isFile()) {
        results.push({
          path: relPath,
          group,
          sizeBytes: fs.statSync(fullPath).size,
        });
      }
    }
  }

  for (const root of roots) {
    walk(path.resolve(process.cwd(), root.dir), root.dir, root.group);
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health & public config info (never exposes API keys)
  app.get('/api/health', (_req, res) => {
    const keyConfigured =
      Boolean(process.env.GEMINI_API_KEY) && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY';
    res.json({
      status: 'ok',
      maxDurationSec: 60,
      supportedFormats: ['MP4', 'MOV'],
      geminiConfigured: keyConfigured,
      authRequired: true,
      nanoBananaDailyLimit: NANO_BANANA_DAILY_LIMIT,
      visualStyles: VISUAL_STYLES.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
    });
  });

  // Get signed-in Google user's live Nano Banana daily image quota
  app.get('/api/quota', requireGoogleAuth, (req: AuthenticatedRequest, res) => {
    const user = req.authUser!;
    res.json({
      user: {
        uid: user.uid,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
      quota: getUserDailyQuota(user.uid),
    });
  });

  // List recent conversion jobs owned by the signed-in Google user
  app.get('/api/jobs', requireGoogleAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.authUser!.uid;
    const jobs = listRecentJobsForUser(uid, 25).map((j) => attachMediaToken(j, uid));
    res.json({ jobs, quota: getUserDailyQuota(uid) });
  });

  // Upload 2D cartoon video and create a conversion job (requires Google Login)
  app.post('/api/jobs', requireGoogleAuth, (req: AuthenticatedRequest, res) => {
    const authUser = req.authUser!;
    upload.single('video')(req, res, async (uploadErr) => {
      if (uploadErr) {
        const message =
          uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE'
            ? 'Video file exceeds the 150 MB upload limit.'
            : uploadErr instanceof Error
              ? uploadErr.message
              : 'Upload failed.';
        res.status(400).json({ error: message });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'No video file uploaded. Attach a video under field "video".' });
        return;
      }

      const tempPath = req.file.path;
      const originalName = path.basename(req.file.originalname || 'cartoon.mp4');
      const ext = path.extname(originalName).toLowerCase();

      try {
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error('Unsupported video format. Only MP4 and MOV videos are accepted.');
        }

        const metadata = await probeVideo(tempPath);
        if (metadata.durationSec > MAX_DURATION_SECONDS) {
          throw new Error(
            `Video duration is ${metadata.durationSec.toFixed(1)}s, which exceeds the 60-second maximum limit.`
          );
        }

        const requestedStyle =
          typeof req.body?.visual_style === 'string'
            ? req.body.visual_style
            : typeof req.body?.visualStyle === 'string'
              ? req.body.visualStyle
              : undefined;
        const resolvedStyle = resolveVisualStyle(requestedStyle);

        const requestedMode =
          typeof req.body?.conversion_mode === 'string'
            ? req.body.conversion_mode
            : typeof req.body?.conversionMode === 'string'
              ? req.body.conversionMode
              : undefined;
        const conversionMode = resolveConversionMode(requestedMode);

        const quota = getUserDailyQuota(authUser.uid);
        if (conversionMode === 'nano_banana_frames' && quota.imagesRemaining < 2) {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
          res.status(429).json({
            error: `Daily Nano Banana image limit reached (${quota.imagesUsed}/${quota.dailyLimit}). Quota resets at ${quota.resetAtUtc}.`,
            quota,
          });
          return;
        }

        const rawFps = req.body?.target_fps ?? req.body?.targetFps;
        let targetFps = 2;
        if (rawFps === 'auto' || rawFps === undefined || rawFps === '') {
          // Automatically fit frame density within the user's remaining Nano Banana daily limit
          const fitBudget = Math.max(2, Math.min(36, quota.imagesRemaining - 2));
          const computed = fitBudget / Math.max(1, metadata.durationSec);
          targetFps = Math.max(0.5, Math.min(4, Math.round(computed * 2) / 2));
        } else {
          const parsedFps = Number(rawFps);
          if (Number.isFinite(parsedFps)) {
            targetFps = Math.max(0.5, Math.min(4, parsedFps));
          }
        }

        const jobId = crypto.randomUUID();
        const jobDir = path.join(JOBS_BASE_DIR, jobId);
        fs.mkdirSync(jobDir, { recursive: true });
        const persistedInputPath = path.join(jobDir, `input${ext}`);
        fs.renameSync(tempPath, persistedInputPath);

        createJobRecord({
          jobId,
          userId: authUser.uid,
          originalFilename: originalName,
          visualStyle: resolvedStyle.id,
          conversionMode,
          targetFps,
          inputPath: persistedInputPath,
          metadata,
        });

        enqueueJobPipeline(jobId);

        const job = getJobResponse(jobId);
        res.status(201).json({
          job_id: jobId,
          job: job ? attachMediaToken(job, authUser.uid) : null,
          quota: getUserDailyQuota(authUser.uid),
        });
      } catch (err) {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        const message = err instanceof Error ? err.message : 'Failed to validate uploaded video.';
        res.status(400).json({ error: message });
      }
    });
  });

  // Generate or serve a real 6-second 2D cartoon sample MP4 for instant 1-click testing
  app.post('/api/sample-video', async (_req, res) => {
    try {
      const sampleImage = path.resolve(
        process.cwd(),
        'src/assets/images/sample_2d_cartoon_frame_1795248082485.jpg'
      );
      if (!fs.existsSync(sampleImage)) {
        res.status(404).json({ error: 'Sample 2D cartoon artwork not found.' });
        return;
      }
      const sampleVideoPath = path.resolve(process.cwd(), 'data', 'sample_2d_cartoon_6s.mp4');
      let metadata;
      if (fs.existsSync(sampleVideoPath) && fs.statSync(sampleVideoPath).size > 10000) {
        metadata = await probeVideo(sampleVideoPath);
      } else {
        metadata = await generateSample2DCartoonVideo(sampleImage, sampleVideoPath);
      }
      res.json({
        url: '/api/sample-video/file',
        filename: 'hilltop_adventure_2d_cartoon_6s.mp4',
        metadata,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to prepare sample 2D cartoon video.',
      });
    }
  });

  app.get('/api/sample-video/file', (_req, res) => {
    const sampleVideoPath = path.resolve(process.cwd(), 'data', 'sample_2d_cartoon_6s.mp4');
    if (!fs.existsSync(sampleVideoPath)) {
      res.status(404).json({ error: 'Sample video has not been generated yet.' });
      return;
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.sendFile(sampleVideoPath);
  });

  // Get real-time job status, progress, character profiles, frames, and scene timeline
  app.get('/api/jobs/:jobId', requireGoogleAuth, (req: AuthenticatedRequest, res) => {
    const { jobId } = req.params;
    const uid = req.authUser!.uid;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format.' });
      return;
    }
    const job = getJobResponse(jobId);
    if (!job) {
      res.status(404).json({ error: 'Conversion job not found.' });
      return;
    }
    if (!isJobOwnedByUser(job.userId, uid)) {
      res.status(403).json({ error: 'Access denied to this conversion job.' });
      return;
    }
    res.json({
      ...attachMediaToken(job, uid),
      quota: getUserDailyQuota(uid),
    });
  });

  // Resume a failed job from its last completed stage/frame/scene checkpoint
  app.post('/api/jobs/:jobId/resume', requireGoogleAuth, (req: AuthenticatedRequest, res) => {
    const { jobId } = req.params;
    const uid = req.authUser!.uid;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format.' });
      return;
    }
    const raw = getRawJob(jobId);
    if (!raw) {
      res.status(404).json({ error: 'Conversion job not found.' });
      return;
    }
    if (!isJobOwnedByUser(raw.user_id, uid)) {
      res.status(403).json({ error: 'Access denied to this conversion job.' });
      return;
    }
    if (raw.status === 'completed') {
      const doneJob = getJobResponse(jobId);
      res.json({
        job: doneJob ? attachMediaToken(doneJob, uid) : null,
        message: 'Job is already completed.',
      });
      return;
    }
    if (isJobRunning(jobId)) {
      const runningJob = getJobResponse(jobId);
      res.json({
        job: runningJob ? attachMediaToken(runningJob, uid) : null,
        message: 'Job is currently processing.',
      });
      return;
    }
    if (!fs.existsSync(raw.input_path)) {
      res.status(410).json({ error: 'Original uploaded video is no longer available on disk.' });
      return;
    }

    enqueueJobPipeline(jobId);
    const updatedJob = getJobResponse(jobId);
    res.json({
      job: updatedJob ? attachMediaToken(updatedJob, uid) : null,
      resumedFromStage: raw.last_completed_stage + 1,
      quota: getUserDailyQuota(uid),
    });
  });

  // Download or stream converted 3D MP4 (accepts Bearer ID token or signed job mediaToken)
  app.get('/api/jobs/:jobId/download', async (req, res) => {
    const { jobId } = req.params;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format.' });
      return;
    }
    const raw = getRawJob(jobId);
    if (!raw || !raw.output_path || !fs.existsSync(raw.output_path)) {
      res.status(404).json({ error: 'Converted 3D video is not ready yet.' });
      return;
    }
    if (!(await authorizeMediaRequest(req, jobId, raw.user_id))) {
      res.status(401).json({ error: 'Sign in with Google to access this video.' });
      return;
    }
    if (!isPathInside(JOBS_BASE_DIR, raw.output_path)) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const baseName = path.parse(raw.original_filename).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const downloadName = `${baseName}_3d_anime.mp4`;

    res.setHeader('Content-Type', 'video/mp4');
    if (req.query.inline !== '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    }
    res.sendFile(raw.output_path);
  });

  // Stream original uploaded 2D cartoon video for side-by-side comparison
  app.get('/api/jobs/:jobId/original', async (req, res) => {
    const { jobId } = req.params;
    if (!UUID_REGEX.test(jobId)) {
      res.status(400).json({ error: 'Invalid job ID format.' });
      return;
    }
    const raw = getRawJob(jobId);
    if (!raw || !fs.existsSync(raw.input_path) || !isPathInside(JOBS_BASE_DIR, raw.input_path)) {
      res.status(404).json({ error: 'Original video not found.' });
      return;
    }
    if (!(await authorizeMediaRequest(req, jobId, raw.user_id))) {
      res.status(401).json({ error: 'Sign in with Google to access this video.' });
      return;
    }
    const ext = path.extname(raw.input_path).toLowerCase();
    res.setHeader('Content-Type', ext === '.mov' ? 'video/quicktime' : 'video/mp4');
    res.sendFile(raw.input_path);
  });

  // Serve extracted character reference portraits, source frames, and rendered Nano Banana 3D frames
  app.get('/api/jobs/:jobId/assets/:assetName', async (req, res) => {
    const { jobId, assetName } = req.params;
    if (!UUID_REGEX.test(jobId) || !ASSET_NAME_REGEX.test(assetName)) {
      res.status(400).json({ error: 'Invalid asset path.' });
      return;
    }
    const raw = getRawJob(jobId);
    if (!raw) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    if (!(await authorizeMediaRequest(req, jobId, raw.user_id))) {
      res.status(401).json({ error: 'Sign in with Google to access job assets.' });
      return;
    }
    const jobAssetsDir = path.join(JOBS_BASE_DIR, jobId, 'assets');
    const resolvedAsset = path.resolve(jobAssetsDir, assetName);
    if (!isPathInside(jobAssetsDir, resolvedAsset) || !fs.existsSync(resolvedAsset)) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    res.sendFile(resolvedAsset);
  });

  // Deliverables browser: list Native Android Studio + Python FastAPI + Google Cloud docs
  app.get('/api/deliverables', (_req, res) => {
    res.json({ files: collectDeliverableFiles() });
  });

  // Read single deliverable source file safely
  app.get('/api/deliverables/file', (req, res) => {
    const requested = String(req.query.path || '');
    const allowedRoots = ['android-app', 'backend-fastapi', 'docs'];
    const normalized = path.posix.normalize(requested).replace(/^\/+/, '');
    const topDir = normalized.split('/')[0];

    if (!allowedRoots.includes(topDir) || normalized.includes('..')) {
      res.status(403).json({ error: 'Access restricted to project deliverables.' });
      return;
    }
    const rootAbs = path.resolve(process.cwd(), topDir);
    const targetAbs = path.resolve(process.cwd(), normalized);
    if (!isPathInside(rootAbs, targetAbs) || !fs.existsSync(targetAbs)) {
      res.status(404).json({ error: 'Deliverable file not found.' });
      return;
    }
    const content = fs.readFileSync(targetAbs, 'utf8');
    res.json({ path: normalized, content });
  });

  // Download complete Android Studio + FastAPI + Docs ZIP archive
  app.get('/api/deliverables/bundle.zip', async (_req, res) => {
    try {
      const zipPath = path.resolve(process.cwd(), 'data', 'cartoon-ai-studio-deliverables.zip');
      const pyScript = [
        'import os, sys, zipfile',
        'out_path = sys.argv[1]',
        'roots = ["android-app", "backend-fastapi", "docs"]',
        'with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:',
        '    for root in roots:',
        '        if not os.path.isdir(root): continue',
        '        for dirpath, dirnames, filenames in os.walk(root):',
        '            dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "build", ".gradle")]',
        '            for fn in filenames:',
        '                if fn.startswith(".env") and fn != ".env.example": continue',
        '                full = os.path.join(dirpath, fn)',
        '                zf.write(full, os.path.relpath(full, "."))',
      ].join('\n');

      await execFileAsync('python3', ['-c', pyScript, zipPath], {
        cwd: process.cwd(),
        timeout: 30000,
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="cartoon-ai-studio-android-and-fastapi.zip"'
      );
      res.sendFile(zipPath);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build deliverables archive.',
      });
    }
  });

  // Serve Vite in development or static dist/ in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Cartoon AI Studio server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Cartoon AI Studio server:', err);
  process.exit(1);
});
