<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <el-icon size="40" color="#409EFF"><Monitor /></el-icon>
        <h1 class="login-title">HomeSignage</h1>
        <p class="login-subtitle">{{ $t('login.subtitle') }}</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        class="login-form"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            :placeholder="$t('login.usernamePlaceholder')"
            size="large"
            :prefix-icon="User"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="$t('login.passwordPlaceholder')"
            size="large"
            :prefix-icon="Lock"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            class="login-btn"
            :loading="loading"
            @click="handleLogin"
          >
            {{ $t('login.loginBtn') }}
          </el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
        class="error-alert"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()

const formRef = ref(null)
const loading = ref(false)
const errorMessage = ref('')

const form = reactive({
  username: '',
  password: ''
})

const rules = computed(() => ({
  username: [{ required: true, message: t('login.usernameRequired'), trigger: 'blur' }],
  password: [{ required: true, message: t('login.passwordRequired'), trigger: 'blur' }]
}))

async function handleLogin() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  errorMessage.value = ''
  try {
    await authStore.login(form.username, form.password)
    ElMessage.success(t('login.loginSuccess'))
    router.push('/dashboard')
  } catch (error) {
    const msg = error.response?.data?.message || error.response?.data?.error || t('login.loginFailed')
    errorMessage.value = msg
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.login-container {
  background: #ffffff;
  border-radius: 12px;
  padding: 48px 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}

.login-title {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
  margin: 12px 0 6px;
  letter-spacing: 2px;
}

.login-subtitle {
  color: #909399;
  font-size: 14px;
}

.login-form {
  margin-top: 8px;
}

.login-btn {
  width: 100%;
  font-size: 16px;
  height: 44px;
  letter-spacing: 2px;
}

.error-alert {
  margin-top: 12px;
}
</style>
