/**
 * Side-effect module: loads .env.local before anything else is evaluated.
 * Imported first by scripts whose static imports reach src/lib/env.ts, which
 * reads its variables eagerly at module load. ES modules evaluate imports in
 * order, so importing this first is enough. A no-op when the file is absent
 * (CI, or variables passed on the command line).
 */
import { config } from 'dotenv';

config({ path: '.env.local' });
