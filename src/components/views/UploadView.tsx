import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, X, CheckCircle, Loader2, ChevronRight, AlertTriangle, Server } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import type { DocumentRecord, ExtractionProvider } from '../../types';
import { usePortfolioStore } from '../../store/portfolioStore';
import { parseFile } from '../../lib/parsers';
import { extractGrantsFromText, checkServerHealth } from '../../lib/ai/extractor';
import type { ServerHealth } from '../../lib/ai/extractor';
import { reconcileGrants } from '../../lib/ai/reconciler';
import { getSetting } from '../../lib/storage';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

const ACCEPTED_TYPES = [
  '.pdf', '.xml', '.csv', '.xlsx', '.xls', '.txt', '.docx', '.doc', '.html', '.htm',
];

const FILE_ICONS: Record<string, string> = {
  pdf: 'PDF', docx: 'DOC', doc: 'DOC', xlsx: 'XLS', xls: 'XLS',
  csv: 'CSV', xml: 'XML', html: 'HTM', htm: 'HTM', txt: 'TXT',
};

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function UploadView() {
  const {
    addDocuments, updateDocument,
    setPendingGrants, setPendingSession,
    setView,
    addProcessingLog, clearProcessingLog,
    processingLog, isProcessing, setProcessing,
  } = usePortfolioStore();

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [extractionProvider, setExtractionProvider] = useState<ExtractionProvider>('openai');
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting<string>('extractionKey').then((k) => setApiKey(k ?? ''));
    getSetting<ExtractionProvider>('extractionProvider').then((p) => setExtractionProvider(p ?? 'openai'));
    checkServerHealth().then(setServerHealth);
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const processedNames = new Set(
      usePortfolioStore.getState().portfolio.documents
        .filter((d) => d.status === 'completed')
        .map((d) => d.filename),
    );
    const skipped: string[] = [];
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...arr.filter((f) => {
        if (existing.has(f.name + f.size)) return false;
        if (processedNames.has(f.name)) { skipped.push(f.name); return false; }
        return true;
      })];
    });
    if (skipped.length > 0) setSkippedFiles(skipped);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = (idx: number) => setFiles((f) => f.filter((_, i) => i !== idx));

  const handleProcess = async () => {
    if (files.length === 0) return;

    const key = (await getSetting<string>('extractionKey')) ?? '';
    const provider = (await getSetting<ExtractionProvider>('extractionProvider')) ?? 'openai';
    setApiKey(key);
    setExtractionProvider(provider);

    const envFallback =
      provider === 'openai'
        ? serverHealth?.online && serverHealth.openaiEnvConfigured
        : serverHealth?.online && serverHealth.anthropicEnvConfigured;
    if (!key.trim() && !envFallback) return;

    setProcessing(true);
    clearProcessingLog();

    const docRecords: DocumentRecord[] = files.map((f) => ({
      id: uuidv4(),
      filename: f.name,
      fileType: f.name.split('.').pop()?.toLowerCase() ?? 'unknown',
      fileSize: f.size,
      uploadedAt: new Date().toISOString(),
      status: 'pending' as const,
      extractedGrantCount: 0,
    }));

    await addDocuments(docRecords);
    const allGrants: ReturnType<typeof reconcileGrants> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const doc = docRecords[i];

        addProcessingLog(`[${i + 1}/${files.length}] Parsing ${file.name}...`);
        await updateDocument({ ...doc, status: 'processing' });

        let parsed;
        try {
          parsed = await parseFile(file);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addProcessingLog(`  Error parsing ${file.name}: ${msg}`);
          await updateDocument({ ...doc, status: 'error', errorMessage: msg });
          continue;
        }

        addProcessingLog(
          `  Parsed ${file.name} (${parsed.pageCount ? parsed.pageCount + ' pages, ' : ''}${humanSize(file.size)})`,
        );

        let docGrants: ReturnType<typeof reconcileGrants>;
        try {
          docGrants = await extractGrantsFromText(
            parsed.text,
            file.name,
            key,
            (msg) => addProcessingLog(`  ${msg}`),
            provider,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addProcessingLog(`  Error extracting from ${file.name}: ${msg}`);
          await updateDocument({ ...doc, status: 'error', errorMessage: msg });
          continue;
        }

        addProcessingLog(`  Found ${docGrants.length} grant(s) in ${file.name}`);
        allGrants.push(...docGrants);

        await updateDocument({
          ...doc,
          status: 'completed',
          extractedGrantCount: docGrants.length,
          pageCount: parsed.pageCount,
        });
      }

      if (allGrants.length === 0) {
        addProcessingLog('\nNo grants found in the uploaded documents.');
        setProcessing(false);
        return;
      }

      addProcessingLog(`\nReconciling ${allGrants.length} extraction(s) across documents...`);
      const reconciled = reconcileGrants(allGrants);
      addProcessingLog(`Done — ${reconciled.length} unique grant(s) identified.`);

      setPendingGrants(reconciled);
      setPendingSession({
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        documentIds: docRecords.map((d) => d.id),
        grantIds: [],
        status: 'review',
      });
      setProcessing(false);
      setView('review');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addProcessingLog(`\nFatal error: ${msg}`);
      setProcessing(false);
    }
  };

  const ext = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
  const openaiReady =
    apiKey.trim().length > 0 || !!(serverHealth?.online && serverHealth.openaiEnvConfigured);
  const anthropicReady =
    apiKey.trim().length > 0 || !!(serverHealth?.online && serverHealth.anthropicEnvConfigured);
  const hasCredentials = extractionProvider === 'openai' ? openaiReady : anthropicReady;
  const anthropicNeedsServer = extractionProvider === 'anthropic' && !serverHealth?.online;
  const canProcess = hasCredentials && !anthropicNeedsServer;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-3xl mx-auto w-full">
      <div>
        <h1 className="text-xl font-semibold text-white">Upload Documents</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Upload equity documents — ChatGPT or Claude extracts every grant (see Settings for provider and API key).
        </p>
      </div>

      {/* Backend status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {serverHealth?.online ? (
          <>
            <Server className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-emerald-500">Extraction server online</span>
            {serverHealth.openaiEnvConfigured && (
              <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 text-slate-400">
                OPENAI_API_KEY on server
              </span>
            )}
            {serverHealth.anthropicEnvConfigured && (
              <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/80 text-slate-400">
                ANTHROPIC_API_KEY on server
              </span>
            )}
          </>
        ) : (
          <>
            <Server className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-slate-500">Extraction server offline — OpenAI-only direct mode if you have a browser key</span>
          </>
        )}
        <span className="px-2 py-0.5 rounded border text-xs font-medium border-indigo-800 bg-indigo-950/40 text-indigo-300">
          Using: {extractionProvider === 'openai' ? 'ChatGPT (OpenAI)' : 'Claude (Anthropic)'}
        </span>
      </div>

      {anthropicNeedsServer && (
        <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-800/60 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200">
            Claude extraction needs the local API server. Run <code className="font-mono text-xs">npm start</code> in this repo, or switch to ChatGPT in Settings for browser-only OpenAI calls.
          </div>
        </div>
      )}

      {/* Missing key / env banner */}
      {!hasCredentials && (
        <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-800/60 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="text-amber-300 font-medium">No credentials for the selected provider.</span>
            <span className="text-amber-500 ml-2">
              Go to{' '}
              <button
                className="text-amber-300 underline underline-offset-2"
                onClick={() => usePortfolioStore.getState().setView('settings')}
              >
                Settings
              </button>
              {extractionProvider === 'openai' ? (
                <>
                  {' '}and add an OpenAI key (<code className="font-mono text-xs">sk-…</code>), or start the server with{' '}
                  <code className="font-mono text-xs">OPENAI_API_KEY</code> in <code className="font-mono text-xs">.env</code>.
                </>
              ) : (
                <>
                  {' '}and add an Anthropic key (<code className="font-mono text-xs">sk-ant-…</code>), or start the server with{' '}
                  <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> in <code className="font-mono text-xs">.env</code>.
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
          isDragging
            ? 'border-indigo-500 bg-indigo-950/30'
            : 'border-slate-700 hover:border-slate-600 bg-slate-900/50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <Upload className="w-8 h-8 text-slate-500 mx-auto mb-3" />
        <p className="text-sm text-slate-300 font-medium">
          Drag & drop files here, or click to browse
        </p>
        <p className="text-xs text-slate-600 mt-1">
          PDF, DOCX, XLSX, CSV, XML, HTML, TXT · Multiple files supported
        </p>
      </div>

      {/* Already-processed notice */}
      {skippedFiles.length > 0 && (
        <div className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-400">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
          <span>
            Already processed, skipped:{' '}
            <span className="text-slate-300">{skippedFiles.join(', ')}</span>.{' '}
            <button className="text-indigo-400 hover:underline" onClick={() => setSkippedFiles([])}>Dismiss</button>
          </span>
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${i}`}
              className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-slate-400">
                  {FILE_ICONS[ext(f)] ?? 'FILE'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{f.name}</div>
                <div className="text-xs text-slate-500">{humanSize(f.size)}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                className="text-slate-600 hover:text-slate-400 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Process Button */}
      {files.length > 0 && (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={isProcessing}
          onClick={handleProcess}
          disabled={isProcessing || !canProcess}
        >
          {isProcessing ? (
            'Extracting grants...'
          ) : (
            <>
              Process {files.length} file{files.length > 1 ? 's' : ''} with AI
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </Button>
      )}

      {/* Processing Log */}
      {processingLog.length > 0 && (
        <Card padding="md">
          <div className="text-xs text-slate-500 mb-2 flex items-center gap-2">
            {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
            Extraction Log
          </div>
          <div className="bg-slate-950 rounded-lg p-3 max-h-48 overflow-auto font-mono text-xs space-y-0.5">
            {processingLog.map((line, i) => (
              <div
                key={i}
                className={
                  line.includes('Error') || line.includes('Fatal')
                    ? 'text-red-400'
                    : line.startsWith('\n') || line.startsWith('Done') || line.startsWith('Reconcil')
                    ? 'text-indigo-400'
                    : 'text-slate-400'
                }
              >
                {line.startsWith('\n') ? line.slice(1) : line}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Supported Formats */}
      <Card padding="md">
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
          Supported Document Types
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-500">
          {[
            'Grant agreements', 'RSU statements', 'Equity award notices',
            'Vesting schedules', 'Brokerage statements', 'Employer stock-plan reports',
            'Tax documents (1099-B, etc.)', 'Historical grant exports',
            'Carta exports', 'Fidelity exports', 'E*TRADE exports',
            'Morgan Stanley at Work', 'Shareworks exports',
          ].map((t) => (
            <div key={t} className="flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-600 flex-shrink-0" />
              {t}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
