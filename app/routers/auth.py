"""认证与用户管理路由"""
from fastapi import APIRouter, Request, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from app.database import get_db
from app.templating import templates
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app import models
from app.auth import (
    set_session, clear_session, get_current_user_id, SESSION_COOKIE_NAME,
    validate_password,
)
from app.deepseek import DeepSeekError

router = APIRouter()


# -------------------- 依赖：获取当前用户 --------------------

def require_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    """要求用户已登录，否则重定向到登录页"""
    user_id = get_current_user_id(request)
    if not user_id:
        # 如果是 API 请求返回 401，否则重定向
        accept = request.headers.get("accept", "")
        if "application/json" in accept:
            raise HTTPException(status_code=401, detail="未登录")
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/login"},
        )
    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/login"},
        )
    return user


def require_admin(request: Request, db: Session = Depends(get_db)) -> models.User:
    """要求管理员登录"""
    user = require_user(request, db)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# -------------------- 页面路由 --------------------

@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """登录页"""
    # 已登录则跳转首页
    user_id = get_current_user_id(request)
    if user_id:
        return RedirectResponse(url="/dictations", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


@router.post("/login")
async def login_submit(request: Request, db: Session = Depends(get_db)):
    """登录提交"""
    form = await request.form()
    username = form.get("username", "").strip()
    password = form.get("password", "")

    user = db.query(models.User).filter_by(username=username).first()
    if not user or not user.check_password(password):
        return templates.TemplateResponse("login.html", {
            "request": request, "error": "用户名或密码错误", "username": username
        })

    response = RedirectResponse(url="/dictations", status_code=303)
    set_session(request, response, user.id)
    return response


@router.get("/logout")
async def logout(request: Request):
    """登出"""
    response = RedirectResponse(url="/login", status_code=303)
    clear_session(response)
    return response


@router.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request, db: Session = Depends(get_db)):
    """个人设置页"""
    user = require_user(request, db)
    return templates.TemplateResponse("profile.html", {
        "request": request, "current_user": user
    })


@router.get("/users", response_class=HTMLResponse)
async def user_list_page(request: Request, db: Session = Depends(get_db)):
    """用户管理页（仅管理员）"""
    user = require_admin(request, db)
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return templates.TemplateResponse("users.html", {
        "request": request, "current_user": user, "users": users
    })


@router.get("/api-settings", response_class=HTMLResponse)
async def api_settings_page(request: Request, db: Session = Depends(get_db)):
    """DeepSeek API 设置页"""
    user = require_user(request, db)
    return templates.TemplateResponse("api_settings.html", {
        "request": request, "current_user": user, "active_tab": "api_settings"
    })


# -------------------- API：DeepSeek Key 管理 --------------------

class UpdateApiKeyPayload(BaseModel):
    api_key: Optional[str] = None

@router.get("/api/user/api-key")
async def get_api_key(request: Request, db: Session = Depends(get_db)):
    """获取当前用户的 API Key 状态"""
    user = require_user(request, db)
    return {
        "has_key": bool(user.deepseek_api_key),
        "masked": _mask_key(user.deepseek_api_key) if user.deepseek_api_key else "",
    }

@router.put("/api/user/api-key")
async def update_api_key(request: Request, payload: UpdateApiKeyPayload, db: Session = Depends(get_db)):
    """更新当前用户的 API Key"""
    user = require_user(request, db)
    api_key = (payload.api_key or "").strip()
    if not api_key:
        return JSONResponse(status_code=400, content={"error": "API Key 不能为空"})
    user.deepseek_api_key = api_key
    db.commit()
    return {"message": "已保存", "masked": _mask_key(api_key)}

@router.delete("/api/user/api-key")
async def clear_api_key(request: Request, db: Session = Depends(get_db)):
    """清除当前用户的 API Key"""
    user = require_user(request, db)
    user.deepseek_api_key = None
    db.commit()
    return {"message": "已清除"}


def _mask_key(key: str) -> str:
    """对 API Key 做脱敏展示"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "*" * (len(key) - 8) + key[-4:]


# -------------------- API：个人信息修改 --------------------

class UpdateProfilePayload(BaseModel):
    display_name: Optional[str] = None
    username: Optional[str] = None
    new_password: Optional[str] = None
    confirm_password: Optional[str] = None

@router.put("/api/profile")
async def update_profile(request: Request, payload: UpdateProfilePayload, db: Session = Depends(get_db)):
    """用户修改自己的信息"""
    user = require_user(request, db)
    data = payload.model_dump()

    if "display_name" in data and data["display_name"] is not None:
        user.display_name = data["display_name"].strip()

    if "username" in data and data["username"] is not None:
        new_username = data["username"].strip()
        if new_username != user.username:
            existing = db.query(models.User).filter_by(username=new_username).first()
            if existing:
                return JSONResponse(
                    status_code=400,
                    content={"error": "账号已存在"}
                )
            user.username = new_username

    if data.get("new_password"):
        if data["new_password"] != data.get("confirm_password"):
            return JSONResponse(
                status_code=400,
                content={"error": "两次输入的密码不一致"}
            )
        ok, msg = validate_password(data["new_password"])
        if not ok:
            return JSONResponse(status_code=400, content={"error": msg})
        user.set_password(data["new_password"])

    db.commit()
    return {"message": "已更新"}


# -------------------- API：用户管理（管理员） --------------------

class CreateUserPayload(BaseModel):
    username: str
    display_name: str
    password: str
    confirm_password: str
    role: str = "user"

@router.post("/api/users")
async def create_user(request: Request, payload: CreateUserPayload, db: Session = Depends(get_db)):
    """管理员创建用户"""
    require_admin(request, db)

    if not payload.username.strip() or not payload.password:
        return JSONResponse(status_code=400, content={"error": "账号和密码不能为空"})

    if payload.password != payload.confirm_password:
        return JSONResponse(status_code=400, content={"error": "两次输入的密码不一致"})

    ok, msg = validate_password(payload.password)
    if not ok:
        return JSONResponse(status_code=400, content={"error": msg})

    if db.query(models.User).filter_by(username=payload.username.strip()).first():
        return JSONResponse(status_code=400, content={"error": "账号已存在"})

    if payload.role not in ("user", "admin"):
        return JSONResponse(status_code=400, content={"error": "无效的角色"})

    user = models.User(
        username=payload.username.strip(),
        display_name=payload.display_name.strip() or payload.username.strip(),
        role=payload.role,
    )
    user.set_password(payload.password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user.to_dict()


@router.get("/api/users")
async def list_users(request: Request, db: Session = Depends(get_db)):
    """管理员获取用户列表"""
    require_admin(request, db)
    users = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [u.to_dict() for u in users]


class UpdateUserPayload(BaseModel):
    display_name: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    confirm_password: Optional[str] = None
    role: Optional[str] = None

@router.put("/api/users/{user_id}")
async def update_user(user_id: int, request: Request, payload: UpdateUserPayload, db: Session = Depends(get_db)):
    """管理员修改用户"""
    require_admin(request, db)

    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        return JSONResponse(status_code=404, content={"error": "用户不存在"})

    data = payload.model_dump()

    if data.get("display_name") is not None:
        user.display_name = data["display_name"].strip()

    if data.get("username") is not None:
        new_username = data["username"].strip()
        if new_username != user.username:
            existing = db.query(models.User).filter_by(username=new_username).first()
            if existing:
                return JSONResponse(status_code=400, content={"error": "账号已存在"})
            user.username = new_username

    if data.get("role") is not None:
        if data["role"] not in ("user", "admin"):
            return JSONResponse(status_code=400, content={"error": "无效的角色"})
        user.role = data["role"]

    if data.get("password"):
        if data["password"] != data.get("confirm_password"):
            return JSONResponse(status_code=400, content={"error": "两次输入的密码不一致"})
        ok, msg = validate_password(data["password"])
        if not ok:
            return JSONResponse(status_code=400, content={"error": msg})
        user.set_password(data["password"])

    db.commit()
    return {"message": "已更新"}


@router.delete("/api/users/{user_id}")
async def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    """管理员删除用户"""
    current = require_admin(request, db)

    user = db.query(models.User).filter_by(id=user_id).first()
    if not user:
        return JSONResponse(status_code=404, content={"error": "用户不存在"})

    if user.id == current.id:
        return JSONResponse(status_code=400, content={"error": "不能删除自己"})

    db.delete(user)
    db.commit()
    return {"message": "已删除"}
