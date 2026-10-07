import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { TRANSLATIONS } from './translations';

describe('I18nService', () => {
  let i18n: I18nService;

  beforeEach(() => {
    i18n = TestBed.inject(I18nService);
    i18n.setLang('en');
  });

  it('translates into the selected language', () => {
    expect(i18n.t('nav.articles')).toBe('Articles');
    i18n.setLang('pl');
    expect(i18n.t('nav.articles')).toBe('Artykuły');
    expect(i18n.locale()).toBe('pl-PL');
  });

  it('fills {placeholders} from params and leaves unknown ones untouched', () => {
    expect(i18n.t('paginator.range', { start: 1, end: 10, length: 42 })).toBe('1 – 10 of 42');
    expect(i18n.t('timeline.coinsHint')).toContain('{n}');
  });

  it('has a non-empty Polish string for every key', () => {
    for (const key of Object.keys(TRANSLATIONS.en) as (keyof typeof TRANSLATIONS.en)[]) {
      expect(TRANSLATIONS.pl[key]).withContext(key).toBeTruthy();
    }
  });
});
