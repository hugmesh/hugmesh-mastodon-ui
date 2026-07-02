// Shared per-scenario state. playwright-bdd recreates the test instance for
// each scenario so we reset these maps in the After() hook in
// features/support/fixtures.ts. Keys are usernames so steps can reference a user
// by name without threading a token/page through.

import { BrowserContext, Page } from '@playwright/test';

export const pageRegistry = new Map<string, Page>();
export const ctxRegistry = new Map<string, BrowserContext>();

/** Last HTTP status code captured by an API-style step (the cross-user DENY
 *  assertions read this). Module-global instead of test-info attached so the
 *  assertion step doesn't need to thread the World through. Cleared on
 *  scenario teardown. */
export const responseState = { lastStatus: 0 };

/** A status a scenario CREATED (its unique marker text + the REAL id/visibility
 *  captured off the POST /api/v1/statuses response). Keyed by the feature-facing
 *  tag (e.g. "pv-public") so observation steps grep for the true oracle instead
 *  of a fabricated one. */
export interface CreatedStatus {
  text: string;
  id: string | null;
  visibility: string | null;
}
export const statusRegistry = new Map<string, CreatedStatus>();

/** Full envelope of the last moderation/compose API call (status + parsed JSON
 *  body) — the honest-envelope assertions (202/pending/STUBBED/degraded, never a
 *  fake OK) read both. */
export const apiEnvelope: { status: number; body: unknown } = { status: 0, body: null };

export function resetRegistry(): void {
  pageRegistry.clear();
  ctxRegistry.clear();
  statusRegistry.clear();
  responseState.lastStatus = 0;
  apiEnvelope.status = 0;
  apiEnvelope.body = null;
}
