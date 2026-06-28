"""FastAPI 应用主入口"""
import os
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager

from app.database import Base, engine, SessionLocal
from app.routers import dictations, vocabulary, api, auth, practice
from app.auth import get_current_user_id
from app.templating import templates


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时创建数据库表"""
    Base.metadata.create_all(bind=engine)
    # 迁移：为已有表添加新列
    from sqlalchemy import text, inspect
    inspector = inspect(engine)
    if "dictation_card" in inspector.get_table_names():
        existing_columns = [c["name"] for c in inspector.get_columns("dictation_card")]
        with engine.connect() as conn:
            if "analysis_card_visible" not in existing_columns:
                conn.execute(text("ALTER TABLE dictation_card ADD COLUMN analysis_card_visible INTEGER DEFAULT 0"))
                conn.commit()
            if "structure_card_visible" not in existing_columns:
                conn.execute(text("ALTER TABLE dictation_card ADD COLUMN structure_card_visible INTEGER DEFAULT 0"))
                conn.commit()
    # 迁移：text_annotation 表添加 text_content 列
    if "text_annotation" in inspector.get_table_names():
        existing_columns = [c["name"] for c in inspector.get_columns("text_annotation")]
        with engine.connect() as conn:
            if "text_content" not in existing_columns:
                conn.execute(text("ALTER TABLE text_annotation ADD COLUMN text_content TEXT"))
                conn.commit()
    # 迁移：vocabulary 表添加 pos / past_tense / past_participle 列
    if "vocabulary" in inspector.get_table_names():
        existing_columns = [c["name"] for c in inspector.get_columns("vocabulary")]
        with engine.connect() as conn:
            if "pos" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN pos VARCHAR(50)"))
                conn.commit()
            if "past_tense" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN past_tense VARCHAR(100)"))
                conn.commit()
            if "past_participle" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN past_participle VARCHAR(100)"))
                conn.commit()

    # 迁移：用户数据隔离 - 添加 user_id 列并将现有数据归属 admin
    if "users" in inspector.get_table_names():
        existing_columns = [c["name"] for c in inspector.get_columns("users")]
        with engine.connect() as conn:
            if "deepseek_api_key" not in existing_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN deepseek_api_key VARCHAR(200)"))
                conn.commit()

    for table_name in ["dictation", "vocabulary", "clipboard"]:
        if table_name in inspector.get_table_names():
            existing_columns = [c["name"] for c in inspector.get_columns(table_name)]
            with engine.connect() as conn:
                if "user_id" not in existing_columns:
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN user_id INTEGER"))
                    conn.commit()
                # 将现有数据归属 admin（user_id=1）
                conn.execute(text(f"UPDATE {table_name} SET user_id = 1 WHERE user_id IS NULL"))
                conn.commit()

    # 迁移：vocabulary 唯一约束从 word 改为 (user_id, word)
    if "vocabulary" in inspector.get_table_names():
        with engine.connect() as conn:
            try:
                conn.execute(text("ALTER TABLE vocabulary DROP CONSTRAINT IF EXISTS uq_vocabulary_word"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE vocabulary DROP CONSTRAINT IF EXISTS uq_vocabulary_user_word"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE vocabulary ADD CONSTRAINT uq_vocabulary_user_word UNIQUE (user_id, word)"))
                conn.commit()
            except Exception:
                pass

    # 迁移：clipboard 唯一约束（user_id）
    if "clipboard" in inspector.get_table_names():
        with engine.connect() as conn:
            try:
                conn.execute(text("ALTER TABLE clipboard DROP CONSTRAINT IF EXISTS clipboard_user_id_key"))
                conn.commit()
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE clipboard ADD CONSTRAINT clipboard_user_id_key UNIQUE (user_id)"))
                conn.commit()
            except Exception:
                pass

    # 迁移：vocabulary 表添加复习相关字段
    if "vocabulary" in inspector.get_table_names():
        existing_columns = [c["name"] for c in inspector.get_columns("vocabulary")]
        with engine.connect() as conn:
            if "next_review_at" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN next_review_at TIMESTAMP"))
                conn.commit()
            if "review_count" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN review_count INTEGER DEFAULT 0"))
                conn.commit()
            if "mastery_level" not in existing_columns:
                conn.execute(text("ALTER TABLE vocabulary ADD COLUMN mastery_level INTEGER DEFAULT 0"))
                conn.commit()
            # 已有生词设置首次复习时间（1天后）
            conn.execute(text("UPDATE vocabulary SET next_review_at = NOW() + INTERVAL '1 day' WHERE next_review_at IS NULL"))
            conn.commit()

    # 初始化默认管理员账号（如果 users 表为空）
    from app import models
    db = SessionLocal()
    try:
        if db.query(models.User).count() == 0:
            admin = models.User(
                username="admin",
                display_name="管理员",
                role="admin",
            )
            admin.set_password("admin123")
            db.add(admin)
            db.commit()
            print("已创建默认管理员账号: admin / admin123")
    finally:
        db.close()

    yield


app = FastAPI(title="Xictation 精听工具", lifespan=lifespan)

# 仅开发/测试环境禁用缓存
if os.getenv("ENVIRONMENT") != "production":
    @app.middleware("http")
    async def no_cache_middleware(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


# 静态文件
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# 注册路由
app.include_router(auth.router)
app.include_router(dictations.router)
app.include_router(vocabulary.router)
app.include_router(api.router)
app.include_router(practice.router)


@app.middleware("http")
async def inject_current_user(request: Request, call_next):
    """为所有模板注入当前登录用户"""
    user_id = get_current_user_id(request)
    if user_id:
        db = SessionLocal()
        try:
            from app import models
            user = db.query(models.User).filter_by(id=user_id).first()
            request.state.current_user = user
        finally:
            db.close()
    else:
        request.state.current_user = None
    response = await call_next(request)
    return response


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """首页：未登录跳转登录页，已登录跳转听写列表"""
    from fastapi.responses import RedirectResponse
    user_id = get_current_user_id(request)
    if not user_id:
        return RedirectResponse(url="/login", status_code=303)
    return RedirectResponse(url="/dictations", status_code=303)
