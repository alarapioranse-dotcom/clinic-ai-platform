import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0027 slice 1 guards, scanning the source of the staff UI.
 *
 * Scope = what ADR-0027 decision 2 localizes: the staff route group (its
 * root layout, the (app) and (auth) groups, the error and not-found pages),
 * the shared root document, the app shell components, the environment
 * notice, and the app navigation config. Out of scope, by name:
 * the marketing pages (Arabic-only by ADR-0027) and everything else under
 * src that is not UI (for example the knowledge-base chunker, whose Arabic
 * characters are sentence punctuation it splits on).
 */
const ROOT = join(__dirname, '..', '..', '..');
const SCOPE = [
  'src/app/(staff)',
  'src/app/RootDocument.tsx',
  'src/components/app',
  'src/components/EnvironmentNotice.tsx',
  'src/config/environment-notice.ts',
  'src/config/navigation.ts',
];

function filesUnder(path: string): string[] {
  const full = join(ROOT, path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((name) => filesUnder(join(path, name)));
}

const scopedFiles = SCOPE.flatMap(filesUnder).filter((file) => /\.(ts|tsx)$/.test(file));
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('staff UI source (ADR-0027 slice 1)', () => {
  it('scans a non-trivial set of files', () => {
    expect(scopedFiles.length).toBeGreaterThan(30);
  });

  it('has no Arabic text outside src/i18n', () => {
    const offenders = scopedFiles.flatMap((file) =>
      read(file)
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => /\p{Script=Arabic}/u.test(line))
        .map(({ index, line }) => `${file}:${index + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('formats dates and numbers with the active locale, never a hardcoded one', () => {
    const offenders = scopedFiles.filter((file) =>
      /toLocale(?:Date|Time)?String\(\s*['"]|Intl\.\w+\(\s*['"]/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('uses logical, not physical, left/right spacing classes', () => {
    const offenders = scopedFiles.filter((file) =>
      /(?:^|[\s"'`])-?(?:ml|mr|pl|pr)-\d/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('never imports a whole dictionary into a client component at runtime', () => {
    const clientFiles = [...scopedFiles, ...filesUnder('src/i18n')].filter((file) =>
      /^\s*['"]use client['"]/.test(read(file)),
    );
    expect(clientFiles.length).toBeGreaterThan(10);
    for (const file of clientFiles) {
      const runtimeImports = [
        ...read(file).matchAll(/^import\s+(?!type\s)[^;]*?from\s+['"]([^'"]+)['"]/gms),
      ].map((match) => match[1]!);
      for (const source of runtimeImports) {
        expect(source, `${relative(ROOT, file)} imports ${source}`).not.toMatch(
          /i18n\/(?:server|dictionaries(?:\/(?:index|ar))?)$|\/dictionaries$|\/dictionaries\/ar$/,
        );
      }
    }
  });
});
