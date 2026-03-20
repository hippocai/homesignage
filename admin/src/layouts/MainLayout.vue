<template>
  <el-container class="main-layout">
    <!-- Sidebar -->
    <el-aside width="220px" class="sidebar">
      <div class="sidebar-logo">
        <el-icon size="24" color="#409EFF"><Monitor /></el-icon>
        <span class="logo-text">HomeSignage</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        class="sidebar-menu"
        router
        background-color="#001529"
        text-color="#ffffffa6"
        active-text-color="#ffffff"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataAnalysis /></el-icon>
          <span>{{ $t('nav.dashboard') }}</span>
        </el-menu-item>
        <el-menu-item index="/devices">
          <el-icon><Monitor /></el-icon>
          <span>{{ $t('nav.devices') }}</span>
        </el-menu-item>
        <el-menu-item index="/scenes">
          <el-icon><Picture /></el-icon>
          <span>{{ $t('nav.scenes') }}</span>
        </el-menu-item>
        <el-menu-item index="/reminders">
          <el-icon><AlarmClock /></el-icon>
          <span>{{ $t('nav.reminders') }}</span>
        </el-menu-item>
        <el-menu-item index="/emergency">
          <el-icon><Warning /></el-icon>
          <span>{{ $t('nav.emergency') }}</span>
        </el-menu-item>
        <el-menu-item index="/info-items">
          <el-icon><List /></el-icon>
          <span>{{ $t('nav.infoItems') }}</span>
        </el-menu-item>
        <el-menu-item index="/file-repo">
          <el-icon><FolderOpened /></el-icon>
          <span>{{ $t('nav.fileRepo') }}</span>
        </el-menu-item>
        <el-menu-item index="/api-keys">
          <el-icon><Key /></el-icon>
          <span>{{ $t('nav.apiKeys') }}</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>{{ $t('nav.settings') }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- Main content -->
    <el-container class="content-container">
      <!-- Header -->
      <el-header class="main-header">
        <div class="header-left">
          <span class="header-title">{{ $t('header.title') }}</span>
        </div>
        <div class="header-right">
          <el-button
            size="small"
            class="lang-toggle"
            @click="toggleLocale"
          >{{ locale === 'zh' ? 'EN' : '中文' }}</el-button>
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-icon><UserFilled /></el-icon>
              <span class="username">{{ authStore.user?.username || $t('header.admin') }}</span>
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="settings">
                  <el-icon><Setting /></el-icon>{{ $t('header.settings') }}
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>{{ $t('header.logout') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- Page content -->
      <el-main class="main-content">
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { ElMessage, ElMessageBox } from 'element-plus'
import { List, FolderOpened } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const activeMenu = computed(() => route.path)

function toggleLocale() {
  const next = locale.value === 'zh' ? 'en' : 'zh'
  locale.value = next
  localStorage.setItem('hs_locale', next)
}

async function handleCommand(command) {
  if (command === 'logout') {
    try {
      await ElMessageBox.confirm(t('header.logoutConfirm'), t('header.logoutHint'), {
        confirmButtonText: t('header.logoutConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      })
      authStore.logout()
      router.push('/login')
      ElMessage.success(t('header.logoutSuccess'))
    } catch {
      // cancelled
    }
  } else if (command === 'settings') {
    router.push('/settings')
  }
}
</script>

<style scoped>
.main-layout {
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  background-color: #001529;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  border-bottom: 1px solid #ffffff1a;
  flex-shrink: 0;
}

.logo-text {
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.sidebar-menu {
  flex: 1;
  border-right: none;
  overflow-y: auto;
}

.sidebar-menu::-webkit-scrollbar {
  width: 4px;
}

.sidebar-menu::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar-menu::-webkit-scrollbar-thumb {
  background-color: #ffffff30;
  border-radius: 2px;
}

.content-container {
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.main-header {
  background-color: #ffffff;
  border-bottom: 1px solid #e8eaec;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
  flex-shrink: 0;
  height: 60px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lang-toggle {
  font-size: 13px;
  padding: 4px 10px;
  height: 28px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #303133;
  font-size: 14px;
  padding: 6px 10px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.user-info:hover {
  background-color: #f5f7fa;
}

.username {
  margin: 0 2px;
}

.main-content {
  background-color: #f0f2f5;
  overflow-y: auto;
  padding: 24px;
}
</style>
