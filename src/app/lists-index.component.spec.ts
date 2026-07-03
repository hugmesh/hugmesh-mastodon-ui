import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ListsIndexComponent } from './lists-index.component';
import { MastodonService, MastodonList } from './mastodon.service';

function makeList(over: Partial<MastodonList> = {}): MastodonList {
  return { id: 'l1', title: 'Friends', replies_policy: 'list', ...over };
}

describe('ListsIndexComponent', () => {
  let fixture: ComponentFixture<ListsIndexComponent>;
  let component: ListsIndexComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['lists', 'createList']);
    mastodon.lists.and.resolveTo([makeList(), makeList({ id: 'l2', title: 'Work' })]);
    // Default: echo the requested title back as the created list (the real POST
    // response carries the server-assigned id + replies_policy).
    mastodon.createList.and.callFake(async (title: string) => makeList({ id: `new-${title}`, title }));

    await TestBed.configureTestingModule({
      imports: [ListsIndexComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ListsIndexComponent);
    component = fixture.componentInstance;
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function submitBtn(): HTMLButtonElement {
    return el().querySelector<HTMLButtonElement>('[data-testid="list-create-submit"]')!;
  }

  it('loads the user lists on init', async () => {
    await component.ngOnInit();
    expect(mastodon.lists).toHaveBeenCalled();
    expect(component.lists().length).toBe(2);
  });

  it('renders each list as a semantic list item linking to its timeline', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    const items = el().querySelectorAll('ul.list-rows li.list-item');
    expect(items.length).toBe(2);
    const firstLink = items[0].querySelector<HTMLAnchorElement>('a.list-link')!;
    expect(firstLink.textContent).toContain('Friends');
    expect(firstLink.getAttribute('href')).toContain('/lists/l1');
  });

  it('labels the section with its heading via aria-labelledby', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    const section = el().querySelector('[data-testid="lists-index"]')!;
    const labelledby = section.getAttribute('aria-labelledby');
    expect(labelledby).toBe('lists-heading');
    expect(el().querySelector(`#${labelledby}`)?.textContent).toContain('Lists');
  });

  // ── Create-list control ──────────────────────────────────────────────────

  it('disables the create submit and refuses to POST for an empty / whitespace title', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    // Empty by default → the button is disabled and canCreate() is false.
    expect(component.canCreate()).toBeFalse();
    expect(submitBtn().disabled).toBeTrue();

    // A whitespace-only title is still empty after trim: create() must no-op —
    // no POST reaches the wire and the index is untouched.
    component.newTitle = '   ';
    fixture.detectChanges();
    expect(component.canCreate()).toBeFalse();
    expect(submitBtn().disabled).toBeTrue();
    await component.create();
    expect(mastodon.createList).not.toHaveBeenCalled();
    expect(component.lists().length).toBe(2);
  });

  it('enables the submit once a non-blank title is entered', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    expect(submitBtn().disabled).toBeTrue();

    component.newTitle = 'Reading';
    fixture.detectChanges();
    expect(component.canCreate()).toBeTrue();
    expect(submitBtn().disabled).toBeFalse();
  });

  it('POSTs the trimmed title, prepends the created list and clears the input', async () => {
    await component.ngOnInit();
    fixture.detectChanges();

    component.newTitle = '  Reading  ';
    await component.create();
    fixture.detectChanges();

    // POSTed the TRIMMED title (not the padded raw value).
    expect(mastodon.createList).toHaveBeenCalledOnceWith('Reading');
    // The server-confirmed list is now in the index (prepended) and rendered.
    expect(component.lists().length).toBe(3);
    expect(component.lists()[0].title).toBe('Reading');
    const titles = Array.from(el().querySelectorAll('[data-testid="list-link"]')).map((a) => a.textContent?.trim());
    expect(titles).toContain('Reading');
    // Input cleared for the next create; no error surfaced.
    expect(component.newTitle).toBe('');
    expect(component.createError()).toBeNull();
  });

  it('surfaces an error and leaves the index unchanged when the create is rejected', async () => {
    await component.ngOnInit();
    fixture.detectChanges();
    mastodon.createList.and.rejectWith(new Error('POST /api/v1/lists failed: 422'));

    component.newTitle = 'Doomed';
    await component.create();
    fixture.detectChanges();

    expect(mastodon.createList).toHaveBeenCalledOnceWith('Doomed');
    // Rejection announced, index untouched, typed title kept, not stuck in-flight.
    const alert = el().querySelector('[data-testid="list-create-error"]');
    expect(alert).withContext('an assertive error alert is rendered').not.toBeNull();
    expect(alert!.getAttribute('role')).toBe('alert');
    expect(component.createError()).toContain('Could not create');
    expect(component.lists().length).toBe(2);
    expect(component.newTitle).toBe('Doomed');
    expect(component.creating()).toBeFalse();
  });

  it('clears a prior error on the next create attempt', async () => {
    await component.ngOnInit();
    component.createError.set('stale error');

    component.newTitle = 'Fresh';
    await component.create();

    expect(component.createError()).toBeNull();
    expect(component.lists()[0].title).toBe('Fresh');
  });
});
