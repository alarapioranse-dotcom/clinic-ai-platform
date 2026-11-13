'use client';

import { useId, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

/** ADR-0030 decision 6; the API enforces the same limit independently. */
const MAX_QUERY_LENGTH = 200;

interface SearchHit {
  documentId: string;
  filename: string;
  ordinal: number;
  content: string;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'results'; hits: SearchHit[] }
  | { status: 'no-terms' }
  | { status: 'too-long' }
  | { status: 'timeout' }
  | { status: 'error' };

/**
 * ADR-0030 decision 5: staff keyword search over the clinic's ready
 * documents, on the knowledge-base screen and the conversation screen. Each
 * result shows the document's file name and the chunk's text exactly as
 * stored; nothing is generated or rewritten.
 *
 * The query may contain a patient's words (decision 6): it lives only in this
 * component's state, is sent in a POST body (never a URL), and is never
 * logged or stored. React renders the chunk text as text, never as HTML.
 */
export function KnowledgeSearch({ t }: { t: Dictionary['knowledgeSearch'] }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<SearchState>({ status: 'idle' });

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ status: 'no-terms' });
      return;
    }
    if ([...trimmed].length > MAX_QUERY_LENGTH) {
      setState({ status: 'too-long' });
      return;
    }
    setState({ status: 'searching' });
    try {
      const response = await fetch('/api/knowledge-search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: trimmed }),
      });
      if (response.status === 503) {
        setState({ status: 'timeout' });
        return;
      }
      if (!response.ok) {
        setState({ status: 'error' });
        return;
      }
      const body: { data: { outcome: 'results' | 'no_terms'; results: SearchHit[] } } =
        await response.json();
      setState(
        body.data.outcome === 'no_terms'
          ? { status: 'no-terms' }
          : { status: 'results', hits: body.data.results },
      );
    } catch {
      setState({ status: 'error' });
    }
  }

  return (
    <section className="border-line mt-8 flex flex-col gap-3 border-t pt-6">
      <h2 className="font-display text-lg font-bold">{t.heading}</h2>
      <p className="text-muted text-sm">{t.hint}</p>

      <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-sm font-medium">
            {t.label}
          </label>
          <Input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t.placeholder}
            autoComplete="off"
            disabled={state.status === 'searching'}
          />
        </div>
        <Button type="submit" disabled={state.status === 'searching'}>
          {state.status === 'searching' ? t.searching : t.submit}
        </Button>
      </form>

      {state.status === 'no-terms' && <p className="text-muted text-sm">{t.noTerms}</p>}
      {state.status === 'too-long' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.tooLong}
        </p>
      )}
      {state.status === 'timeout' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.timeout}
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.error}
        </p>
      )}

      {state.status === 'results' && state.hits.length === 0 && (
        <p role="status" className="text-muted text-sm">
          {t.noResults}
        </p>
      )}

      {state.status === 'results' && state.hits.length > 0 && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-muted text-sm">
            {format(t.resultsCount, { count: state.hits.length })}
          </p>
          <ul className="flex flex-col gap-3">
            {state.hits.map((hit) => (
              <li
                key={`${hit.documentId}:${hit.ordinal}`}
                className="border-line rounded-lg border p-4"
              >
                <p className="text-muted text-xs" dir="auto">
                  {format(t.fromDocument, { filename: hit.filename })}
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap" dir="auto">
                  {hit.content}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
