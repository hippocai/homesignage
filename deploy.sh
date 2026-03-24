#!/bin/bash
# HomeSignage Docker 部署脚本（无需 docker-compose）
set -e

IMAGE_NAME="home-signage"
CONTAINER_NAME="home-signage"
PORT="3000"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── 读取 JWT_SECRET ──────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

if [ -z "$JWT_SECRET" ]; then
  echo "错误：未设置 JWT_SECRET。请在 .env 文件中配置或执行："
  echo "  export JWT_SECRET=your_secret_here"
  exit 1
fi

# ── 创建数据目录 ─────────────────────────────────────────────────────
mkdir -p "$SCRIPT_DIR/data" \
         "$SCRIPT_DIR/uploads" \
         "$SCRIPT_DIR/logs" \
         "$SCRIPT_DIR/file-repo"

# ── 构建镜像 ─────────────────────────────────────────────────────────
echo ">>> 构建 Docker 镜像..."
docker build \
  -t "$IMAGE_NAME" \
  -f "$SCRIPT_DIR/docker/Dockerfile" \
  "$SCRIPT_DIR"

# ── 停止并删除旧容器（如有）───────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ">>> 停止并删除旧容器..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm   "$CONTAINER_NAME" 2>/dev/null || true
fi

# ── 启动容器 ─────────────────────────────────────────────────────────
echo ">>> 启动容器..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:3000" \
  -v "$SCRIPT_DIR/data:/app/data" \
  -v "$SCRIPT_DIR/uploads:/app/uploads" \
  -v "$SCRIPT_DIR/logs:/app/logs" \
  -v "$SCRIPT_DIR/file-repo:/app/file-repo" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e JWT_SECRET="$JWT_SECRET" \
  -e SQLITE_PATH=/app/data/signage.db \
  -e LOG_LEVEL=info \
  -e FILE_REPO_PATH=/app/file-repo \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  "$IMAGE_NAME"

echo ""
echo "✅ 部署完成！"
echo "   管理后台：http://localhost:${PORT}/admin"
echo "   展示客户端：http://localhost:${PORT}/client"
echo "   默认账号：admin / admin123"
echo ""
echo "常用命令："
echo "   查看日志：docker logs -f $CONTAINER_NAME"
echo "   停止服务：docker stop $CONTAINER_NAME"
echo "   重启服务：docker restart $CONTAINER_NAME"
