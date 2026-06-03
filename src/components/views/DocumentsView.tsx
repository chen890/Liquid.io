import { AlertCircle, CheckCircle, Clock, Loader2, Trash2, Upload } from 'lucide-react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'text-slate-500' },
  processing: { label: 'Processing', icon: Loader2, color: 'text-blue-400' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'text-emerald-400' },
  error: { label: 'Error', icon: AlertCircle, color: 'text-red-400' },
};

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: 'bg-red-900/30 text-red-400 border-red-800',
  docx: 'bg-blue-900/30 text-blue-400 border-blue-800',
  doc: 'bg-blue-900/30 text-blue-400 border-blue-800',
  xlsx: 'bg-emerald-900/30 text-emerald-400 border-emerald-800',
  xls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800',
  csv: 'bg-amber-900/30 text-amber-400 border-amber-800',
  xml: 'bg-purple-900/30 text-purple-400 border-purple-800',
  html: 'bg-orange-900/30 text-orange-400 border-orange-800',
  txt: 'bg-slate-800 text-slate-400 border-slate-700',
};

export function DocumentsView() {
  const { portfolio, deleteDocument, setView } = usePortfolioStore();
  const documents = portfolio.documents;

  const completedCount = documents.filter((d) => d.status === 'completed').length;
  const errorCount = documents.filter((d) => d.status === 'error').length;
  const totalGrants = documents.reduce((s, d) => s + d.extractedGrantCount, 0);

  if (documents.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="text-slate-500">No documents uploaded yet.</div>
        <Button variant="primary" onClick={() => setView('upload')}>
          <Upload className="w-4 h-4" />
          Upload Documents
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Document Explorer</h1>
          <p className="text-sm text-slate-500 mt-0.5">{documents.length} documents uploaded</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setView('upload')}>
          <Upload className="w-3.5 h-3.5" />
          Upload More
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card padding="md">
          <div className="text-2xl font-semibold text-white">{documents.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">Documents Uploaded</div>
        </Card>
        <Card padding="md">
          <div className="text-2xl font-semibold text-emerald-400">{completedCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">Successfully Parsed</div>
        </Card>
        <Card padding="md">
          <div className="text-2xl font-semibold text-indigo-400">{totalGrants}</div>
          <div className="text-xs text-slate-500 mt-0.5">Grants Extracted</div>
        </Card>
      </div>

      {errorCount > 0 && (
        <div className="flex items-center gap-2 bg-red-950/30 border border-red-900/50 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-sm text-red-400">
            {errorCount} document{errorCount > 1 ? 's' : ''} failed to parse. Check individual files for details.
          </span>
        </div>
      )}

      {/* Document List */}
      <Card padding="none">
        <div className="divide-y divide-slate-800">
          {documents.map((doc) => {
            const statusCfg = STATUS_CONFIG[doc.status];
            const StatusIcon = statusCfg.icon;
            const typeColor = FILE_TYPE_COLORS[doc.fileType] ?? 'bg-slate-800 text-slate-400 border-slate-700';

            return (
              <div key={doc.id} className="px-4 py-3 flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0 text-xs font-bold ${typeColor}`}
                >
                  {doc.fileType.toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{doc.filename}</div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-slate-600">{humanSize(doc.fileSize)}</span>
                    {doc.pageCount && (
                      <span className="text-xs text-slate-600">{doc.pageCount} pages</span>
                    )}
                    <span className="text-xs text-slate-600">
                      {new Date(doc.uploadedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {doc.errorMessage && (
                    <div className="text-xs text-red-400 mt-1 truncate">{doc.errorMessage}</div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {doc.extractedGrantCount > 0 && (
                    <Badge variant="info" size="sm">
                      {doc.extractedGrantCount} grant{doc.extractedGrantCount > 1 ? 's' : ''}
                    </Badge>
                  )}
                  <div className={`flex items-center gap-1 text-xs ${statusCfg.color}`}>
                    <StatusIcon
                      className={`w-3.5 h-3.5 ${doc.status === 'processing' ? 'animate-spin' : ''}`}
                    />
                    {statusCfg.label}
                  </div>
                  <button
                    onClick={() => deleteDocument(doc.id)}
                    className="text-slate-700 hover:text-red-400 transition-colors p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
