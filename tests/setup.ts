import { config } from 'dotenv';

// Loads .env.local for local `npm test` runs (mirrors CONTRIBUTING.md's
// `cp .env.example .env.local` setup step). In CI, DATABASE_URL and
// APP_DATABASE_URL are already set as job-level environment variables, so
// this is a no-op there (dotenv silently does nothing if the file is
// absent).
config({ path: '.env.local' });
