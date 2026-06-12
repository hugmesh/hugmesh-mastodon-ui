import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SearchComponent } from './search.component';
import { MastodonService, SearchResults } from './mastodon.service';

const EMPTY: SearchResults = { accounts: [], statuses: [], hashtags: [] };

describe('SearchComponent', () => {
  let fixture: ComponentFixture<SearchComponent>;
  let component: SearchComponent;
  let mastodon: jasmine.SpyObj<MastodonService>;

  beforeEach(async () => {
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['search']);
    mastodon.search.and.resolveTo(EMPTY);

    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [{ provide: MastodonService, useValue: mastodon }, provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('associates a label with the search input (WCAG 3.3.2)', () => {
    const input = el().querySelector<HTMLInputElement>('[data-testid="search-input"]')!;
    expect(input.id).toBe('search-input');
    expect(el().querySelector('label[for="search-input"]')).not.toBeNull();
  });

  it('marks the active type filter with aria-pressed', () => {
    const buttons = el().querySelectorAll('.search-tabs button');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true'); // 'all'
    component.selectType('accounts');
    fixture.detectChanges();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('announces the ASCII screenReaderName (not the non-ASCII display_name) in the result avatar alt', (done) => {
    mastodon.search.and.resolveTo({
      ...EMPTY,
      accounts: [
        { acct: 'taro', username: 'taro', display_name: '山田太郎', avatar: 'https://cdn/a.png', screen_reader_name: 'Yamada Taro' } as never,
      ],
    });
    component.query = 'taro';
    component.onQueryChange('taro');
    setTimeout(() => {
      fixture.detectChanges();
      const img = el().querySelector<HTMLImageElement>('[data-testid="search-results-accounts"] img')!;
      expect(img.getAttribute('alt')).toBe('Yamada Taro avatar');
      // The visible name still shows the display_name verbatim.
      expect(el().querySelector('[data-testid="search-results-accounts"] .name')?.textContent).toContain('山田太郎');
      done();
    }, 400);
  });

  it('falls back to display_name then @username for the avatar alt when no screenReaderName exists', () => {
    expect(component.accountName({ display_name: 'Alice', username: 'alice' } as never)).toBe('Alice');
    expect(component.accountName({ display_name: '', username: 'bob' } as never)).toBe('bob');
  });

  it('shows all sections under the "all" filter and only one under a specific type', () => {
    expect(component.showSection('accounts')).toBeTrue();
    expect(component.showSection('statuses')).toBeTrue();
    component.selectType('hashtags');
    expect(component.showSection('hashtags')).toBeTrue();
    expect(component.showSection('accounts')).toBeFalse();
  });

  it('debounces input and clears results immediately for an empty query', (done) => {
    component.query = '';
    component.onQueryChange('');
    expect(component.results()).toEqual(EMPTY);

    component.query = 'cats';
    component.onQueryChange('cats');
    // not called synchronously (debounced)
    expect(mastodon.search).not.toHaveBeenCalled();
    setTimeout(() => {
      expect(mastodon.search).toHaveBeenCalledWith('cats', jasmine.objectContaining({ resolve: true }));
      done();
    }, 400);
  });
});
