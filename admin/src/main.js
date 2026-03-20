import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import enUs from 'element-plus/dist/locale/en.mjs'
import { createPinia } from 'pinia'
import router from './router/index.js'
import App from './App.vue'
import i18n from './i18n/index.js'

const app = createApp(App)

// Register all Element Plus icons globally
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

const pinia = createPinia()

const savedLocale = localStorage.getItem('hs_locale') || 'zh'
const elLocale = savedLocale === 'en' ? enUs : zhCn

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(ElementPlus, { locale: elLocale })

app.mount('#app')
