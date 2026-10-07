import { registerLocaleData } from '@angular/common';
import localePl from '@angular/common/locales/pl';
import { DOCUMENT } from '@angular/common';
import { Injectable, Pipe, PipeTransform, computed, effect, inject, signal } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { LANGUAGES, Lang, TRANSLATIONS, TranslationKey } from './translations';

// Angular ships only en-US locale data by default; DatePipe/DecimalPipe need this for 'pl-PL'.
registerLocaleData(localePl, 'pl-PL');

const STORAGE_KEY = 'lang';

/**
 * Runtime UI language. Angular's built-in @angular/localize compiles one bundle per locale and
 * can't switch at runtime, so this is a small signal-based dictionary instead: switching language
 * re-renders in place, no reload, and the choice is remembered per browser.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly document = inject(DOCUMENT);

  readonly lang = signal<Lang>(initialLang());
  /** BCP 47 locale for the current language, for DatePipe/DecimalPipe/Intl/Chart.js. */
  readonly locale = computed(() => LANGUAGES.find((l) => l.code === this.lang())!.locale);

  constructor() {
    effect(() => {
      const lang = this.lang();
      this.document.documentElement.lang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // Storage can be unavailable (private mode, blocked site data); the choice just won't persist.
      }
    });
  }

  setLang(lang: Lang): void {
    this.lang.set(lang);
  }

  /** The current language's string for `key`, with `{name}` placeholders filled from `params`. */
  t(key: TranslationKey, params?: Record<string, string | number>): string {
    const template = TRANSLATIONS[this.lang()][key] ?? TRANSLATIONS.en[key] ?? key;
    return params ? template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : template;
  }
}

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'pl') return stored;
  } catch {
    // Fall through to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

/**
 * `{{ 'key' | t }}` / `{{ 'key' | t: { n: 5 } }}`. Impure so it re-evaluates when the language
 * signal changes; the lookup is a couple of map reads, cheap enough to run every change detection.
 */
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: TranslationKey, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}

/** Material paginator labels in the current language, refreshed when it changes. */
@Injectable()
export class I18nPaginatorIntl extends MatPaginatorIntl {
  private readonly i18n = inject(I18nService);
  override readonly changes = new Subject<void>();

  constructor() {
    super();
    effect(() => {
      this.i18n.lang();
      this.itemsPerPageLabel = this.i18n.t('paginator.itemsPerPage');
      this.nextPageLabel = this.i18n.t('paginator.next');
      this.previousPageLabel = this.i18n.t('paginator.previous');
      this.firstPageLabel = this.i18n.t('paginator.first');
      this.lastPageLabel = this.i18n.t('paginator.last');
      this.changes.next();
    });
  }

  override getRangeLabel = (page: number, pageSize: number, length: number): string => {
    const start = length === 0 ? 0 : page * pageSize + 1;
    const end = Math.min((page + 1) * pageSize, length);
    return this.i18n.t('paginator.range', { start, end, length });
  };
}
