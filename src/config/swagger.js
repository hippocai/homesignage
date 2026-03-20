const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'HomeSignage API',
    version: '1.0.0',
    description: `
家庭数字标牌系统 REST API 文档。

## 认证方式

本 API 支持两种认证方式：

- **JWT Token**（管理后台）：通过 \`POST /api/v1/auth/login\` 获取 Token，在请求头中携带 \`Authorization: Bearer <token>\`
- **API Key**（外部系统集成）：在管理后台生成，在请求头中携带 \`X-API-Key: <key>\`

部分端点（如设备配置获取）使用专属的 \`X-Device-Key\` 头。
    `.trim(),
    contact: {
      name: 'HomeSignage',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: '当前服务器',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '管理员 JWT Token，通过 /auth/login 获取',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: '外部系统 API 密钥，在管理后台生成',
      },
      deviceKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Device-Key',
        description: '显示设备专属密钥，创建设备时返回',
      },
    },
    schemas: {
      // ── 通用 ──
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: '错误信息' },
        },
      },
      // ── 用户 / 认证 ──
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', example: 'admin123' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          data: {
            type: 'object',
            properties: {
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  username: { type: 'string' },
                  role: { type: 'string', example: 'admin' },
                },
              },
            },
          },
          message: { type: 'string', example: 'Login successful' },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', example: 'admin123' },
          newPassword: { type: 'string', minLength: 6, example: 'newSecret123' },
        },
      },
      // ── 设备 ──
      Device: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-...' },
          name: { type: 'string', example: '客厅 iPad' },
          group_name: { type: 'string', example: '客厅', nullable: true },
          device_key: { type: 'string', example: '3ec6ae6f...', description: '设备专属密钥，仅创建时返回完整值' },
          browser_info: {
            type: 'object',
            nullable: true,
            properties: {
              userAgent: { type: 'string' },
              platform: { type: 'string' },
              screenSize: { type: 'string' },
            },
          },
          status: { type: 'string', enum: ['online', 'offline'], example: 'online' },
          connected: { type: 'boolean', example: true, description: '是否当前通过 WebSocket 连接（实时）' },
          last_seen: { type: 'string', format: 'date-time', nullable: true },
          ip_address: { type: 'string', example: '192.168.1.100', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateDeviceRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: '客厅 iPad' },
          group_name: { type: 'string', example: '客厅' },
        },
      },
      DeviceConfig: {
        type: 'object',
        description: '设备完整配置，供显示客户端使用',
        properties: {
          device: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              group_name: { type: 'string', nullable: true },
              config: { type: 'object', nullable: true },
            },
          },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                deviceSceneConfig: {
                  type: 'object',
                  properties: {
                    duration: { type: 'integer', example: 15, description: '显示时长（秒）' },
                    sort_order: { type: 'integer', example: 0 },
                    enabled: { type: 'boolean', example: true },
                  },
                },
                scene: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    name: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    thumbnail: { type: 'string', nullable: true },
                  },
                },
                components: { type: 'array', items: { $ref: '#/components/schemas/Component' } },
              },
            },
          },
          emergency_alerts: { type: 'array', items: { $ref: '#/components/schemas/EmergencyAlert' } },
        },
      },
      DeviceSceneItem: {
        type: 'object',
        required: ['sceneId'],
        properties: {
          sceneId: { type: 'string', format: 'uuid' },
          duration: { type: 'integer', example: 15, description: '显示时长（秒）' },
          sortOrder: { type: 'integer', example: 0 },
          enabled: { type: 'boolean', example: true },
        },
      },
      // ── 画面 / 组件 ──
      Scene: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: '时钟天气' },
          description: { type: 'string', nullable: true },
          thumbnail: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      SceneWithComponents: {
        allOf: [
          { $ref: '#/components/schemas/Scene' },
          {
            type: 'object',
            properties: {
              components: { type: 'array', items: { $ref: '#/components/schemas/Component' } },
            },
          },
        ],
      },
      CreateSceneRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: '时钟天气' },
          description: { type: 'string', example: '显示时间和天气信息' },
        },
      },
      Component: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          scene_id: { type: 'string', format: 'uuid' },
          type: {
            type: 'string',
            enum: ['clock', 'weather', 'text', 'image', 'iframe', 'info-list'],
            example: 'clock',
          },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number', example: 10, description: '水平位置（百分比）' },
              y: { type: 'number', example: 20, description: '垂直位置（百分比）' },
              width: { type: 'number', example: 80, description: '宽度（百分比）' },
              height: { type: 'number', example: 40, description: '高度（百分比）' },
            },
          },
          config: {
            type: 'object',
            description: '组件特有配置',
            example: { format: '24h', showDate: true },
          },
          style: {
            type: 'object',
            description: '通用样式',
            example: { color: '#ffffff', fontSize: '4em', backgroundColor: 'transparent' },
          },
          sort_order: { type: 'integer', example: 0 },
        },
      },
      CreateComponentRequest: {
        type: 'object',
        required: ['type', 'position', 'config'],
        properties: {
          type: {
            type: 'string',
            enum: ['clock', 'weather', 'text', 'image', 'iframe', 'info-list'],
            example: 'clock',
          },
          position: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: { type: 'number', example: 10 },
              y: { type: 'number', example: 20 },
              width: { type: 'number', example: 80 },
              height: { type: 'number', example: 40 },
            },
          },
          config: {
            type: 'object',
            example: { format: '24h', showDate: true },
            description: '根据组件类型不同：clock={format,showDate,timezone}; weather={city,unit}; text={content,align}; image={url}; iframe={url}; info-list={fontSize,color,backgroundColor,scrollSpeed,pageInterval}',
          },
          style: {
            type: 'object',
            example: { color: '#ffffff', fontSize: '4em' },
          },
        },
      },
      UpdateTextContentRequest: {
        type: 'object',
        required: ['componentId', 'text'],
        properties: {
          componentId: { type: 'string', format: 'uuid', description: '要更新的文本组件 ID' },
          text: { type: 'string', example: '今日购物清单：牛奶、鸡蛋、面包' },
        },
      },
      // ── 信息列表 ──
      InfoItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: {
            type: 'string',
            enum: ['info', 'important', 'urgent'],
            example: 'info',
            description: 'info=提示（蓝）, important=重要（黄）, urgent=紧急（红）',
          },
          text: { type: 'string', example: '明天上午 10 点楼道消毒，请勿外出' },
          start_time: { type: 'string', format: 'date-time', nullable: true, description: '开始显示时间，null 表示立即' },
          end_time: { type: 'string', format: 'date-time', nullable: true, description: '到期时间，null 表示永久' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateInfoItemRequest: {
        type: 'object',
        required: ['text'],
        properties: {
          type: {
            type: 'string',
            enum: ['info', 'important', 'urgent'],
            default: 'info',
            description: 'info=提示（蓝）, important=重要（黄）, urgent=紧急（红）',
          },
          text: { type: 'string', example: '明天上午 10 点楼道消毒，请勿外出' },
          start_time: { type: 'string', format: 'date-time', nullable: true, example: null, description: '开始显示时间，null 表示立即' },
          end_time: { type: 'string', format: 'date-time', nullable: true, example: '2026-03-21T12:00:00', description: '到期时间，null 表示永久' },
        },
      },
      // ── 定时提醒 ──
      TimedReminder: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: '出门提醒' },
          device_ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['all'],
            description: '目标设备 ID 列表，特殊值 "all" 表示所有设备',
          },
          start_time: { type: 'string', example: '08:00', description: '开始时间，HH:MM 格式' },
          end_time: { type: 'string', example: '08:30', description: '结束时间，HH:MM 格式' },
          repeat: { type: 'string', enum: ['none', 'daily', 'weekday', 'weekend'], example: 'daily' },
          content: {
            type: 'object',
            properties: {
              text: { type: 'string', example: '记得带钱包！' },
              style: { type: 'string', enum: ['blink', 'highlight', 'bar-top', 'bar-bottom', 'center'], example: 'blink' },
              fontSize: { type: 'string', example: '2em' },
              color: { type: 'string', example: '#ffffff' },
              backgroundColor: { type: 'string', example: '#ff6600' },
            },
          },
          sound: {
            type: 'object',
            nullable: true,
            properties: {
              file: { type: 'string', example: 'bell.mp3' },
              volume: { type: 'number', minimum: 0, maximum: 1, example: 0.7 },
              loop: { type: 'boolean', example: false },
            },
          },
          priority: { type: 'integer', minimum: 1, maximum: 10, example: 5 },
          enabled: { type: 'boolean', example: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateTimedReminderRequest: {
        type: 'object',
        required: ['name', 'device_ids', 'start_time', 'end_time', 'content'],
        properties: {
          name: { type: 'string', example: '出门提醒' },
          device_ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['all'],
            description: '目标设备 ID 列表，传 ["all"] 表示所有设备',
          },
          start_time: { type: 'string', example: '08:00', description: 'HH:MM 格式' },
          end_time: { type: 'string', example: '08:30', description: 'HH:MM 格式' },
          repeat: { type: 'string', enum: ['none', 'daily', 'weekday', 'weekend'], default: 'none' },
          content: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', example: '记得带钱包！' },
              style: { type: 'string', enum: ['blink', 'highlight', 'bar-top', 'bar-bottom', 'center'], default: 'bar-bottom' },
              fontSize: { type: 'string', example: '2em' },
              color: { type: 'string', example: '#ffffff' },
              backgroundColor: { type: 'string', example: '#ff6600' },
            },
          },
          sound: {
            type: 'object',
            nullable: true,
            properties: {
              file: { type: 'string', example: 'bell.mp3' },
              volume: { type: 'number', minimum: 0, maximum: 1, example: 0.7 },
              loop: { type: 'boolean', example: false },
            },
          },
          priority: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
          enabled: { type: 'boolean', default: true },
        },
      },
      // ── 紧急警报 ──
      EmergencyAlert: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          device_ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['all'],
          },
          content: {
            type: 'object',
            properties: {
              text: { type: 'string', example: '煤气泄漏！请立即撤离！' },
              backgroundColor: { type: 'string', example: '#FF0000' },
              textColor: { type: 'string', example: '#FFFFFF' },
              blink: { type: 'boolean', example: true },
            },
          },
          sound: {
            type: 'object',
            properties: {
              file: { type: 'string', example: 'alarm.mp3' },
              volume: { type: 'number', example: 1.0 },
              loop: { type: 'boolean', example: true },
            },
          },
          status: { type: 'string', enum: ['active', 'cleared'], example: 'active' },
          triggered_at: { type: 'string', format: 'date-time' },
          triggered_by: { type: 'string', nullable: true },
          cleared_at: { type: 'string', format: 'date-time', nullable: true },
          cleared_by: { type: 'string', nullable: true },
        },
      },
      TriggerEmergencyRequest: {
        type: 'object',
        required: ['content'],
        properties: {
          device_ids: {
            type: 'array',
            items: { type: 'string' },
            example: ['all'],
            description: '目标设备 ID 列表，传 ["all"] 表示所有设备。也可写作 deviceIds（camelCase）',
          },
          content: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', example: '煤气泄漏！请立即撤离！' },
              backgroundColor: { type: 'string', default: '#FF0000', example: '#FF0000' },
              textColor: { type: 'string', default: '#FFFFFF', example: '#FFFFFF' },
              blink: { type: 'boolean', default: true },
            },
          },
          sound: {
            type: 'object',
            properties: {
              file: { type: 'string', example: 'alarm.mp3' },
              volume: { type: 'number', minimum: 0, maximum: 1, default: 0.8 },
              loop: { type: 'boolean', default: true, description: '紧急警报必须为 true' },
            },
          },
        },
      },
      // ── API 密钥 ──
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'HomeAssistant 集成' },
          key: { type: 'string', example: 'hs_live_xxxxxxxxxxxx', description: '完整密钥仅在创建时返回一次' },
          permissions: { type: 'string', nullable: true },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          last_used_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      CreateApiKeyRequest: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', example: 'HomeAssistant 集成' },
          permissions: { type: 'string', nullable: true, description: '权限标识（预留字段）' },
          expires_at: { type: 'string', format: 'date-time', nullable: true, description: '过期时间，不填则永不过期' },
        },
      },
      // ── 上传文件 ──
      Upload: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          filename: { type: 'string', example: 'abc123.mp3' },
          original_name: { type: 'string', example: 'alarm.mp3' },
          file_type: { type: 'string', enum: ['image', 'audio'], example: 'audio' },
          mime_type: { type: 'string', example: 'audio/mpeg' },
          size: { type: 'integer', example: 204800, description: '文件大小（字节）' },
          url: { type: 'string', example: '/uploads/abc123.mp3' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      // ── 系统状态 ──
      SystemStatus: {
        type: 'object',
        properties: {
          uptime: { type: 'integer', example: 3600, description: '运行时间（秒）' },
          uptime_human: { type: 'string', example: '1h 0m 0s' },
          device_count: { type: 'integer', example: 3 },
          online_device_count: { type: 'integer', example: 2 },
          connected_device_count: { type: 'integer', example: 2 },
          connected_device_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, description: '当前通过 WebSocket 连接的设备 ID 列表' },
          active_reminder_count: { type: 'integer', example: 1 },
          active_emergency_count: { type: 'integer', example: 0 },
          node_version: { type: 'string', example: 'v18.12.0' },
          platform: { type: 'string', example: 'linux', description: 'Node.js process.platform' },
          memory: {
            type: 'object',
            properties: {
              rss: { type: 'integer' },
              heapTotal: { type: 'integer' },
              heapUsed: { type: 'integer' },
              external: { type: 'integer' },
            },
          },
          pid: { type: 'integer', example: 1234 },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: '未认证或 Token/Key 无效',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: '资源不存在',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      BadRequest: {
        description: '请求参数有误',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PATHS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  paths: {
    // ── Auth ──
    '/auth/login': {
      post: {
        tags: ['认证'],
        summary: '管理员登录',
        description: '使用用户名和密码登录，返回 JWT Token。默认账号：admin / admin123',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: {
          200: {
            description: '登录成功',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/verify': {
      get: {
        tags: ['认证'],
        summary: '验证 JWT Token 有效性',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Token 有效',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object', properties: { user: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' }, role: { type: 'string' } } } } }, message: { type: 'string' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['认证'],
        summary: '修改密码',
        description: '修改当前登录用户的密码，新密码至少 6 位。',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChangePasswordRequest' } } },
        },
        responses: {
          200: { description: '密码修改成功', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string', example: '密码已修改成功' } } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },

    // ── Devices ──
    '/devices': {
      get: {
        tags: ['设备管理'],
        summary: '获取所有设备列表',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: '设备列表',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Device' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['设备管理'],
        summary: '添加新设备',
        description: '创建设备后返回 device_key，该密钥用于设备客户端认证，**仅此时完整返回，请妥善保存**。',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDeviceRequest' } } },
        },
        responses: {
          201: {
            description: '设备创建成功',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Device' }, message: { type: 'string' } } } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/devices/{id}': {
      get: {
        tags: ['设备管理'],
        summary: '获取指定设备详情',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: '设备 ID' }],
        responses: {
          200: { description: '设备详情', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Device' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['设备管理'],
        summary: '更新设备信息',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateDeviceRequest' } } },
        },
        responses: {
          200: { description: '更新成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Device' }, message: { type: 'string' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['设备管理'],
        summary: '删除设备',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '删除成功' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/devices/{id}/config': {
      get: {
        tags: ['设备管理'],
        summary: '获取设备完整配置',
        description: '供显示客户端调用，返回设备绑定的画面列表、各画面组件，以及当前活跃的紧急警报。使用 X-Device-Key 而非 JWT 认证。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: '设备 ID' },
          { name: 'X-Device-Key', in: 'header', required: true, schema: { type: 'string' }, description: '设备专属密钥' },
        ],
        responses: {
          200: {
            description: '设备配置',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/DeviceConfig' } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/devices/{id}/heartbeat': {
      post: {
        tags: ['设备管理'],
        summary: '设备心跳上报',
        description: '显示客户端定期调用（每 30 秒），更新设备在线状态和 IP 地址。响应中会返回当前活跃的紧急警报。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  browserInfo: { type: 'object', properties: { userAgent: { type: 'string' }, platform: { type: 'string' }, screenSize: { type: 'string' } } },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: '心跳成功',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'online' },
                        emergency_alerts: { type: 'array', items: { $ref: '#/components/schemas/EmergencyAlert' } },
                      },
                    },
                    message: { type: 'string', example: 'Heartbeat received' },
                  },
                },
              },
            },
          },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/devices/{id}/scenes': {
      get: {
        tags: ['设备管理'],
        summary: '获取设备绑定的画面列表',
        description: '返回设备当前分配的画面及其轮播配置（时长、顺序、是否启用）。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: {
            description: '设备画面列表',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } } } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['设备管理'],
        summary: '配置设备的轮播画面',
        description: '为设备分配画面列表并配置每个画面的显示时长和顺序。传入列表会完整替换原有配置。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scenes'],
                properties: {
                  scenes: { type: 'array', items: { $ref: '#/components/schemas/DeviceSceneItem' } },
                },
              },
              example: { scenes: [{ sceneId: 'uuid-1', duration: 15, sortOrder: 0, enabled: true }, { sceneId: 'uuid-2', duration: 20, sortOrder: 1, enabled: true }] },
            },
          },
        },
        responses: {
          200: { description: '配置成功' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/devices/{id}/active-scene': {
      post: {
        tags: ['设备管理'],
        summary: '强制切换设备当前画面',
        description: '立即通过 WebSocket 通知设备切换到指定画面（发送 force-scene 事件）。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['sceneId'], properties: { sceneId: { type: 'string', format: 'uuid' } } } } },
        },
        responses: {
          200: { description: '切换指令已发送' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/devices/{id}/refresh': {
      post: {
        tags: ['设备管理'],
        summary: '强制设备刷新页面',
        description: '通过 WebSocket 发送 force-refresh 事件，设备将立即重新加载整个页面。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '刷新指令已发送', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string', example: 'Force refresh command sent' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Scenes ──
    '/scenes': {
      get: {
        tags: ['画面管理'],
        summary: '获取所有画面',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '画面列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Scene' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['画面管理'],
        summary: '创建画面',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSceneRequest' } } } },
        responses: {
          201: { description: '创建成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Scene' }, message: { type: 'string' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/scenes/{id}': {
      get: {
        tags: ['画面管理'],
        summary: '获取画面详情（含组件）',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '画面详情', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/SceneWithComponents' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['画面管理'],
        summary: '更新画面信息',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateSceneRequest' } } } },
        responses: { 200: { description: '更新成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      delete: {
        tags: ['画面管理'],
        summary: '删除画面',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '删除成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/scenes/{id}/components': {
      get: {
        tags: ['画面管理'],
        summary: '获取画面的所有组件',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '组件列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Component' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['画面管理'],
        summary: '向画面添加组件',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComponentRequest' } } } },
        responses: {
          201: { description: '组件创建成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Component' }, message: { type: 'string' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/scenes/{id}/components/{componentId}': {
      put: {
        tags: ['画面管理'],
        summary: '更新组件',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'componentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateComponentRequest' } } } },
        responses: { 200: { description: '更新成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      delete: {
        tags: ['画面管理'],
        summary: '删除组件',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'componentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: '删除成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/scenes/{id}/content/text': {
      patch: {
        tags: ['画面管理'],
        summary: '动态更新文本组件内容',
        description: '外部系统（如家庭自动化系统）用于动态更新指定画面中文本组件的内容，无需重新配置整个画面。更新后会通过 WebSocket 推送 config-updated 事件通知所有相关设备。请求体字段为 `text`（非 content）。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: '画面 ID' }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateTextContentRequest' } } } },
        responses: {
          200: { description: '更新成功，已通知相关设备刷新' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Info Items ──
    '/info-items': {
      get: {
        tags: ['信息列表'],
        summary: '获取所有信息条目',
        description: '返回全部信息条目（含已过期），按创建时间降序排列。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: '信息条目列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/InfoItem' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['信息列表'],
        summary: '创建信息条目',
        description: '创建后通过 Socket.IO 实时推送 info-items-updated 事件到所有显示设备。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateInfoItemRequest' } } },
        },
        responses: {
          201: { description: '创建成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/InfoItem' }, message: { type: 'string' } } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/info-items/active': {
      get: {
        tags: ['信息列表'],
        summary: '获取当前有效的信息条目',
        description: '返回 start_time 已到且 end_time 未到期（或永久）的条目，供显示客户端调用，无需认证。',
        responses: {
          200: { description: '有效信息条目', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/InfoItem' } } } } } } },
        },
      },
    },
    '/info-items/{id}': {
      put: {
        tags: ['信息列表'],
        summary: '更新信息条目',
        description: '支持部分更新，只传需要修改的字段。更新后实时推送到所有显示设备。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateInfoItemRequest' } } },
        },
        responses: {
          200: { description: '更新成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/InfoItem' }, message: { type: 'string' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['信息列表'],
        summary: '删除信息条目',
        description: '删除后实时推送到所有显示设备。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '删除成功' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Timed Reminders ──
    '/reminders/timed': {
      get: {
        tags: ['定时提醒'],
        summary: '获取所有定时提醒',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: '定时提醒列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/TimedReminder' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['定时提醒'],
        summary: '创建定时提醒',
        description: '创建后自动加入调度器，到达 start_time 时推送给目标设备，到达 end_time 时自动解除。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTimedReminderRequest' } } } },
        responses: {
          201: { description: '创建成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/TimedReminder' }, message: { type: 'string' } } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/reminders/timed/{id}': {
      get: {
        tags: ['定时提醒'],
        summary: '获取指定定时提醒',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: '提醒详情', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/TimedReminder' } } } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      put: {
        tags: ['定时提醒'],
        summary: '更新定时提醒',
        description: '更新后自动重新调度。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTimedReminderRequest' } } } },
        responses: { 200: { description: '更新成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
      delete: {
        tags: ['定时提醒'],
        summary: '删除定时提醒',
        description: '删除后自动从调度器中移除。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '删除成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },

    // ── Emergency Alerts ──
    '/reminders/emergency': {
      get: {
        tags: ['紧急警报'],
        summary: '获取所有紧急警报历史',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: '警报列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/EmergencyAlert' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['紧急警报'],
        summary: '触发紧急警报',
        description: '**立即**通过 WebSocket 推送到目标设备（端到端延迟 < 2 秒）。设备将全屏显示警报内容并循环播放警示音，直至手动解除。`device_ids` 字段也可写作 `deviceIds`（camelCase）。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TriggerEmergencyRequest' } } } },
        responses: {
          201: {
            description: '警报已触发并推送',
            content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/EmergencyAlert' }, message: { type: 'string' } } } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/reminders/emergency/active': {
      get: {
        tags: ['紧急警报'],
        summary: '查询当前活跃的紧急警报',
        description: '返回所有状态为 active 的警报，可用于轮询检查警报状态。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: '活跃警报列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/EmergencyAlert' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/reminders/emergency/{id}': {
      delete: {
        tags: ['紧急警报'],
        summary: '解除紧急警报',
        description: '解除后立即通过 WebSocket 发送 emergency-clear 事件，所有目标设备自动恢复正常显示。',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: '警报 ID' }],
        responses: {
          200: { description: '警报已解除，设备已恢复正常' },
          400: { description: '警报已是已解除状态', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── API Keys ──
    '/api-keys': {
      get: {
        tags: ['API 密钥'],
        summary: '获取所有 API 密钥',
        description: '列表中的密钥字段已脱敏（仅显示前后几位），完整密钥仅在创建时返回一次。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'API 密钥列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['API 密钥'],
        summary: '生成新 API 密钥',
        description: '**注意**：完整密钥仅在响应中返回一次，请立即复制保存。',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateApiKeyRequest' } } } },
        responses: {
          201: { description: '密钥创建成功，请立即保存完整密钥', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/ApiKey' }, message: { type: 'string' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/api-keys/{id}': {
      delete: {
        tags: ['API 密钥'],
        summary: '删除 API 密钥',
        description: '删除后该密钥立即失效，使用该密钥的外部系统将无法访问 API。',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '删除成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },

    // ── Uploads ──
    '/uploads': {
      get: {
        tags: ['文件上传'],
        summary: '获取已上传文件列表',
        description: '可通过 type 查询参数过滤文件类型。',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['image', 'audio', 'video'] }, description: '按文件类型过滤' },
        ],
        responses: {
          200: { description: '文件列表', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Upload' } } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      post: {
        tags: ['文件上传'],
        summary: '上传图片或音频文件',
        description: '支持图片（jpg/png/gif/webp）和音频（mp3/wav/ogg）文件。上传成功后返回可用于组件配置的 URL。',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary', description: '图片或音频文件' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '上传成功', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Upload' }, message: { type: 'string' } } } } } },
          400: { description: '文件类型不支持或文件过大' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/uploads/{id}': {
      delete: {
        tags: ['文件上传'],
        summary: '删除上传的文件',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '删除成功' }, 401: { $ref: '#/components/responses/Unauthorized' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },

    // ── Weather ──
    '/weather': {
      get: {
        tags: ['天气'],
        summary: '获取城市天气数据',
        description: '通过 wttr.in 获取实时天气，无需 API Key，无需认证。',
        parameters: [
          { name: 'city', in: 'query', required: false, schema: { type: 'string', example: 'Beijing' }, description: '城市名（英文或中文），默认 Beijing' },
          { name: 'unit', in: 'query', required: false, schema: { type: 'string', enum: ['C', 'F'], default: 'C' }, description: '温度单位（当前仅用于前端展示，后端同时返回摄氏和华氏）' },
        ],
        responses: {
          200: {
            description: '天气数据',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        city: { type: 'string', example: 'Beijing' },
                        tempC: { type: 'integer', example: 22 },
                        tempF: { type: 'integer', example: 72 },
                        weatherCode: { type: 'integer', example: 113 },
                        description: { type: 'string', example: '晴' },
                        humidity: { type: 'string', example: '45' },
                        windKmph: { type: 'string', example: '15' },
                      },
                    },
                  },
                },
              },
            },
          },
          502: { description: '上游天气服务不可用', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── System ──
    '/system/status': {
      get: {
        tags: ['系统'],
        summary: '获取系统运行状态',
        description: '返回服务器运行时间、设备在线情况、活跃提醒数量、内存使用等信息。',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: '系统状态', content: { 'application/json': { schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/SystemStatus' } } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
  },

  tags: [
    { name: '认证', description: '管理员登录、Token 验证和密码修改' },
    { name: '设备管理', description: '显示设备的注册、配置和状态管理' },
    { name: '画面管理', description: '画面和组件的 CRUD 操作' },
    { name: '信息列表', description: '全局信息公告条目管理（实时推送到所有显示设备）' },
    { name: '定时提醒', description: '定时提醒任务的创建和调度' },
    { name: '紧急警报', description: '紧急警报的触发和解除（< 2 秒端到端推送）' },
    { name: 'API 密钥', description: '外部系统集成密钥管理' },
    { name: '文件上传', description: '图片和音频文件上传' },
    { name: '天气', description: '实时天气数据查询（wttr.in）' },
    { name: '系统', description: '系统运行状态监控' },
  ],
};

module.exports = swaggerSpec;
