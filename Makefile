SERVER_HOST = ecs-user@118.31.109.63
SERVER_DIR = /home/ecs-user/app/xictation
SSH_KEY = /Users/jihang/Downloads/jihang.pem
SSH = ssh -o StrictHostKeyChecking=no -i $(SSH_KEY)
RSYNC = rsync -avz --delete \
	--exclude='.git' \
	--exclude='__pycache__' \
	--exclude='*.pyc' \
	--exclude='.vscode' \
	--exclude='.trae' \
	--exclude='._*' \
	--exclude='*.md' \
	--exclude='.env' \
	-e "$(SSH)"

.PHONY: sync test prod deploy-test deploy-prod restart-test restart-prod logs-test logs-prod

# 同步代码到服务器（不重建容器）
sync:
	@echo "=== 同步代码到服务器 ==="
	$(RSYNC) ./app/ $(SERVER_HOST):$(SERVER_DIR)/app/
	$(SSH) $(SERVER_HOST) "find $(SERVER_DIR) -name '._*' -delete 2>/dev/null || true"
	@echo "=== 同步完成 ==="

# 同步配置文件
sync-config:
	@echo "=== 同步配置文件 ==="
	rsync -avz --exclude='._*' -e "$(SSH)" \
		Dockerfile docker-compose.yml requirements.txt \
		.env.prod .env.test .dockerignore \
		$(SERVER_HOST):$(SERVER_DIR)/
	@echo "=== 配置同步完成 ==="

# 部署到test环境（18001）— 重建镜像
test: sync
	@echo "=== 部署到 test 环境 ==="
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.test build web && \
		sudo docker compose --env-file .env.test up -d web"
	@echo "=== test 部署完成 → http://118.31.109.63:18001 ==="

# 部署到prod环境（18000）— 重建镜像（依赖/配置变更时使用）
prod: sync sync-config
	@echo "=== 部署到 prod 环境 ==="
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.prod build web && \
		sudo docker compose --env-file .env.prod up -d web"
	@echo "=== prod 部署完成 → http://118.31.109.63:18000 ==="

# 快速部署到test — 同步代码 + 重建镜像 + 重启（日常开发用）
deploy-test: sync
	@echo "=== 快速部署到 test 环境 ==="
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.test build web && \
		sudo docker compose --env-file .env.test up -d web"
	@echo "=== test 快速部署完成 → http://118.31.109.63:18001 ==="

# 快速部署到prod — 同步代码 + 重建镜像 + 重启（日常更新用，约 10 秒）
deploy-prod: sync
	@echo "=== 快速部署到 prod 环境 ==="
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.prod build web && \
		sudo docker compose --env-file .env.prod up -d web"
	@echo "=== prod 快速部署完成 → http://118.31.109.63:18000 ==="

# 重启test环境
restart-test:
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.test restart web"

# 重启prod环境
restart-prod:
	$(SSH) $(SERVER_HOST) "cd $(SERVER_DIR) && \
		sudo docker compose --env-file .env.prod restart web"

# 查看test日志
logs-test:
	$(SSH) $(SERVER_HOST) "sudo docker logs xictation-test_web --tail 50 -f"

# 查看prod日志
logs-prod:
	$(SSH) $(SERVER_HOST) "sudo docker logs xictation-prod_web --tail 50 -f"
