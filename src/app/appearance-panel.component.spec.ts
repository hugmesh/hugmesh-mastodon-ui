import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppearancePanelComponent } from './appearance-panel.component';
import { SessionService, SnapSession } from './session.service';
import { PreferencesService, PREFS_STORAGE_KEY, ORG_DEFAULT_LOCAL_KEY } from './preferences.service';

function makeSession(over: Partial<SnapSession> = {}): SnapSession {
  return {
    id: 'google:alice@gmail.com',
    label: 'alice@gmail.com',
    provider: 'google',
    roles: ['user'],
    registrationComplete: true,
    ...over,
  };
}

/** A `.snap-mastodon` remote root the service styles (matches the timeline). */
function makeRoot(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'snap-mastodon';
  document.body.appendChild(el);
  return el;
}

describe('AppearancePanelComponent', () => {
  let fixture: ComponentFixture<AppearancePanelComponent>;
  let component: AppearancePanelComponent;
  let session: SessionService;
  let root: HTMLElement;

  function open(roles: string[]): HTMLElement {
    session.set(makeSession({ roles }));
    fixture.detectChanges();
    component.toggle();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    localStorage.clear();
    document.querySelectorAll('.snap-mastodon').forEach((n) => n.remove());
    root = makeRoot();

    await TestBed.configureTestingModule({
      imports: [AppearancePanelComponent],
      providers: [SessionService, PreferencesService],
    }).compileComponents();

    fixture = TestBed.createComponent(AppearancePanelComponent);
    component = fixture.componentInstance;
    session = TestBed.inject(SessionService);
  });

  afterEach(() => {
    localStorage.clear();
    document.querySelectorAll('.snap-mastodon').forEach((n) => n.remove());
  });

  it('renders a gear trigger reflecting the open state via aria-expanded', () => {
    session.set(makeSession({ roles: ['user'] }));
    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="appearance-trigger"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    component.toggle();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('selecting a layout option sets the layout data attribute on the remote root + persists', () => {
    open(['user']);
    const multi = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="layout-multi"]')!;
    multi.checked = true;
    multi.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(root.getAttribute('data-mastodon-layout')).toBe('multi');
    expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!).layout).toBe('multi');
  });

  it('selecting a theme applies the theme attribute live', () => {
    open(['user']);
    component.setTheme('mono');
    expect(root.getAttribute('data-mastodon-theme')).toBe('mono');
  });

  it('the dyslexia-friendly font option applies the font attribute', () => {
    open(['user']);
    component.setFont('dyslexic');
    expect(root.getAttribute('data-mastodon-font')).toBe('dyslexic');
  });

  it('the high-contrast toggle applies + removes the contrast attribute', () => {
    open(['user']);
    component.setHighContrast(true);
    expect(root.getAttribute('data-mastodon-contrast')).toBe('on');
    component.setHighContrast(false);
    expect(root.getAttribute('data-mastodon-contrast')).toBeNull();
  });

  it('the reduced-motion toggle applies + removes the motion attribute', () => {
    open(['user']);
    component.setReducedMotion(true);
    expect(root.getAttribute('data-mastodon-motion')).toBe('on');
    component.setReducedMotion(false);
    expect(root.getAttribute('data-mastodon-motion')).toBeNull();
  });

  it('text-size selection sets the --mastodon-text-size custom property', () => {
    open(['user']);
    component.setTextSize('lg');
    expect(root.style.getPropertyValue('--mastodon-text-size')).toBe('1.125rem');
  });

  it('announces the applied change in the live region', (done) => {
    open(['user']);
    component.setAccent('rose');
    // announce() defers via setTimeout; flush a macrotask.
    setTimeout(() => {
      fixture.detectChanges();
      const live = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="appearance-live"]')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(live.textContent).toContain('Applied');
      done();
    });
  });

  // ── ROLE GATING: only admin sees the default-setter ─────────────────────
  it('a plain USER does NOT see the admin default-setter', () => {
    const el = open(['user']);
    expect(el.querySelector('[data-testid="admin-default-section"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-set-default"]')).toBeNull();
  });

  it('a MOD does NOT see the admin default-setter', () => {
    const el = open(['user', 'mod']);
    expect(el.querySelector('[data-testid="admin-default-section"]')).toBeNull();
  });

  it('an ADMIN sees the admin default-setter', () => {
    const el = open(['user', 'admin']);
    expect(el.querySelector('[data-testid="admin-default-section"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-set-default"]')).not.toBeNull();
  });

  it('admin set-default writes the org default a non-customised user would inherit', () => {
    open(['user', 'admin']);
    component.setLayout('multi');
    component.setAccent('sky');
    component.setAsDefaultForEveryone();
    const org = JSON.parse(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)!);
    expect(org.layout).toBe('multi');
    expect(org.accent).toBe('sky');
  });

  it('a non-admin cannot set the org default even if the method is called (defence-in-depth)', () => {
    open(['user']);
    component.setAsDefaultForEveryone();
    expect(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)).toBeNull();
  });

  // ── a11y / keyboard ─────────────────────────────────────────────────────
  it('the panel is a labelled dialog with fieldset/legend groups', () => {
    const el = open(['user']);
    const panel = el.querySelector('[data-testid="appearance-panel"]')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-labelledby')).toBe('appearance-title');
    expect(el.querySelectorAll('fieldset legend').length).toBeGreaterThan(5);
    expect(el.querySelectorAll('[role="radiogroup"]').length).toBeGreaterThan(5);
  });

  it('Escape closes the open panel and restores focus to the trigger', () => {
    // Attach to the document so .focus() actually moves activeElement (WCAG 2.1.2:
    // a dialog must be Escape-closable and return focus to the control that opened it).
    document.body.appendChild(fixture.nativeElement);
    const el = open(['user']);
    expect(component.open()).toBeTrue();
    const panel = el.querySelector('[data-testid="appearance-panel"]')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.open()).toBeFalse();
    const trigger = el.querySelector('[data-testid="appearance-trigger"]')!;
    expect(document.activeElement).withContext('focus returns to the gear trigger').toBe(trigger);
    fixture.nativeElement.remove();
  });

  it('reset-to-default clears the user prefs', () => {
    open(['user']);
    component.setTheme('mono');
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).not.toBeNull();
    component.resetToDefault();
    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
  });

  // ── CHAT theme section (personal-only) ───────────────────────────────────
  describe('chat section', () => {
    it('renders the chat section with a live two-bubble preview and every control group', () => {
      const el = open(['user']);
      expect(el.querySelector('[data-testid="chat-section"]')).not.toBeNull();
      const preview = el.querySelector('[data-testid="chat-preview"]')!;
      expect(preview.getAttribute('aria-hidden')).withContext('decorative preview').toBe('true');
      expect(preview.querySelector('.chat-bubble.chat-bubble--mine')).not.toBeNull();
      expect(preview.querySelector('.chat-bubble.chat-bubble--theirs')).not.toBeNull();
      expect(preview.querySelector('.vn-dialog')).withContext('vn skin sample').not.toBeNull();
      for (const id of [
        'chat-shape-rounded', 'chat-shape-square', 'chat-shape-sharp',
        'chat-accent-mine', 'chat-accent-theirs',
        'chat-font-system', 'chat-font-serif', 'chat-font-rounded', 'chat-font-mono',
        'chat-density-cozy', 'chat-density-compact',
        'chat-bg-none', 'chat-bg-dots', 'chat-bg-lined', 'chat-bg-stars',
        'chat-vnskin-classic', 'chat-vnskin-glass', 'chat-vnskin-retro',
        'chat-reset',
      ]) {
        expect(el.querySelector(`[data-testid="${id}"]`)).withContext(id).not.toBeNull();
      }
    });

    it('selecting a bubble shape via the radio applies the chat-shape attribute + persists', () => {
      open(['user']);
      const sharp = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="chat-shape-sharp"]')!;
      sharp.checked = true;
      sharp.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(root.getAttribute('data-mastodon-chat-shape')).toBe('sharp');
      expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!).chatBubbleShape).toBe('sharp');
    });

    it('picking a bubble colour applies the validated --mastodon-chat-accent-* var', () => {
      open(['user']);
      const mine = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-testid="chat-accent-mine"]')!;
      mine.value = '#ff0066';
      mine.dispatchEvent(new Event('change'));
      fixture.detectChanges();
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('#ff0066');
      expect(JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY)!).chatAccentMine).toBe('#ff0066');
    });

    it('the chat background and vn-skin radios apply their attributes live', () => {
      open(['user']);
      component.setChatBackground('stars');
      expect(root.getAttribute('data-mastodon-chat-bg')).toBe('stars');
      component.setVnSkin('retro');
      expect(root.getAttribute('data-mastodon-chat-vnskin')).toBe('retro');
      component.setChatDensity('compact');
      expect(root.getAttribute('data-mastodon-chat-density')).toBe('compact');
      component.setChatFont('mono');
      expect(root.getAttribute('data-mastodon-chat-font')).toBe('mono');
    });

    it('Reset chat style restores the chat defaults but keeps non-chat choices', () => {
      open(['user']);
      component.setTheme('mono');
      component.setChatBackground('dots');
      component.setChatAccentMine('#ff0066');
      const reset = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="chat-reset"]')!;
      reset.click();
      fixture.detectChanges();
      expect(root.getAttribute('data-mastodon-chat-bg')).toBe('none');
      expect(root.style.getPropertyValue('--mastodon-chat-accent-mine')).toBe('');
      expect(root.getAttribute('data-mastodon-theme')).withContext('non-chat choice untouched').toBe('mono');
    });

    it('announces an applied chat change in the live region', (done) => {
      open(['user']);
      component.setChatShape('square');
      setTimeout(() => {
        fixture.detectChanges();
        const live = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="appearance-live"]')!;
        expect(live.textContent).toContain('Chat bubble shape');
        expect(live.textContent).toContain('Applied');
        done();
      });
    });

    it('the chat section carries NO admin-default control — chat theming is personal-only', () => {
      const el = open(['user', 'admin']);
      const chat = el.querySelector('[data-testid="chat-section"]')!;
      expect(chat.querySelector('[data-testid="admin-set-default"]')).toBeNull();
      expect(chat.querySelector('[data-testid="admin-default-section"]')).toBeNull();
    });

    it("the admin org default never carries the admin's own chat styling", () => {
      open(['user', 'admin']);
      component.setChatAccentMine('#ff0066');
      component.setVnSkin('retro');
      component.setAsDefaultForEveryone();
      const org = JSON.parse(localStorage.getItem(ORG_DEFAULT_LOCAL_KEY)!);
      expect(org.chatAccentMine).toBe('');
      expect(org.vnDialogSkin).toBe('classic');
    });
  });

  // ── honest disclosure: a failed BFF sync is announced, never a silent no-op ──
  it('announces a preferences sync failure in the live region', (done) => {
    open(['user']);
    const prefsSvc = TestBed.inject(PreferencesService);
    prefsSvc.syncError.set('Could not save "theme" to your account — it applied here but may not follow you.');
    fixture.detectChanges();
    setTimeout(() => {
      fixture.detectChanges();
      const live = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="appearance-live"]')!;
      expect(live.textContent).toContain('Could not save "theme"');
      done();
    });
  });
});
