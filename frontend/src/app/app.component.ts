import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18nService, TranslatePipe } from './i18n/i18n.service';
import { LANGUAGES } from './i18n/translations';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly i18n = inject(I18nService);
  readonly languages = LANGUAGES;
}
