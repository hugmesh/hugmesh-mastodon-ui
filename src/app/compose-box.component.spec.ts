import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComposeBoxComponent } from './compose-box.component';
import { MastodonService, Status } from './mastodon.service';

function makeStatus(over: Partial<Status> = {}): Status {
  return { id: 'posted', reblog: null, ...over } as Status;
}

describe('ComposeBoxComponent', () => {
  let fixture: ComponentFixture<ComposeBoxComponent>;
  let component: ComposeBoxComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'postStatus',
      'uploadMedia',
      'getMedia',
    ]);

    await TestBed.configureTestingModule({
      imports: [ComposeBoxComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }],
    }).compileComponents();

    fixture = TestBed.createComponent(ComposeBoxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('labels the compose textarea with a <label for> pointing at its id (WCAG 3.3.2)', () => {
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.id).toBeTruthy();
    const label = el().querySelector(`label[for="${textarea.id}"]`);
    expect(label).withContext('textarea must have an associated label').not.toBeNull();
  });

  it('gives every compose box a unique id prefix so federated instances do not collide', () => {
    const second = TestBed.createComponent(ComposeBoxComponent).componentInstance;
    expect(component.ids.draft).not.toBe(second.ids.draft);
  });

  it('announces the live character count via aria-live and describes the textarea', () => {
    const count = el().querySelector('[data-testid="compose-char-count"]')!;
    expect(count.getAttribute('aria-live')).toBe('polite');
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.getAttribute('aria-describedby')).toBe(count.id);
  });

  it('marks the textarea invalid and surfaces an assertive alert when over the limit', () => {
    component.draft = 'x'.repeat(501);
    component['draftSig'].set(component.draft);
    fixture.detectChanges();
    const textarea = el().querySelector<HTMLTextAreaElement>('[data-testid="mastodon-input"]')!;
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
    const alert = el().querySelector('[data-testid="compose-error"]')!;
    expect(alert).not.toBeNull();
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('exposes the CW and poll toggles as aria-pressed buttons reflecting their state', () => {
    const cw = el().querySelector('[data-testid="compose-cw-toggle"]')!;
    const poll = el().querySelector('[data-testid="compose-poll-toggle"]')!;
    expect(cw.getAttribute('aria-pressed')).toBe('false');
    expect(poll.getAttribute('aria-pressed')).toBe('false');
    component.toggleCw();
    component.togglePoll();
    fixture.detectChanges();
    expect(cw.getAttribute('aria-pressed')).toBe('true');
    expect(poll.getAttribute('aria-pressed')).toBe('true');
  });

  it('computes remaining characters and gates posting on the 500-char limit', () => {
    component.draft = 'hello';
    component['draftSig'].set('hello');
    expect(component.remaining()).toBe(495);
    expect(component.canPost()).toBeTrue();

    component.draft = 'x'.repeat(501);
    component['draftSig'].set(component.draft);
    expect(component.remaining()).toBeLessThan(0);
    expect(component.canPost()).toBeFalse();
  });

  it('posts the trimmed draft via the service and emits the created status', async () => {
    component.draft = '  hi there  ';
    component['draftSig'].set(component.draft);
    const created = makeStatus();
    mastodon.postStatus.and.resolveTo(created);

    const emitted: Status[] = [];
    component.posted.subscribe((s) => emitted.push(s));

    await component.submit();

    expect(mastodon.postStatus).toHaveBeenCalled();
    const [params] = mastodon.postStatus.calls.mostRecent().args;
    expect(params.status).toBe('hi there');
    expect(emitted).toEqual([created]);
  });
});
