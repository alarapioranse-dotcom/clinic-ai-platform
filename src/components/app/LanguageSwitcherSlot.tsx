import { AVAILABLE_LOCALES } from '@/i18n/dictionaries';
import { languageOptions } from '@/i18n/language-options';
import { getI18n } from '@/i18n/server';

import { LanguageSwitcher } from './LanguageSwitcher';

/** Server side of the language switcher: hands it the available locales and its label. */
export async function LanguageSwitcherSlot() {
  const { locale, t } = await getI18n();
  return (
    <LanguageSwitcher
      current={locale}
      options={languageOptions(AVAILABLE_LOCALES)}
      label={t.common.languageSwitcherLabel}
    />
  );
}
