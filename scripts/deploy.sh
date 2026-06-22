#!/bin/bash

set -e

echo "=== 开始部署 Xictation 到服务器 ==="

LOCAL_DIR="/Users/jihang/Documents/trae_projects/Xictation"
REMOTE_HOST="ecs-user@47.96.90.212"
REMOTE_DIR="/home/ecs-user/app/xictation"

RSYNC_RSH="ssh -o StrictHostKeyChecking=no -i /Users/jihang/.ssh/id_ed25519 -p 22"

echo "同步项目文件到服务器..."
rsync -avz --delete \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.vscode' \
    --exclude='.trae' \
    --exclude='._*' \
    --exclude='*.md' \
    -e "$RSYNC_RSH" \
    "$LOCAL_DIR/app/" \
    "$REMOTE_HOST:$REMOTE_DIR/app/"

rsync -avz \
    --exclude='._*' \
    -e "$RSYNC_RSH" \
    "$LOCAL_DIR/Dockerfile" \
    "$LOCAL_DIR/docker-compose.yml" \
    "$LOCAL_DIR/requirements.txt" \
    "$LOCAL_DIR/.env.prod" \
    "$LOCAL_DIR/.env.test" \
    "$LOCAL_DIR/.dockerignore" \
    "$REMOTE_HOST:$REMOTE_DIR/"

echo "清理服务器上的 ._* 文件..."
ssh -o StrictHostKeyChecking=no -i /Users/jihang/.ssh/id_ed25519 -p 22 \
    "$REMOTE_HOST" "find $REMOTE_DIR -name '._*' -delete 2>/dev/null || true"

echo "=== 文件同步完成 ==="
