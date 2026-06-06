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
});
