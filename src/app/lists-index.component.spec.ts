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
    mastodon = jasmine.createSpyObj<MastodonService>('MastodonService', ['lists']);
    mastodon.lists.and.resolveTo([makeList(), makeList({ id: 'l2', title: 'Work' })]);

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
});
