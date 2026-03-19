import { defineStore } from 'pinia'
import { ref } from 'vue'
import { devicesApi } from '../api/index.js'

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref([])
  const loading = ref(false)

  async function fetchDevices() {
    loading.value = true
    try {
      const response = await devicesApi.list()
      devices.value = response.data.data || []
    } finally {
      loading.value = false
    }
  }

  async function createDevice(data) {
    const response = await devicesApi.create(data)
    await fetchDevices()
    return response.data.data
  }

  async function updateDevice(id, data) {
    const response = await devicesApi.update(id, data)
    await fetchDevices()
    return response.data
  }

  async function deleteDevice(id) {
    await devicesApi.delete(id)
    await fetchDevices()
  }

  return { devices, loading, fetchDevices, createDevice, updateDevice, deleteDevice }
})
