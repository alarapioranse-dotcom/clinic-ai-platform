'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { enErrors } from './dictionaries/en-errors';

export type ErrorsMessages = typeof enErrors;

const ErrorsContext = createContext<ErrorsMessages | null>(null);

/**
 * Carries only the `errors` namespace to the error page,
 * src/app/(staff)/error.tsx (ADR-0027 decision 4: no provider holds the
 * whole dictionary). Both root layouts render it around every page
 * (src/app/RootDocument.tsx).
 */
export function ErrorsProvider({
  messages,
  children,
}: {
  messages: ErrorsMessages;
  children: ReactNode;
}) {
  return <ErrorsContext.Provider value={messages}>{children}</ErrorsContext.Provider>;
}

/**
 * The error page's text. Falls back to the English `errors` namespace if the
 * provider is missing, so the error page still renders text rather than
 * failing itself. Both root layouts always provide it: the marketing one with
 * Arabic, the staff one with the staff locale.
 */
export function useErrorsMessages(): ErrorsMessages {
  return useContext(ErrorsContext) ?? enErrors;
}
