<template><div ref="container" /></template>

<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import '../../../client/js/stock-widget.js'
import '../../../client/css/stock.css'

const props = defineProps({ config: { type: Object, required: true } })
const container = ref(null)
let dispose = null
watch([container, () => props.config], () => {
  if (dispose) dispose()
  if (container.value) dispose = window.HomeSignageStock.mount(container.value, { ...props.config })
}, { deep: true, flush: 'post' })
onBeforeUnmount(() => { if (dispose) dispose() })
</script>
