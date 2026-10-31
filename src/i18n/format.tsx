import { Fragment, type ReactNode } from 'react';

/**
 * Dictionary values are plain strings (they cross the server/client boundary
 * as props), with `{name}` placeholders. These helpers fill them. A
 * placeholder with no value is left as written, so a missing value is visible
 * in review rather than silently dropped.
 */
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function format(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

/** Like `format`, for values that are elements (for example a `dir="ltr"` span). */
export function formatParts(
  template: string,
  values: Readonly<Record<string, ReactNode>>,
): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const [whole, name] = match;
    const start = match.index ?? 0;
    if (start > last) parts.push(template.slice(last, start));
    parts.push(name !== undefined && Object.hasOwn(values, name) ? values[name] : whole);
    last = start + whole.length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

/** The `{name}` placeholders a template uses, in order. */
export function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}
