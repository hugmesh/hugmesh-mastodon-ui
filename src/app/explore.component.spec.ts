import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ExploreComponent } from './explore.component';
import { MastodonService, Tag } from './mastodon.service';

describe('ExploreComponent', () => {
  let fixture: ComponentFixture<ExploreComponent>;
  let component: ExploreComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', [
      'trendingStatuses',
      'trendingTags',
      'trendingLinks',
    ]);
    mastodon.trendingStatuses.and.resolveTo([]);
    mastodon.trendingTags.and.resolveTo([{ name: 'angular', url: '', history: [] } as Tag]);
    mastodon.trendingLinks.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [ExploreComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ExploreComponent);
    component = fixture.componentInstance;
  });

  async function render() {
    await component.ngOnInit();
    fixture.detectChanges();
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('loads trending posts on init', async () => {
    await render();
    expect(mastodon.trendingStatuses).toHaveBeenCalled();
  });

  it('marks the active explore tab with aria-pressed', async () => {
    await render();
    const posts = el().querySelector('[data-testid="explore-tab-posts"]')!;
    const tags = el().querySelector('[data-testid="explore-tab-tags"]')!;
    expect(posts.getAttribute('aria-pressed')).toBe('true');
    expect(tags.getAttribute('aria-pressed')).toBe('false');

    component.selectTab('tags');
    fixture.detectChanges();
    expect(posts.getAttribute('aria-pressed')).toBe('false');
    expect(tags.getAttribute('aria-pressed')).toBe('true');
    expect(mastodon.trendingTags).toHaveBeenCalled();
  });

  it('warns screen-reader users that trending links open in a new tab', async () => {
    mastodon.trendingLinks.and.resolveTo([
      { url: 'https://x', title: 'News', provider_name: 'P', image: null } as never,
    ]);
    await render();
    component.selectTab('links');
    await fixture.whenStable();
    fixture.detectChanges();
    const link = el().querySelector<HTMLAnchorElement>('.trending-link')!;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.querySelector('.sr')?.textContent).toContain('new tab');
  });

  // ── Empty states (regression) ─────────────────────────────────────────────
  // A trends fetch returning nothing (offline/degraded homeserver, or a quiet
  // instance) used to leave the selected panel an empty zero-height <div> —
  // a blank Explore page with nothing explaining it. Each panel now says so.
  it('explains an empty trending panel instead of rendering a blank one', async () => {
    // The default spies already resolve posts + links to [] and tags to one tag.
    await render();
    // render()'s first detectChanges() triggers Angular's OWN ngOnInit pass,
    // which re-enters reload() and flips `loading` back on — settle it so the
    // assertion sees the loaded-and-empty state, not the in-flight one.
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = () => el().querySelector('[data-testid="explore-panel-posts"]')!;
    expect(panel().querySelector('.empty')?.textContent).toContain('No trending posts');
    // The empty state is INSIDE the panel the tab gates, not a page-level notice.
    expect(panel().getAttribute('data-testid')).toBe('explore-panel-posts');

    // A NON-empty panel must NOT show the empty state — the positive control
    // that keeps this assertion honest (tags resolves to one real tag).
    component.selectTab('tags');
    await fixture.whenStable();
    fixture.detectChanges();
    const tagsPanel = el().querySelector('[data-testid="explore-panel-tags"]')!;
    expect(tagsPanel.querySelectorAll('.trending-tag').length).toBe(1);
    expect(tagsPanel.querySelector('.empty')).toBeNull();
  });
});
