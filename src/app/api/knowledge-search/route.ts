import { DatabaseError } from 'pg';
import { NextResponse, type NextRequest } from 'next/server';

import { validateSession, SESSION_COOKIE_NAME } from '@/features/auth';
import { searchKnowledgeBase, InvalidKnowledgeSearchQueryError } from '@/features/knowledge-base';

/** PostgreSQL `query_canceled`: the search hit its statement timeout (ADR-0030 decision 4). */
const QUERY_CANCELED = '57014';

function invalidRequest() {
  // Fixed text: never echo the query (ADR-0030 decision 6).
  return NextResponse.json(
    {
      error: {
        code: 'invalid_request',
        message: 'Body must be a JSON object with a query of 1 to 200 characters.',
      },
    },
    { status: 400 },
  );
}

/**
 * ADR-0030: POST /api/knowledge-search — keyword search over the caller's
 * clinic's ready knowledge documents, for every active staff role (decision
 * 5: receptionists answer patients). Body: `{ query }`.
 *
 * The query arrives in the body, never in the URL, so it does not reach
 * access logs; this route never logs it, stores it or echoes it in an error
 * (decision 6). `clinicId` comes only from the validated session; RLS is the
 * isolation boundary. There is deliberately no GET handler.
 *
 * Response: `{ data: { outcome: 'results', results: [...] } }` with at most
 * ten `{ documentId, filename, ordinal, content }` items, the chunk text
 * exactly as stored; or `{ data: { outcome: 'no_terms', results: [] } }` when
 * the query holds no search term. A search that hits its timeout returns 503
 * `search_timeout`.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await validateSession(token);

  if (!session) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'No valid session.' } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidRequest();
  }
  const query = (body as Record<string, unknown>).query;
  if (typeof query !== 'string') {
    return invalidRequest();
  }

  try {
    const result = await searchKnowledgeBase(session.clinicId, query);
    return NextResponse.json({
      data:
        result.outcome === 'results'
          ? { outcome: 'results', results: result.hits }
          : { outcome: 'no_terms', results: [] },
    });
  } catch (err) {
    if (err instanceof InvalidKnowledgeSearchQueryError) {
      return invalidRequest();
    }
    if (err instanceof DatabaseError && err.code === QUERY_CANCELED) {
      return NextResponse.json(
        { error: { code: 'search_timeout', message: 'The search took too long. Try again.' } },
        { status: 503 },
      );
    }
    // Anything else: a generic 500 with no detail. The error is rethrown
    // without the query; pg error messages never contain bind values.
    throw err;
  }
}
