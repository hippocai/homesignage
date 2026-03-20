import { createI18n } from 'vue-i18n'
import zh from './zh.js'
import en from './en.js'

const savedLocale = localStorage.getItem('hs_locale') || 'zh'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'zh',
  messages: { zh, en }
})

export default i18n
