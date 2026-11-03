import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Send, Loader2, RotateCcw } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import type { GrantRecord } from '../../types';
import {
  askPortfolioChat,
  buildPortfolioContext,
  type ChatTurn,
} from '../../lib/ai/portfolioChat';

const SUGGESTIONS = [
  'How many RSUs can I sell now?',
  'When is my next vest, and how many shares?',
  'Summarize my portfolio by grant',
  'Why might sellable be less than vested?',
];

interface PortfolioChatProps {
  grants: GrantRecord[];
  livePrices?: Record<string, number | null | undefined>;
}

export function PortfolioChat({ grants, livePrices }: PortfolioChatProps) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendHint, setBackendHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const context = useMemo(
    () => buildPortfolioContext(grants, livePrices),
    [grants, livePrices],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;

    const nextHistory: ChatTurn[] = [...messages, { role: 'user', content: q }];
    setMessages(nextHistory);
    setInput('');
    setError(null);
    setBusy(true);

    try {
      const result = await askPortfolioChat(nextHistory, context);
      setMessages([...nextHistory, { role: 'assistant', content: result.reply }]);
      setBackendHint(
        result.model ? `${result.backend} · ${result.model}` : result.backend,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  function clearChat() {
    setMessages([]);
    setError(null);
    setBackendHint(null);
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-teal-600/20 border border-teal-700/40 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-teal-400" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-slate-300 normal-case tracking-normal">
              Ask about your RSUs
            </CardTitle>
            <p className="text-xs text-slate-500 truncate">
              Answers use your imported grants
              {backendHint ? ` · ${backendHint}` : ''}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} disabled={busy}>
            <RotateCcw className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      <div className="px-4 py-3 max-h-80 overflow-y-auto space-y-3 bg-slate-950/40">
        {messages.length === 0 && !busy && (
          <div className="space-y-3 py-1">
            <p className="text-sm text-slate-400">
              Ask about vesting, sellable shares, grant totals, or upcoming events.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="text-left text-xs px-3 py-1.5 rounded-lg border border-slate-700
                    bg-slate-900 text-slate-300 hover:border-teal-700/50 hover:text-teal-300
                    transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] sm:max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                m.role === 'user'
                  ? 'bg-teal-700/30 border border-teal-600/40 text-teal-50'
                  : 'bg-slate-800/80 border border-slate-700 text-slate-200'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Thinking…
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-3 border-t border-slate-800 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={busy}
          placeholder="e.g. How many MBLY shares vest in the next 90 days?"
          className="flex-1 resize-none rounded-lg bg-slate-950 border border-slate-700
            px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600
            focus:outline-none focus:border-teal-600/60 disabled:opacity-60"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !input.trim()}
          onClick={() => void send(input)}
          className="flex-shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send
        </Button>
      </div>
    </Card>
  );
}
