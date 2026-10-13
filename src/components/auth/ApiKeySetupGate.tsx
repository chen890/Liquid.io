import { KeyRound } from 'lucide-react';
import { GrantExtractionSections } from '../vault/GrantExtractionSections';
import { hasAnySavedExtractionKey } from '../../lib/extractionKeys';

type Props = {
  onReady: () => void;
};

/**
 * Blocks the app until the user saves at least one extraction API key in IndexedDB.
 */
export function ApiKeySetupGate({ onReady }: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <div className="space-y-2 text-center sm:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-800/60 bg-indigo-950/40 px-3 py-1 text-xs text-indigo-300">
            <KeyRound className="h-3.5 w-3.5" />
            Required setup
          </div>
          <h1 className="text-2xl font-semibold text-white">Add an API key to continue</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Save at least one key for ChatGPT, Claude, or Grok. Keys stay in this browser (IndexedDB) and are
            used for grant extraction. Pick an active agent, then save a key below.
          </p>
        </div>

        <GrantExtractionSections
          onKeysChanged={async () => {
            if (await hasAnySavedExtractionKey()) onReady();
          }}
        />
      </div>
    </div>
  );
}
