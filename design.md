# 家庭数字标牌系统 - 概要设计文档 (V2.0)

| 版本  | 日期  | 作者  | 描述  |
| --- | --- | --- | --- |
| V2.0 | 2023-10-27 | AI 助手 | 完整概要设计，基于V3.0需求，采用纯Web客户端、Vue.js+SQLite技术栈 |

## 1\. 引言

### 1.1 编写目的

本文档旨在为“家庭数字标牌系统”提供概要设计说明，定义系统的整体架构、模块划分、技术选型、数据存储设计、关键接口及部署方案，作为后续详细设计和开发的依据。

### 1.2 适用范围

本文档适用于项目开发人员、测试人员及项目管理人员。

### 1.3 参考文档

*   《家庭数字标牌系统软件需求文档 V3.0》
    

## 2\. 系统总体设计

### 2.1 设计原则

*   **模块化**：系统功能按模块划分，降低耦合度，便于开发和维护。
    
*   **轻量级**：充分考虑闲置设备的性能限制，客户端尽可能轻量，服务端资源占用低。
    
*   **纯Web客户端**：所有显示设备均通过浏览器访问，无需开发专用客户端应用。
    
*   **实时性**：紧急提示的端到端延迟控制在2秒以内。
    
*   **可扩展性**：API设计遵循RESTful规范，便于未来接入更多外部系统。
    
*   **容错性**：客户端具备断网缓存能力，服务端具备异常恢复能力。
    
*   **简化部署**：无需反向代理，Node.js服务直接对外提供HTTP访问。
    

### 2.2 系统架构图
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             外部系统集成层                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 家庭自动化系统 │  │   备忘录应用   │  │   安防系统   │  │  第三方服务  │    │
│  │ (HomeAssistant)│  │ (Notion/飞书)│  │ (报警系统)  │  │ (天气API等) │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │ RESTful API      │ RESTful API     │ RESTful API     │
┌─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┐
│         ▼                 ▼                 ▼                 ▼            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                   服务端 (Node.js + Express)                          │  │
│  │  ┌──────────────────────────────────────────────────────────────┐   │  │
│  │  │                    API网关层 (认证/路由/限流)                   │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  │                                                                      │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐│  │
│  │  │  设备管理模块  │ │  画面管理模块 │ │  定时提示模块 │ │  紧急提示模块 ││  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘│  │
│  │                                                                      │  │
│  │  ┌──────────────────────────────────────────────────────────────┐   │  │
│  │  │                   业务逻辑层 (Controllers)                     │   │  │
│  │  └──────────────────────────────────────────────────────────────┘   │  │
│  │                                                                      │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌───────────────────────────┐   │  │
│  │  │  数据访问层   │ │  定时调度服务 │ │    实时推送服务            │   │  │
│  │  │   (SQLite)   │ │ (node-schedule)│ │    (Socket.IO)          │   │  │
│  │  └──────┬───────┘ └──────┬───────┘ └───────────┬───────────────┘   │  │
│  └─────────┼────────────────┼─────────────────────┼─────────────────────┘  │
│            │                │                     │                        │
│            ▼                │                     │                        │
│    ┌──────────────┐         │           ┌─────────▼─────────┐              │
│    │   SQLite     │         └───────────►   WebSocket连接   │              │
│    │   数据库     │                     │   (实时推送)      │              │
│    │  (文件存储)  │                     └─────────┬─────────┘              │
│    └──────────────┘                               │                        │
└───────────────────────────────────────────────────┼────────────────────────┘
                                                     │
┌───────────────────────────────────────────────────┼────────────────────────┐
│                         局域网/互联网              │                        │
│                                         ┌─────────┴─────────┐              │
│                                         │   HTTP/WebSocket  │              │
│                                         │    (端口3000)     │              │
│                                         └─────────┬─────────┘              │
└───────────────────────────────────────────────────┼────────────────────────┘
                                                     │
                    ┌────────────────────────────────┼───────────────────────────────┐
                    │                                │                               │
┌───────────────────▼──────────────────┐ ┌───────────▼───────────────────────────┐
│      客户端 (纯Web浏览器)              │ │       管理后台 (Vue.js SPA)            │
│  ┌───────────────────────────────┐   │ │  ┌───────────────────────────────┐   │
│  │ Chrome / Safari (PC/平板/手机) │   │ │  │ Chrome / Safari (PC/平板)     │   │
│  ├───────────────────────────────┤   │ │  ├───────────────────────────────┤   │
│  │ • 画面轮播引擎                  │   │ │  │ • 设备管理界面                │   │
│  │ • 优先级管理                    │   │ │  │ • 画面布局设计器 (拖拽式)     │   │
│  │ • 音频播放 (Web Audio API)      │   │ │  │ • 定时提示配置                │   │
│  │ • 断网缓存 (LocalStorage)       │   │ │  │ • 紧急提示触发                │   │
│  │ • 全屏模式 (Fullscreen API)     │   │ │  │ • 系统监控仪表盘              │   │
│  │ • WebSocket实时通信             │   │ │  │ • API密钥管理                 │   │
│  └───────────────────────────────┘   │ │  └───────────────────────────────┘   │
└──────────────────────────────────────┘ └──────────────────────────────────────┘
```
### 2.3 技术栈选择

| 层级  | 技术组件 | 版本/类型 | 说明  |
| --- | --- | --- | --- |
| **服务端** | Node.js | v16+ | 运行时环境 |
|     | Express | v4.x | Web框架，直接监听3000端口，无需反向代理 |
|     | SQLite3 | v5.x | 嵌入式数据库，文件型存储 |
|     | [Socket.IO](https://Socket.IO) | v4.x | 实时双向通信 |
|     | node-schedule | v2.x | 定时任务调度 |
|     | Winston | v3.x | 日志记录 |
|     | JWT / API Key | \-  | 身份认证 |
|     | bcrypt | v5.x | 密码加密 |
| **管理后台** | Vue.js | v3.x | 前端框架 |
|     | Vite | v4.x | 构建工具 |
|     | Vue Router | v4.x | 路由管理 |
|     | Pinia | v2.x | 状态管理 |
|     | Element Plus | v2.x | UI组件库 |
|     | Axios | v1.x | HTTP客户端 |
|     | ECharts | v5.x | 监控图表 |
|     | SortableJS | \-  | 拖拽布局 |
| **客户端** | HTML5 / CSS3 | \-  | 页面结构 |
|     | Vanilla JavaScript | ES6 | 核心逻辑（无框架依赖，保证轻量） |
|     | WebSocket API ([Socket.IO](https://Socket.IO)客户端) | \-  | 实时通信 |
|     | Web Audio API | \-  | 音频播放 |
|     | LocalStorage | \-  | 本地缓存 |
|     | Fullscreen API | \-  | 全屏显示 |
| **部署** | Docker | v20+ | 容器化部署 |
|     | Docker Compose | v2.x | 编排工具 |

## 3\. 模块设计

### 3.1 服务端模块划分

#### 3.1.1 API网关层

*   **功能**：统一入口、请求路由、身份认证、速率限制、日志记录。
    
*   **认证机制**：管理后台使用JWT；外部API使用API Key。
    
*   **设计要点**：
    
    *   所有API端点统一以 `/api/v1/` 为前缀。
        
    *   提供中间件进行认证和权限校验。
        
    *   静态文件服务：`/admin` 路由指向Vue.js打包后的文件，`/client` 路由指向客户端HTML页面。
        
    *   直接监听3000端口，不依赖Nginx等反向代理。
        

#### 3.1.2 设备管理模块

*   **核心功能**：
    
    *   设备注册与唯一ID生成。
        
    *   设备状态维护（在线/离线、最后在线时间、IP地址、浏览器信息）。
        
    *   设备分组管理。
        
    *   设备配置下发。
        
*   **数据模型**：
    
```
Device = {
  id: String,           // 唯一标识，如UUID
  name: String,         // 设备名称（如"客厅iPad"）
  group: String,        // 所属分组
  browserInfo: {        // 浏览器信息
    userAgent: String,
    platform: String,
    screenSize: String
  },
  status: String,       // online/offline
  lastSeen: Timestamp,
  ipAddress: String,
  config: {             // 当前生效配置
    scenes: [SceneRef], // 关联的画面ID列表，带轮播时长
    transition: String, // 转场效果
    currentSceneId: String // 当前强制显示的画面（如有）
  },
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### 3.1.3 画面管理模块

*   **核心功能**：
    
    *   画面的创建、读取、更新、删除。
        
    *   画面内组件的布局管理。
        
    *   组件内容的管理。
        
*   **数据模型**：
    
  ```
  Scene = {
  id: String,
  name: String,
  description: String,
  components: [         // 组件列表
    {
      id: String,
      type: String,     // clock/weather/text/image/iframe
      position: {       // 布局位置（百分比或绝对像素）
        x: Number, y: Number, width: Number, height: Number
      },
      config: {         // 组件特有配置
        // 时钟：format, timezone, style
        // 天气：city, unit, apiKey
        // 文本：content, fontSize, color, align
        // 图片：url, interval（轮播间隔）
        // iframe：url, scrollable
      },
      style: {          // 通用样式
        backgroundColor, borderRadius, opacity, etc.
      }
    }
  ],
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### 3.1.4 定时提示模块

*   **核心功能**：
    
    *   定时任务的创建、读取、更新、删除。
        
    *   定时任务的调度与触发。
        
    *   过期任务的自动清理。
        
*   **数据模型**：
 ```
    TimedReminder = {
  id: String,
  name: String,
  deviceIds: [String],   // 目标设备ID列表，特殊值"all"表示所有设备
  startTime: Timestamp,  // 开始时间
  endTime: Timestamp,    // 结束时间
  repeat: String,        // 重复规则：none/daily/weekday/weekend/custom
  content: {
    text: String,
    style: String,       // blink/highlight/bar/top/bottom
    fontSize: String,
    color: String,
    backgroundColor: String
  },
  sound: {
    enabled: Boolean,
    file: String,        // 音频文件名或URL
    volume: Number,
    loop: Boolean        // 是否循环（一般定时提示不循环）
  },
  priority: Number,      // 优先级（1-10，数字越大优先级越高）
  enabled: Boolean,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```
*   **调度机制**：
    
    *   服务器启动时加载所有启用的定时任务。
        
    *   使用`node-schedule`为每个任务创建两个调度点：开始和结束。
        
    *   到达开始时间：通过[Socket.IO](https://Socket.IO)向目标设备发送`timed-reminder-start`事件，携带完整提示内容。
        
    *   到达结束时间：发送`timed-reminder-end`事件，携带任务ID。
        
    *   支持动态添加/修改/删除任务：更新调度器。
        

#### 3.1.5 紧急提示模块

*   **核心功能**：
    
    *   紧急提示的触发与解除。
        
    *   紧急提示状态的维护。
        
    *   防止重复触发。
        
*   **数据模型**：
```
EmergencyAlert = {
  id: String,
  deviceIds: [String],   // 目标设备ID，特殊值"all"
  content: {
    text: String,
    backgroundColor: String, // 默认红色
    textColor: String,       // 默认白色
    blink: Boolean           // 是否闪烁
  },
  sound: {
    file: String,        // 警示音文件
    volume: Number,
    loop: Boolean        // 必须为true
  },
  triggeredAt: Timestamp,
  triggeredBy: String,   // API Key标识或管理员ID
  clearedAt: Timestamp,  // 解除时间
  clearedBy: String,
  status: String         // active/cleared
}
```
    
*   **处理机制**：
    
    *   同一设备同一时间只能有一个活跃的紧急提示。
        
    *   触发新紧急提示时，自动覆盖旧的。
        
    *   通过[Socket.IO](https://Socket.IO)立即广播到所有目标设备。
        
    *   服务器需持续记录紧急提示状态，新连接的设备应能获取当前活跃的紧急提示。
        

#### 3.1.6 实时推送服务

*   **技术选型**：[Socket.IO](https://Socket.IO)
    
*   **核心功能**：
    
    *   维护设备WebSocket连接。
        
    *   设备身份认证（连接时携带设备ID和密钥）。
        
    *   房间管理（基于设备ID和分组）。
        
    *   事件广播。
        
*   **事件定义**：
    

| 事件名 | 方向  | 说明  | 数据载荷 |
| --- | --- | --- | --- |
| `connect` | 客户端→服务端 | 建立连接 | `{ deviceId, apiKey }` |
| `config-updated` | 服务端→客户端 | 配置有更新，请重新拉取 | `{ version }` |
| `timed-reminder-start` | 服务端→客户端 | 定时提示开始 | `TimedReminder`对象 |
| `timed-reminder-end` | 服务端→客户端 | 定时提示结束 | `{ reminderId }` |
| `emergency-alert` | 服务端→客户端 | 紧急提示触发 | `EmergencyAlert`对象 |
| `emergency-clear` | 服务端→客户端 | 紧急提示解除 | `{ alertId }` |
| `force-refresh` | 服务端→客户端 | 强制刷新页面 | `{ reason }` |
| `heartbeat` | 双向  | 心跳维持 | `{ timestamp }` |

#### 3.1.7 数据访问层

*   **ORM选择**：直接使用`sqlite3`驱动，配合简单封装的数据访问对象（DAO）模式。
    
*   **数据库文件**：`/data/signage.db`
    
*   **主要数据表**：
    
    *   `devices`：设备信息
        
    *   `scenes`：画面定义
        
    *   `components`：组件定义（与画面一对多）
        
    *   `device_scenes`：设备与画面的关联表（多对多，带轮播配置）
        
    *   `timed_reminders`：定时提示任务
        
    *   `emergency_alerts`：紧急提示记录
        
    *   `users`：管理员用户
        
    *   `api_keys`：外部系统API密钥
        

### 3.2 客户端模块（纯Web）

#### 3.2.1 显示客户端

**核心模块**

| 模块  | 职责  | 关键技术点 |
| --- | --- | --- |
| **初始化模块** | 设备注册、配置拉取、WebSocket连接建立 | `fetch` API，LocalStorage，URL参数解析 |
| **画面轮播引擎** | 解析画面配置、定时切换、淡入淡出效果 | `setInterval`，CSS `transition`，`requestAnimationFrame` |
| **组件渲染器** | 根据组件类型渲染对应UI | 动态DOM创建，第三方API调用（如天气） |
| **优先级管理器** | 维护状态机，处理三层优先级切换 | 状态模式，事件监听 |
| **定时提示渲染器** | 渲染提示浮层，管理显示/隐藏 | 绝对定位浮层，CSS动画，`z-index`管理 |
| **紧急提示渲染器** | 全屏覆盖，阻止用户交互 | 最高`z-index`，全屏覆盖层，ESC键禁用 |
| **音频管理器** | 音频加载、播放、暂停、音量控制 | Web Audio API，用户手势解锁，AudioContext管理 |
| **缓存管理器** | 本地存储配置和内容，支持断网显示 | LocalStorage，版本控制 |
| **心跳模块** | 定期上报状态，维持在线状态 | `setInterval`，WebSocket，HTTP备选 |

**状态机定义**

```
[INIT] --(注册成功)--> [LOADING: 拉取配置]
[LOADING] --(配置加载完成)--> [NORMAL: 轮播中]
[NORMAL] --(定时提示开始)--> [TIMED_REMINDER: 轮播+浮层]
[TIMED_REMINDER] --(定时提示结束)--> [NORMAL]
[NORMAL/TIMED_REMINDER] --(紧急提示)--> [EMERGENCY: 全屏警示]
[EMERGENCY] --(紧急解除)--> [NORMAL]
[任意状态] --(断网)--> [OFFLINE: 显示缓存内容]
[OFFLINE] --(网络恢复)--> [RELOAD: 重新初始化]
[任意状态] --(收到force-refresh)--> [RELOAD]
```
#### 3.2.2 管理后台（Vue.js）

**主要页面**

| 页面  | 功能描述 | 关键组件 |
| --- | --- | --- |
| **登录页** | 管理员登录 | Form表单，JWT存储 |
| **仪表盘** | 系统概览：设备在线数量、活跃提示数、系统状态图表 | ECharts卡片，WebSocket状态更新 |
| **设备管理** | 设备列表、添加设备、分组管理、远程控制 | Table，Dialog，WebSocket状态指示 |
| **画面设计器** | 拖拽式布局设计，组件库面板，实时预览 | SortableJS，Canvas模拟，组件属性面板 |
| **画面分配** | 为设备分配画面，配置轮播顺序和时间 | Transfer，Slider，Sortable列表 |
| **定时提示管理** | 定时任务列表、创建/编辑/删除任务 | DateTimePicker，Cron表达式生成器 |
| **紧急提示控制台** | 触发紧急提示、查看历史记录、手动解除 | 大红色警示按钮，历史记录表格 |
| **API密钥管理** | 管理外部系统API密钥 | Table，生成密钥按钮 |
| **系统设置** | 用户管理、系统参数配置 | Form表单 |

## 4\. 接口设计

### 4.1 RESTful API 概览

| 资源  | 端点  | 说明  |
| --- | --- | --- |
| 认证  | `/api/v1/auth/login` | 管理员登录 |
| 认证  | `/api/v1/auth/verify` | 验证JWT |
| 设备  | `/api/v1/devices` | 设备管理 |
| 设备  | `/api/v1/devices/:id/config` | 获取设备配置（客户端专用） |
| 设备  | `/api/v1/devices/:id/heartbeat` | 设备心跳上报 |
| 画面  | `/api/v1/scenes` | 画面管理 |
| 组件  | `/api/v1/components` | 组件管理 |
| 定时提示 | `/api/v1/reminders/timed` | 定时提示 |
| 紧急提示 | `/api/v1/reminders/emergency` | 紧急提示 |
| 紧急提示 | `/api/v1/reminders/emergency/active` | 获取当前活跃紧急提示 |
| API密钥 | `/api/v1/api-keys` | API密钥管理 |
| 系统  | `/api/v1/system/status` | 系统状态 |
| 上传  | `/api/v1/uploads` | 文件上传（图片、音频） |

### 4.2 关键API详细定义

#### 4.2.1 设备配置获取（客户端专用）
```
GET /api/v1/devices/:deviceId/config

请求头：
  X-Device-Key: 设备密钥（首次注册时返回）

响应示例：
{
  "device": {
    "id": "device-123",
    "name": "客厅iPad",
    "configVersion": 5
  },
  "scenes": [
    {
      "id": "scene-1",
      "name": "时钟天气",
      "duration": 15,
      "components": [...]
    }
  ],
  "transition": "fade",
  "activeReminders": [...],
  "emergencyAlert": null,
  "timestamp": 1698400000
}
```

#### 4.2.2 触发紧急提示
```
POST /api/v1/reminders/emergency
Headers: X-API-Key: xxxxx

请求体：
{
  "deviceIds": ["all"],
  "content": {
    "text": "疑似煤气泄漏，请立即检查！",
    "backgroundColor": "#FF0000",
    "textColor": "#FFFFFF",
    "blink": true
  },
  "sound": {
    "file": "alarm.mp3",
    "volume": 0.8,
    "loop": true
  }
}
```

## 5\. 数据存储设计

### 5.1 SQLite 数据库 Schema
```
-- 管理员用户表
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API密钥表
CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    permissions TEXT,
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 设备表
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    group_name TEXT,
    device_key TEXT UNIQUE NOT NULL,
    browser_info TEXT,
    status TEXT DEFAULT 'offline',
    last_seen TIMESTAMP,
    ip_address TEXT,
    config TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 画面表
CREATE TABLE scenes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    thumbnail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 组件表
CREATE TABLE components (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL,
    type TEXT NOT NULL,
    position TEXT NOT NULL,
    config TEXT NOT NULL,
    style TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

-- 设备-画面关联表
CREATE TABLE device_scenes (
    device_id TEXT NOT NULL,
    scene_id TEXT NOT NULL,
    duration INTEGER DEFAULT 15,
    sort_order INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (device_id, scene_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

-- 定时提示表
CREATE TABLE timed_reminders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_ids TEXT NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    repeat TEXT DEFAULT 'none',
    content TEXT NOT NULL,
    sound TEXT,
    priority INTEGER DEFAULT 5,
    enabled BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 紧急提示表
CREATE TABLE emergency_alerts (
    id TEXT PRIMARY KEY,
    device_ids TEXT NOT NULL,
    content TEXT NOT NULL,
    sound TEXT NOT NULL,
    triggered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    triggered_by TEXT,
    cleared_at TIMESTAMP,
    cleared_by TEXT,
    status TEXT DEFAULT 'active',
    FOREIGN KEY (triggered_by) REFERENCES users(id),
    FOREIGN KEY (cleared_by) REFERENCES users(id)
);

-- 文件记录表
CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    url TEXT NOT NULL,
    uploaded_by TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- 创建索引
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_last_seen ON devices(last_seen);
CREATE INDEX idx_components_scene_id ON components(scene_id);
CREATE INDEX idx_timed_reminders_start_time ON timed_reminders(start_time);
CREATE INDEX idx_emergency_alerts_status ON emergency_alerts(status);
```

## 6\. 部署方案

### 6.1 Docker化部署

**docker-compose.yml**
```
version: '3.8'

services:
  signage-server:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: home-signage
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET}
      - SQLITE_PATH=/app/data/signage.db
      - LOG_LEVEL=info
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 6.2 部署架构
```
┌─────────────────────────────────────┐
│            家庭NAS/服务器             │
│  ┌───────────────────────────────┐  │
│  │       Docker容器               │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │   Node.js + Express     │  │  │
│  │  │   监听端口: 3000         │  │  │
│  │  └─────────────────────────┘  │  │
│  │  ┌─────────────────────────┐  │  │
│  │  │    SQLite数据库文件      │  │  │
│  │  │   挂载卷: /app/data     │  │  │
│  │  └─────────────────────────┘  │  │
│  └───────────────────────────────┘  │
│              │                       │
│              │ 端口映射 3000          │
└──────────────┼───────────────────────┘
               │
               │ 局域网访问
               │ http://nas-ip:3000
               │
┌──────────────┼───────────────────────┐
│              ▼                        │
│  ┌──────────────────────┐             │
│  │   管理后台访问        │             │
│  │ http://nas-ip:3000/  │             │
│  └──────────────────────┘             │
│                                        │
│  ┌──────────────────────┐             │
│  │   客户端访问          │             │
│  │ http://nas-ip:3000/  │             │
│  │ client/设备ID        │             │
│  └──────────────────────┘             │
└────────────────────────────────────────┘
```

### 6.3 环境要求

*   **最低配置**：
    
    *   CPU：1核
        
    *   内存：512MB
        
    *   存储：1GB（不含上传文件）
        
    *   网络：家庭局域网
        
*   **推荐配置**：
    
    *   CPU：2核
        
    *   内存：2GB
        
    *   存储：10GB
        

## 7\. 开发阶段划分

| 阶段  | 交付物 |
| ---  | --- |
| Phase 1: 核心框架   | Express服务框架，SQLite集成，基础设备管理API，简单客户端HTML |
| Phase 2: 画面管理   | 画面CRUD，组件渲染，Vue管理后台基础界面 |
| Phase 3: 多画面轮播   | 客户端轮播引擎，淡入淡出效果，LocalStorage缓存 |
| Phase 4: 定时提示   | 定时任务调度，客户端浮层渲染，音频播放（Web Audio API） |
| Phase 5: 紧急提示   | WebSocket集成，实时推送，全屏紧急模式 |
| Phase 6: 管理后台完善   | 拖拽式设计器，仪表盘，系统设置，文件上传 |
| Phase 7: 测试与优化   | 兼容性测试，稳定性测试，性能优化，文档完善 |

- - -
