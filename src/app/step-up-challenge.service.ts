import { Injectable, InjectionToken, Type, ViewContainerRef, inject } from '@angular/core';
import { loadRemoteModule } from '@angular-architects/native-federation';

/** What happened to a step-up challenge rendered in place.
 *   - satisfied:   the session now carries a fresh MFA stamp — retry the action.
 *   - dismissed:   the user chose "Not now" — do not retry.
 *   - unavailable: the MFA surface is not enabled (it answers 503 while it
 *                  ships dark) — fall back to the caller's own message.
 *   - missing:     the login remote could not be loaded at all. */
export type StepUpOutcome = 'satisfied' | 'dismissed' | 'unavailable' | 'missing';

/** The slice of login-ui's exposed `./mfa-step-up` module this remote uses
 *  (login-ui src/app/mfa-step-up.ts). */
export interface MfaStepUpModule {
  loadMfaStepUpComponent?: () => Promise<Type<unknown>>;
  MfaStepUpComponent?: Type<unknown>;
}

/** The three outputs of login-ui's step-up component. */
interface StepUpInstance {
  satisfied: { subscribe(fn: () => void): unknown };
  dismissed: { subscribe(fn: () => void): unknown };
  unavailable: { subscribe(fn: () => void): unknown };
}

/** The remote name and exposed module the login remote publishes. login-ui NOTE 1:
 *  pass `remoteEntry` (the object form) — the host shell registers no remote
 *  eagerly, so the two-argument overload finds nothing until the user has visited
 *  /login this session. */
export const LOGIN_STEP_UP_REMOTE = {
  remoteEntry: '/login/remoteEntry.json',
  remoteName: 'login',
  exposedModule: './mfa-step-up',
} as const;

/** Seam for loading the login remote. The default talks to native federation; a
 *  spec provides a stub, because an ESM namespace export cannot be spied on. */
export const STEP_UP_REMOTE_LOADER = new InjectionToken<() => Promise<MfaStepUpModule>>(
  'STEP_UP_REMOTE_LOADER',
  { providedIn: 'root', factory: () => () => loadRemoteModule<MfaStepUpModule>({ ...LOGIN_STEP_UP_REMOTE }) },
);

/**
 * Renders the login remote's federated MFA step-up challenge in place, inside
 * a caller-supplied {@link ViewContainerRef}, and reports how it ended. Never
 * rejects: a remote that cannot be loaded, or a component that cannot be
 * created, resolves `'missing'` so the caller can say so honestly.
 */
@Injectable({ providedIn: 'root' })
export class StepUpChallengeService {
  private readonly loadRemote = inject(STEP_UP_REMOTE_LOADER);

  async challenge(host: ViewContainerRef): Promise<StepUpOutcome> {
    let ref: { instance: unknown; destroy(): void; onDestroy(fn: () => void): void };
    try {
      const mod = await this.loadRemote();
      const cmp = mod.loadMfaStepUpComponent ? await mod.loadMfaStepUpComponent() : mod.MfaStepUpComponent;
      if (!cmp) return 'missing';
      ref = host.createComponent(cmp);
    } catch {
      return 'missing';
    }
    const inst = ref.instance as StepUpInstance;
    return new Promise<StepUpOutcome>((resolve) => {
      let settled = false;
      const settle = (o: StepUpOutcome) => {
        if (settled) return;
        settled = true;
        ref.destroy();
        resolve(o);
      };
      // The panel closing (or the menu being destroyed) tears the dialog down
      // under us: that is a dismissal, so the caller's busy state is released.
      ref.onDestroy(() => {
        if (settled) return;
        settled = true;
        resolve('dismissed');
      });
      try {
        inst.satisfied.subscribe(() => settle('satisfied'));
        inst.dismissed.subscribe(() => settle('dismissed'));
        inst.unavailable.subscribe(() => settle('unavailable'));
      } catch {
        settle('missing');
      }
    });
  }
}
