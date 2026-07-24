// POLL step definitions (polls.feature) — composer poll creation, cross-user
// voting through PollComponent, and the server-count round trip.
//
// Oracles (all off the wire, per the feature's honesty contract):
//   - creation: POST /api/v1/statuses response must ECHO a poll whose options
//     match the requested titles;
//   - voting: POST /api/v1/polls/{id}/votes response must return the updated
//     Poll with voted:true (and own_votes matching the selection);
//   - the author-side count: expect.poll over the author's real permalink
//     view until the rendered vote-count text reflects the vote.
//
// @cluster-only; bddgen still compiles these offline.

import { expect, Page } from '@playwright/test';
import { When, Then } from '../support/fixtures';
import { pageRegistry, statusRegistry, CreatedStatus } from './_registry';
import { uniqueMarker } from '../../tests/helpers/social';

function pageOf(username: string): Page {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

function statusOf(tag: string): CreatedStatus {
  const created = statusRegistry.get(tag);
  if (!created) {
    throw new Error(`No status tagged "${tag}" was created in this scenario — add a posting step first.`);
  }
  return created;
}

/** Compose a poll status through the real composer controls. */
async function composePoll(page: Page, tag: string, options: string[], multiple: boolean): Promise<void> {
  const text = uniqueMarker(tag);
  await page.locator('[data-testid="compose-poll-toggle"]').click();
  await expect(page.locator('[data-testid="compose-poll-toggle"]')).toHaveAttribute('aria-pressed', 'true');
  // The composer starts with two option inputs; "+ option" adds up to four.
  const optionInputs = page.locator('[data-testid="compose-poll-option"]');
  for (let i = 2; i < options.length; i++) {
    await page.locator('fieldset.compose-poll button', { hasText: '+ option' }).click();
  }
  await expect(optionInputs).toHaveCount(options.length, { timeout: 5_000 });
  for (let i = 0; i < options.length; i++) {
    await optionInputs.nth(i).fill(options[i]);
  }
  if (multiple) {
    // The "Allow multiple" checkbox ships without a testid — locate it by its
    // accessible labelled control inside the poll fieldset.
    await page.locator('fieldset.compose-poll label', { hasText: 'Allow multiple' }).locator('input[type="checkbox"]').check();
  }
  await page.locator('[data-testid="mastodon-input"]').fill(text);
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/statuses') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('[data-testid="mastodon-post"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`posting the "${tag}" poll failed: ${response.status()}`);
  const body = (await response.json()) as {
    id?: string;
    visibility?: string;
    poll?: { id?: string; multiple?: boolean; options?: Array<{ title?: string }> };
  };
  // Honest creation oracle: the server must echo a poll with OUR options.
  if (!body.poll) throw new Error(`the server response for "${tag}" carries no poll — the poll was not created.`);
  const echoed = (body.poll.options ?? []).map((o) => o.title);
  expect(echoed, 'the created poll must carry the requested options in order').toEqual(options);
  expect(body.poll.multiple ?? false, 'the multiple flag must round-trip').toBe(multiple);
  statusRegistry.set(tag, { text, id: body.id ?? null, visibility: body.visibility ?? null });
}

When(
  '{string} posts a poll status tagged {string} with options {string} and {string}',
  async ({ user }, username: string, tag: string, a: string, b: string) => {
    await composePoll(pageOf(user(username).username), tag, [a, b], false);
  },
);

When(
  '{string} posts a multiple-choice poll status tagged {string} with options {string} and {string} and {string}',
  async ({ user }, username: string, tag: string, a: string, b: string, c: string) => {
    await composePoll(pageOf(user(username).username), tag, [a, b, c], true);
  },
);

/** The poll widget inside the toot-card that carries the tag's marker text,
 *  located on the voter's CURRENT timeline view. */
function pollOn(page: Page, tag: string) {
  return page
    .locator('[data-testid="toot-card"]', { hasText: statusOf(tag).text })
    .first()
    .locator('[data-testid="poll"]');
}

async function voteOn(page: Page, tag: string, choices: number[]): Promise<void> {
  const poll = pollOn(page, tag);
  await poll.waitFor({ state: 'visible', timeout: 15_000 });
  for (const oneBased of choices) {
    await poll.locator('[data-testid="poll-option"]').nth(oneBased - 1).locator('input').check();
  }
  const responsePromise = page.waitForResponse(
    (r) => /\/api\/v1\/polls\/[^/]+\/votes$/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await poll.locator('[data-testid="poll-vote"]').click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`voting on "${tag}" failed: ${response.status()}`);
  const updated = (await response.json()) as { voted?: boolean; own_votes?: number[] };
  // Honest vote oracle: the server-updated Poll must record OUR vote.
  expect(updated.voted, 'the server must record the vote (voted:true)').toBe(true);
  expect((updated.own_votes ?? []).slice().sort(), 'own_votes must match the selection').toEqual(
    choices.map((c) => c - 1).sort(),
  );
}

When('{string} selects poll option {int} on the {string} status and votes', async ({ user }, username: string, option: number, tag: string) => {
  await voteOn(pageOf(user(username).username), tag, [option]);
});

When(
  '{string} selects poll options {int} and {int} on the {string} status and votes',
  async ({ user }, username: string, first: number, second: number, tag: string) => {
    await voteOn(pageOf(user(username).username), tag, [first, second]);
  },
);

Then(
  '{string} sees the poll results with their own vote marked on the {string} status',
  async ({ user }, username: string, tag: string) => {
    const poll = pollOn(pageOf(user(username).username), tag);
    await expect(poll.locator('[data-testid="poll-results"]')).toBeVisible({ timeout: 15_000 });
    await expect(poll.locator('[data-testid="poll-option"].own')).toHaveCount(1, { timeout: 10_000 });
    // Voting is once-only: the vote controls must be gone from the widget.
    await expect(poll.locator('[data-testid="poll-vote"]')).toHaveCount(0);
  },
);

Then(
  '{string} sees the poll results with {int} own votes marked on the {string} status',
  async ({ user }, username: string, count: number, tag: string) => {
    const poll = pollOn(pageOf(user(username).username), tag);
    await expect(poll.locator('[data-testid="poll-results"]')).toBeVisible({ timeout: 15_000 });
    await expect(poll.locator('[data-testid="poll-option"].own')).toHaveCount(count, { timeout: 10_000 });
    await expect(poll.locator('[data-testid="poll-vote"]')).toHaveCount(0);
  },
);

Then(
  'the {string} poll shows {int} vote(s) to {string} within {int} seconds',
  async ({ user }, tag: string, votes: number, username: string, seconds: number) => {
    // The AUTHOR has not voted, so their widget still shows the voting view —
    // its .poll-meta carries the server-side votes_count. Poll the real
    // permalink until the count lands (id captured off the creation POST; the
    // author is same-instance by definition).
    const created = statusOf(tag);
    if (!created.id) throw new Error(`status "${tag}" has no captured id — the posting step must capture it.`);
    const page = pageOf(user(username).username);
    const expected = new RegExp(`\\b${votes} vote${votes === 1 ? '' : 's'}\\b`);
    await expect
      .poll(
        async () => {
          try {
            await page.goto(`/social/mastodon/status/${created.id}`, { waitUntil: 'domcontentloaded' });
            const meta = page
              .locator('[data-testid="status-focused"] [data-testid="poll"] .poll-meta')
              .first();
            await meta.waitFor({ state: 'visible', timeout: 10_000 });
            return (await meta.textContent()) ?? '';
          } catch {
            return '';
          }
        },
        {
          message: `the author's view of "${tag}" must show ${votes} vote(s) within ${seconds}s`,
          timeout: seconds * 1_000,
          intervals: [2_000, 3_000, 5_000],
        },
      )
      .toMatch(expected);
  },
);
