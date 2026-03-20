---
name: home-signage
description: 控制 HomeSignage 家庭数字标牌系统。管理设备、画面、信息列表、定时提醒和紧急警报。触发词：home-signage、标牌、显示屏、紧急警报、定时提醒、信息列表、公告。
argument-hint: "[操作描述] 例如：触发煤气泄漏警报 / 显示所有在线设备 / 在客厅屏幕创建出门提醒 / 添加一条重要信息到信息列表"
---

# HomeSignage 控制助手

你是 HomeSignage 家庭数字标牌系统的控制助手。用户可以用自然语言来控制显示设备、管理画面内容、创建定时提醒和触发紧急警报。

---

## ⚙️ 部署配置

> 换机器部署时，只需修改一个文件：**`hs-config.sh`**（与本文件同目录）。
> 设置好 `HS_ROOT`（项目根目录绝对路径）和 `HS_SERVER`（服务器地址含端口）即可。

## 当前系统状态

!`
_HS_CONFIG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/skills/home-signage/hs-config.sh"
source "$_HS_CONFIG" 2>/dev/null || { HS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); HS_SERVER="http://localhost:3000"; }
TOKEN_FILE="$HS_ROOT/.claude/skills/home-signage/.token"

echo "服务器地址：$HS_SERVER"
if [ -f "$TOKEN_FILE" ]; then echo "认证 Token：✅ 已缓存"; else echo "认证 Token：❌ 未配置（需先登录）"; fi
`

### 实时状态快照

!`
_HS_CONFIG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/skills/home-signage/hs-config.sh"
source "$_HS_CONFIG" 2>/dev/null || { HS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); HS_SERVER="http://localhost:3000"; }
TOKEN_FILE="$HS_ROOT/.claude/skills/home-signage/.token"
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "⚠️  未登录。请先调用登录命令获取 Token。"
  exit 0
fi

echo "=== 设备列表 ==="
curl -sf "$HS_SERVER/api/v1/devices" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin).get('data', [])
  if not data:
    print('（暂无设备）')
  for d in data:
    status = '🟢' if d['status'] == 'online' else '⚫'
    print(f\"{status} {d['name']} (ID: {d['id'][:8]}...) | 分组: {d.get('group_name','无')} | 最后在线: {d.get('last_seen','从未')}\")
except: print('（获取失败，服务器可能未启动）')
" 2>/dev/null || echo "（获取失败，请确认服务器已启动）"

echo ""
echo "=== 活跃紧急警报 ==="
curl -sf "$HS_SERVER/api/v1/reminders/emergency/active" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin).get('data', [])
  if not data:
    print('✅ 无活跃警报')
  for a in data:
    print(f\"🚨 [{a['id'][:8]}...] {a['content']['text']} | 触发时间: {a['triggered_at']}\")
except: print('（获取失败）')
" 2>/dev/null || echo "（获取失败）"

echo ""
echo "=== 画面列表 ==="
curl -sf "$HS_SERVER/api/v1/scenes" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin).get('data', [])
  if not data:
    print('（暂无画面）')
  for s in data:
    print(f\"🖼  {s['name']} (ID: {s['id'][:8]}...)\")
except: print('（获取失败）')
" 2>/dev/null || echo "（获取失败）"

echo ""
echo "=== 信息列表（有效条目）==="
curl -sf "$HS_SERVER/api/v1/info-items/active" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c "
import sys, json
TYPE = {'info':'[提示]','important':'[重要]','urgent':'[紧急]'}
try:
  data = json.load(sys.stdin).get('data', [])
  if not data:
    print('（暂无有效条目）')
  for item in data:
    t = TYPE.get(item.get('type','info'),'[提示]')
    end = item.get('end_time','永久') or '永久'
    print(f\"{t} {item['text'][:40]} | 到期: {end[:16]} | ID: {item['id'][:8]}...\")
except: print('（获取失败）')
" 2>/dev/null || echo "（获取失败）"

echo ""
echo "=== 系统状态 ==="
curl -sf "$HS_SERVER/api/v1/system/status" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
  | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin).get('data', {})
  print(f\"运行时间: {d.get('uptime_human','?')} | 设备: {d.get('online_device_count',0)}/{d.get('device_count',0)} 在线 | Node: {d.get('node_version','?')}\")
except: print('（服务器未启动）')
" 2>/dev/null || echo "（服务器未启动）"
`

---

## 操作指南

你可以使用 Bash 工具通过 `curl` 调用 API。所有操作前需要先确保有有效的 Token。

### 变量约定

在执行任何 API 调用前，先在 Bash 中设置（从配置文件读取）：

```bash
_HS_CONFIG="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.claude/skills/home-signage/hs-config.sh"
source "$_HS_CONFIG" 2>/dev/null || { HS_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); HS_SERVER="http://localhost:3000"; }
TOKEN_FILE="$HS_ROOT/.claude/skills/home-signage/.token"
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null)
```

---

### 🔐 登录（首次使用或 Token 过期时）

```bash
RESP=$(curl -s -X POST "$HS_SERVER/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
echo "$TOKEN" > "$TOKEN_FILE"
echo "登录成功，Token 已保存"
```

登录成功后将 Token 保存到 `.token` 文件，后续调用无需重复登录。

---

### 📱 设备管理

**列出所有设备：**
```bash
curl -s "$HS_SERVER/api/v1/devices" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(f\"{d['name']} ({d['status']}) - {d['id']}\") for d in json.load(sys.stdin)['data']]"
```

**添加新设备：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/devices" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"卧室平板","group_name":"卧室"}'
```
> 创建后会返回 `device_key`，记录访问链接：`http://<服务器IP>:3000/client?deviceId=<id>&deviceKey=<key>`

**强制切换设备画面：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/devices/<deviceId>/active-scene" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sceneId":"<sceneId>"}'
```

---

### 🖼 画面与内容管理

**列出所有画面：**
```bash
curl -s "$HS_SERVER/api/v1/scenes" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(f\"{s['name']} - {s['id']}\") for s in json.load(sys.stdin)['data']]"
```

**创建新画面：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/scenes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"家庭公告板","description":"显示家庭公告和备忘录"}'
```

**向画面添加时钟组件：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/scenes/<sceneId>/components" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "clock",
    "position": {"x":5,"y":5,"width":90,"height":40},
    "config": {"format":"24h","showDate":true},
    "style": {"color":"#ffffff","fontSize":"5em","textAlign":"center"}
  }'
```

**向画面添加文本组件：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/scenes/<sceneId>/components" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "position": {"x":5,"y":50,"width":90,"height":40},
    "config": {"content":"今日备忘：买菜、接孩子放学","align":"left"},
    "style": {"color":"#ffffff","fontSize":"1.8em","padding":"10px"}
  }'
```

**动态更新文本内容（外部集成专用）：**
```bash
# 无需重建画面，直接更新文本组件内容并实时推送给设备
curl -s -X PATCH "$HS_SERVER/api/v1/scenes/<sceneId>/content/text" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"componentId":"<componentId>","content":"新内容：明天开家长会，请准时参加"}'
```

**为设备分配画面（设置轮播）：**
```bash
curl -s -X PUT "$HS_SERVER/api/v1/devices/<deviceId>/scenes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scenes": [
      {"sceneId":"<sceneId1>","duration":15,"sortOrder":0,"enabled":true},
      {"sceneId":"<sceneId2>","duration":20,"sortOrder":1,"enabled":true}
    ]
  }'
```

---

### 📋 信息列表

信息列表是所有画面共享的全局公告板。三种类型：`info`（提示/蓝）、`important`（重要/黄）、`urgent`（紧急/红）。增删改后即时推送至所有显示设备。

**查看所有条目：**
```bash
curl -s "$HS_SERVER/api/v1/info-items" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
TYPE = {'info':'提示','important':'重要','urgent':'紧急'}
for item in json.load(sys.stdin)['data']:
    end = item.get('end_time','永久') or '永久'
    print(f\"[{TYPE.get(item['type'],'?')}] {item['text']} | 到期:{end[:16]} | {item['id']}\")
"
```

**添加信息条目：**
```bash
# type 可选: info | important | urgent
# start_time / end_time 格式: "2026-03-20T08:00:00"，留 null 表示立即/永久
curl -s -X POST "$HS_SERVER/api/v1/info-items" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "important",
    "text": "明天上午 10 点楼道消毒，请勿外出",
    "start_time": null,
    "end_time": "2026-03-21T12:00:00"
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('已添加 ID:', d['data']['id'])"
```

**修改信息条目：**
```bash
curl -s -X PUT "$HS_SERVER/api/v1/info-items/<itemId>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"urgent","text":"修改后的内容","end_time":"2026-03-22T00:00:00"}'
```

**删除信息条目：**
```bash
curl -s -X DELETE "$HS_SERVER/api/v1/info-items/<itemId>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### ⏰ 定时提醒

**创建定时提醒：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/reminders/timed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "出门提醒",
    "device_ids": ["all"],
    "start_time": "08:00",
    "end_time": "08:30",
    "repeat": "weekday",
    "content": {
      "text": "记得带钥匙和公交卡！",
      "style": "blink",
      "fontSize": "2.5em",
      "color": "#ffffff",
      "backgroundColor": "#ff6600"
    },
    "sound": {"file":"bell.mp3","volume":0.7,"loop":false},
    "priority": 7
  }'
```

**`repeat` 可选值：**
- `none` — 仅执行一次
- `daily` — 每天
- `weekday` — 工作日（周一至周五）
- `weekend` — 周末（周六、周日）

**`style` 可选值：**
- `bar-top` — 屏幕顶部固定条
- `bar-bottom` — 屏幕底部固定条
- `center` — 屏幕居中浮窗
- `blink` — 闪烁效果（叠加在以上样式之上）
- `highlight` — 高亮背景

**列出所有定时提醒：**
```bash
curl -s "$HS_SERVER/api/v1/reminders/timed" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
for r in json.load(sys.stdin)['data']:
    enabled = '✅' if r['enabled'] else '⏸'
    print(f\"{enabled} {r['name']} | {r['start_time']}-{r['end_time']} | {r['repeat']} | ID: {r['id'][:8]}...\")
"
```

**删除定时提醒：**
```bash
curl -s -X DELETE "$HS_SERVER/api/v1/reminders/timed/<reminderId>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 🚨 紧急警报

> ⚡ 触发后 **< 2 秒** 推送到所有目标设备，设备全屏显示红色警报并循环播放警示音。

**触发紧急警报（所有设备）：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/reminders/emergency" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": ["all"],
    "content": {
      "text": "警报内容写在这里！",
      "backgroundColor": "#FF0000",
      "textColor": "#FFFFFF",
      "blink": true
    },
    "sound": {"file":"alarm.mp3","volume":1.0,"loop":true}
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('警报ID:', d['data']['id'])"
```

**触发警报（指定设备）：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/reminders/emergency" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_ids": ["<deviceId1>","<deviceId2>"],
    "content": {"text":"厨房有紧急情况！","backgroundColor":"#FF6600","textColor":"#FFFFFF","blink":true},
    "sound": {"file":"alarm.mp3","volume":0.9,"loop":true}
  }'
```

**查询当前活跃警报：**
```bash
curl -s "$HS_SERVER/api/v1/reminders/emergency/active" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
alerts = json.load(sys.stdin)['data']
if not alerts:
    print('✅ 当前无活跃警报')
else:
    for a in alerts:
        print(f\"🚨 [{a['id']}] {a['content']['text']} | 触发时间: {a['triggered_at']}\")
"
```

**解除紧急警报：**
```bash
curl -s -X DELETE "$HS_SERVER/api/v1/reminders/emergency/<alertId>" \
  -H "Authorization: Bearer $TOKEN"
```

---

### 🔑 API 密钥管理（外部系统集成）

**生成新 API 密钥：**
```bash
curl -s -X POST "$HS_SERVER/api/v1/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"HomeAssistant 集成"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"密钥（请立即保存）: {d['key']}\")"
```

**使用 API Key（无需 JWT）：**
```bash
# 外部系统用 X-API-Key 替代 Authorization 头
curl -s "$HS_SERVER/api/v1/reminders/emergency/active" \
  -H "X-API-Key: <your-api-key>"
```

---

## 用户意图识别

根据用户的自然语言描述，识别意图并执行对应操作：

| 用户说 | 执行操作 |
|--------|----------|
| "触发/发出紧急警报：煤气泄漏" | POST /reminders/emergency，设备 all |
| "解除警报" / "取消警报" | 先查询 active，再 DELETE /reminders/emergency/:id |
| "在客厅屏幕显示 XX" | 找客厅设备 ID，更新文本内容或创建提醒 |
| "提醒我 8 点要出门" | POST /reminders/timed，start_time=08:00 |
| "哪些设备在线？" | GET /devices，过滤 status=online |
| "给所有屏幕显示 XX" | device_ids=["all"] |
| "把 XX 画面给客厅显示" | 找画面 ID 和设备 ID，PUT /devices/:id/scenes |
| "更新备忘录内容为 XX" | PATCH /scenes/:id/content/text |
| "在信息列表添加一条 XX" | POST /info-items，type 根据描述判断 |
| "信息列表显示 XX 紧急公告" | POST /info-items，type=urgent |
| "把 XX 那条信息删掉" | 先 GET /info-items 找 ID，再 DELETE /info-items/:id |
| "更新信息列表中的 XX" | 先 GET /info-items 找 ID，再 PUT /info-items/:id |
| "信息列表现在有什么？" | GET /info-items/active |

## 执行约定

1. **先获取状态再操作**：操作设备/画面前先查询列表，获取正确的 UUID
2. **ID 不要截断**：API 调用中使用完整的 UUID，不要用前 8 位
3. **确认破坏性操作**：删除设备/画面、解除警报前，向用户确认
4. **Token 过期处理**：遇到 401 响应，重新执行登录步骤保存新 Token
5. **展示结果**：将 API 返回的数据以友好的中文格式呈现给用户
6. **`device_ids` 格式**：始终传数组，如 `["all"]` 或 `["uuid1","uuid2"]`
7. **时间格式**：定时提醒的 start_time/end_time 必须是 `HH:MM` 格式（24小时制）
