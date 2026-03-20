import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '../layouts/MainLayout.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/',
    component: MainLayout,
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/DashboardView.vue')
      },
      {
        path: 'devices',
        name: 'Devices',
        component: () => import('../views/DevicesView.vue')
      },
      {
        path: 'scenes',
        name: 'Scenes',
        component: () => import('../views/ScenesView.vue')
      },
      {
        path: 'scenes/:id/edit',
        name: 'SceneEditor',
        component: () => import('../views/SceneEditorView.vue')
      },
      {
        path: 'reminders',
        name: 'Reminders',
        component: () => import('../views/RemindersView.vue')
      },
      {
        path: 'emergency',
        name: 'Emergency',
        component: () => import('../views/EmergencyView.vue')
      },
      {
        path: 'info-items',
        name: 'InfoItems',
        component: () => import('../views/InfoItemsView.vue')
      },
      {
        path: 'file-repo',
        name: 'FileRepo',
        component: () => import('../views/FileRepoView.vue')
      },
      {
        path: 'api-keys',
        name: 'ApiKeys',
        component: () => import('../views/ApiKeysView.vue')
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('../views/SettingsView.vue')
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)

  if (requiresAuth && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
