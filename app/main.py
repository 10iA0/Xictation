"""FastAPI 应用主入口"""
import os
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager

from app.database import Base, engine, SessionLocal
from app.routers import dictations, vocabulary, api


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时创建数据库表"""
    Base.metadata.create_all(bind=engine)
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


# 静态文件与模板
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

# 注册路由
app.include_router(dictations.router)
app.include_router(vocabulary.router)
app.include_router(api.router)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """首页：默认跳转听写列表"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dictations")
