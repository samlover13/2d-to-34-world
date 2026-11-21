import { Check, Copy, Download, FileCode2, FolderOpen, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '../types';

interface DeliverableItem {
  path: string;
  group: string;
  sizeBytes: number;
}

export function ProjectDeliverablesView() {
  const [files, setFiles] = useState<DeliverableItem[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/deliverables')
      .then((r) => r.json())
      .then((data) => {
        const list = (data.files ?? []) as DeliverableItem[];
        setFiles(list);
        if (list.length > 0) {
          setSelectedPath(list[0].path);
        }
      })
      .finally(() => setIsLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    setIsLoadingFile(true);
    fetch(`/api/deliverables/file?path=${encodeURIComponent(selectedPath)}`)
      .then((r) => r.json())
      .then((data) => setFileContent(data.content ?? ''))
      .finally(() => setIsLoadingFile(false));
  }, [selectedPath]);

  const groups = useMemo(() => {
    const set = new Set(files.map((f) => f.group));
    return ['all', ...Array.from(set)];
  }, [files]);

  const filteredFiles = useMemo(
    () => (activeGroup === 'all' ? files : files.filter((f) => f.group === activeGroup)),
    [files, activeGroup]
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fileContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-12">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-zinc-200 dark:border-white/8">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Native Android &amp; FastAPI Deliverables
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Complete Android Studio Kotlin + Jetpack Compose project (Android 10+), Python FastAPI
            production backend with Google Cloud Storage &amp; Veo, and setup documentation.
          </p>
        </div>

        <a
          href="/api/deliverables/bundle.zip"
          download="cartoon-ai-studio-android-and-fastapi.zip"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          <span>Download Project (.zip)</span>
        </a>
      </div>

      {/* Group Filter Tabs */}
      <div className="mt-5 flex items-center gap-1.5 overflow-x-auto pb-1">
        {groups.map((grp) => (
          <button
            key={grp}
            type="button"
            onClick={() => setActiveGroup(grp)}
            className={`px-3.5 py-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeGroup === grp
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-200/70 dark:bg-white/6 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10'
            }`}
          >
            {grp === 'all' ? `All Files (${files.length})` : grp}
          </button>
        ))}
      </div>

      {/* Split Code Explorer */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <aside className="lg:col-span-4 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl overflow-hidden max-h-[640px] flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/8 flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            <span>Repository Files</span>
          </div>

          {isLoadingList ? (
            <div className="p-6 flex items-center justify-center text-zinc-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <div className="overflow-y-auto divide-y divide-zinc-100 dark:divide-white/5">
              {filteredFiles.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={`w-full text-left px-4 py-3 transition-colors flex items-center justify-between gap-2 ${
                    selectedPath === item.path
                      ? 'bg-blue-50 dark:bg-blue-500/12 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03] text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileCode2 className="w-4 h-4 shrink-0 opacity-70" aria-hidden="true" />
                    <span className="text-xs font-mono truncate">{item.path}</span>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400 shrink-0 tabular-nums">
                    {formatBytes(item.sizeBytes)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="lg:col-span-8 bg-white dark:bg-[#131720] border border-zinc-200/90 dark:border-white/8 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/8 flex items-center justify-between gap-3">
            <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate">
              {selectedPath || 'Select a file'}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!fileContent}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-white/10 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <div className="max-h-[580px] overflow-auto bg-[#0D1017] text-zinc-200 p-4">
            {isLoadingFile ? (
              <div className="py-12 flex items-center justify-center text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <pre className="text-xs font-mono leading-relaxed whitespace-pre">
                <code>{fileContent}</code>
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
