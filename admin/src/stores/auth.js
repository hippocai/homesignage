import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '../api/index.js'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || null)
  const user = ref(null)

  const isAuthenticated = computed(() => !!token.value)

  async function login(username, password) {
    const response = await authApi.login(username, password)
    const data = response.data.data   // 后端返回 { data: { token, user }, message }
    token.value = data.token
    user.value = data.user || { username }
    localStorage.setItem('token', data.token)
    return data
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
  }

  async function checkAuth() {
    if (!token.value) return false
    try {
      const response = await authApi.verify()
      user.value = response.data.data.user
      return true
    } catch {
      logout()
      return false
    }
  }

  return { token, user, isAuthenticated, login, logout, checkAuth }
})
