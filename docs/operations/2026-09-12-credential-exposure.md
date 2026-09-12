# Incident Record — Production Database Credential Exposure

**Date:** 2026-09-12
**Status:** Contained

Production database credential was exposed during screen sharing; credential rotation was performed immediately; the exposed credential was permanently deleted; application and operational access were moved to the replacement credential; no production data was accessed or modified as a consequence.

## Known gap, unrelated to this incident

Render Inbound IP Restrictions for `clinic-ai-db` are `0.0.0.0/0` (free-tier default). The External Database URL is reachable from the public internet. Narrowing this is not currently possible: operational access is from a mobile connection with no static IP. Recorded as a known gap.
