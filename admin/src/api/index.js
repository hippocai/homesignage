import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1'
})

// Request interceptor: add Authorization header
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/admin/login'
    }
    return Promise.reject(error)
  }
)

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  verify: () => api.get('/auth/verify'),
  changePassword: (currentPassword, newPassword) =>
    api.post('/auth/change-password', { currentPassword, newPassword })
}

export const devicesApi = {
  list: () => api.get('/devices'),
  get: (id) => api.get(`/devices/${id}`),
  create: (data) => api.post('/devices', data),
  update: (id, data) => api.put(`/devices/${id}`, data),
  delete: (id) => api.delete(`/devices/${id}`),
  getConfig: (id) => api.get(`/devices/${id}/config`),
  getScenes: (id) => api.get(`/devices/${id}/scenes`),
  setScenes: (id, scenes) => api.put(`/devices/${id}/scenes`, { scenes }),
  heartbeat: (id) => api.post(`/devices/${id}/heartbeat`),
  forceRefresh: (id) => api.post(`/devices/${id}/refresh`)
}

export const scenesApi = {
  list: () => api.get('/scenes'),
  get: (id) => api.get(`/scenes/${id}`),
  create: (data) => api.post('/scenes', data),
  update: (id, data) => api.put(`/scenes/${id}`, data),
  delete: (id) => api.delete(`/scenes/${id}`),
  getComponents: (id) => api.get(`/scenes/${id}/components`),
  createComponent: (id, data) => api.post(`/scenes/${id}/components`, data),
  updateComponent: (sceneId, componentId, data) =>
    api.put(`/scenes/${sceneId}/components/${componentId}`, data),
  deleteComponent: (sceneId, componentId) =>
    api.delete(`/scenes/${sceneId}/components/${componentId}`)
}

export const remindersApi = {
  listTimed: () => api.get('/reminders/timed'),
  createTimed: (data) => api.post('/reminders/timed', data),
  updateTimed: (id, data) => api.put(`/reminders/timed/${id}`, data),
  deleteTimed: (id) => api.delete(`/reminders/timed/${id}`),
  listEmergency: () => api.get('/reminders/emergency'),
  triggerEmergency: (data) => api.post('/reminders/emergency', data),
  clearEmergency: (id) => api.delete(`/reminders/emergency/${id}`),
  getActiveEmergency: () => api.get('/reminders/emergency/active')
}

export const apiKeysApi = {
  list: () => api.get('/api-keys'),
  create: (data) => api.post('/api-keys', data),
  delete: (id) => api.delete(`/api-keys/${id}`)
}

export const infoItemsApi = {
  list: () => api.get('/info-items'),
  listActive: () => api.get('/info-items/active'),
  create: (data) => api.post('/info-items', data),
  update: (id, data) => api.put(`/info-items/${id}`, data),
  delete: (id) => api.delete(`/info-items/${id}`)
}

export const systemApi = {
  getStatus: () => api.get('/system/status')
}

export const settingsApi = {
  get:    ()       => api.get('/settings'),
  update: (data)   => api.put('/settings', data),
}

export const weatherApi = {
  searchLocations: (query) => api.get('/weather/locations', { params: { query } }),
  getProviders:    ()      => api.get('/weather/providers'),
}

export const uploadsApi = {
  list: () => api.get('/uploads'),
  upload: (formData) => api.post('/uploads', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (filename) => api.delete(`/uploads/${filename}`)
}

export const fileRepoApi = {
  list: (type) => api.get('/file-repo', { params: type ? { type } : {} }),
  upload: (formData) => api.post('/file-repo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  download: (filename) => api.get(`/file-repo/${encodeURIComponent(filename)}/download`, { responseType: 'blob' }),
  rename: (filename, newName) => api.patch(`/file-repo/${encodeURIComponent(filename)}`, { newName }),
  delete: (filename) => api.delete(`/file-repo/${encodeURIComponent(filename)}`)
}

export default api
