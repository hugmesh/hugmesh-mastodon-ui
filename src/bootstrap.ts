import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {
  // HttpClient powers the new role-tiered datastore services (user-bff /
  // mod-bff). When federated into the host, the host provides its own
  // HttpClient; this standalone-dev bootstrap provides one for `ng serve mastodon`.
  providers: [provideRouter(routes), provideHttpClient(withFetch())],
}).catch((err) => console.error(err));
