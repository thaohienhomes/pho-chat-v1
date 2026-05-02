'use client';

import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import { PropsWithChildren, memo, useEffect, useState } from 'react';
import { isRtlLang } from 'rtl-detect';

import { createI18nNext } from '@/locales/create';
import { isOnServerSide } from '@/utils/env';
import { getAntdLocale } from '@/utils/locale';

import Editor from './Editor';

// PHO-257: dayjs locale codes don't always match our BCP-47 lang tags.
// Map regional variants to their dayjs equivalents (e.g. vi-VN → vi).
// refs: https://github.com/lobehub/lobe-chat/issues/3396
const DAYJS_LOCALE_MAP: Record<string, string> = {
  'en-us': 'en',
  'vi-vn': 'vi',
};

const updateDayjs = async (lang: string) => {
  // load default lang
  let dayJSLocale;
  try {
    const normalized = lang!.toLowerCase();
    const locale = DAYJS_LOCALE_MAP[normalized] ?? normalized;

    dayJSLocale = await import(`dayjs/locale/${locale}.js`);
  } catch {
    console.warn(`dayjs locale for ${lang} not found, fallback to en`);
    dayJSLocale = await import(`dayjs/locale/en.js`);
  }

  dayjs.locale(dayJSLocale.default);
};

interface LocaleLayoutProps extends PropsWithChildren {
  antdLocale?: any;
  defaultLang?: string;
}

const Locale = memo<LocaleLayoutProps>(({ children, defaultLang, antdLocale }) => {
  const [i18n] = useState(createI18nNext(defaultLang));
  const [lang, setLang] = useState(defaultLang);
  const [locale, setLocale] = useState(antdLocale);

  // if run on server side, init i18n instance everytime
  if (isOnServerSide) {
    // use sync mode to init instantly
    i18n.init({ initAsync: false });

    // load the dayjs locale
    // if (lang) {
    //   const dayJSLocale = require(`dayjs/locale/${lang!.toLowerCase()}.js`);
    //
    //   dayjs.locale(dayJSLocale);
    // }
  } else {
    // if on browser side, init i18n instance only once
    if (!i18n.instance.isInitialized)
      // console.debug('locale', lang);
      i18n.init().then(async () => {
        if (!lang) return;

        await updateDayjs(lang);
      });
  }

  // handle i18n instance language change
  useEffect(() => {
    const handleLang = async (lng: string) => {
      setLang(lng);

      if (lang === lng) return;

      const newLocale = await getAntdLocale(lng);
      setLocale(newLocale);

      await updateDayjs(lng);
    };

    i18n.instance.on('languageChanged', handleLang);
    return () => {
      i18n.instance.off('languageChanged', handleLang);
    };
  }, [i18n, lang]);

  // detect document direction
  const documentDir = isRtlLang(lang!) ? 'rtl' : 'ltr';

  return (
    <ConfigProvider
      direction={documentDir}
      locale={locale}
      theme={{
        components: {
          Button: {
            contentFontSizeSM: 12,
          },
        },
      }}
    >
      <Editor>{children}</Editor>
    </ConfigProvider>
  );
});

Locale.displayName = 'Locale';

export default Locale;
