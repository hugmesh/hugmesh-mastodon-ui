import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

/**
 * The dev shell is only used when the remote is served standalone, but it must
 * still be accessible: a skip link + a focusable <main> landmark wrapping the
 * router outlet (WCAG 2.4.1 Bypass Blocks).
 */
describe('AppComponent (standalone dev shell)', () => {
  let fixture: ComponentFixture<AppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('creates the shell', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a skip link that targets the main landmark', () => {
    const skip = el().querySelector<HTMLAnchorElement>('a.skip')!;
    expect(skip).not.toBeNull();
    expect(skip.getAttribute('href')).toBe('#main-content');
    const main = el().querySelector('main#main-content');
    expect(main).not.toBeNull();
  });

  it('mounts the router outlet inside the focusable main landmark', () => {
    const main = el().querySelector('main#main-content')!;
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(main.querySelector('router-outlet')).not.toBeNull();
  });
});
