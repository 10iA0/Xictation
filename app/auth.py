"""用户认证与会话管理"""
import os
import re
from datetime import timedelta
from fastapi import Request, HTTPException, status
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

SECRET_KEY = os.getenv("SECRET_KEY", "xictation-secret-key-change-in-production")
SESSION_COOKIE_NAME = "session"
SESSION_MAX_AGE = 7 * 24 * 3600  # 7 天

_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="session")

# 简单密码黑名单
_SIMPLE_PASSWORDS = {
    "Password1!", "Admin123!", "Admin1234", "Qwerty1!", "Abc12345",
    "P@ssw0rd", "Passw0rd!", "Password!", "123456Ab",
}


def validate_password(password: str) -> tuple[bool, str]:
    """校验密码强度：要求大小写字母 + 特殊符号 + 至少 8 位"""
    if not password:
        return False, "密码不能为空"
    if len(password) < 8:
        return False, "密码至少需要 8 个字符"
    if len(password) > 72:
        return False, "密码不能超过 72 个字符"
    if not re.search(r"[A-Z]", password):
        return False, "密码必须包含大写字母"
    if not re.search(r"[a-z]", password):
        return False, "密码必须包含小写字母"
    if not re.search(r"[0-9]", password):
        return False, "密码必须包含数字"
    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?`~]", password):
        return False, "密码必须包含特殊符号（如 !@#$%^&* 等）"
    if password in _SIMPLE_PASSWORDS:
        return False, "密码过于简单，请使用更复杂的密码"
    return True, ""


def create_session_cookie(user_id: int) -> str:
    """创建签名会话 token"""
    return _serializer.dumps({"user_id": user_id})


def verify_session_cookie(token: str) -> int | None:
    """验证会话 token，返回 user_id 或 None"""
    try:
        data = _serializer.loads(token, max_age=SESSION_MAX_AGE)
        return data.get("user_id")
    except (BadSignature, SignatureExpired):
        return None


def set_session(request: Request, response, user_id: int):
    """设置会话 cookie"""
    token = create_session_cookie(user_id)
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
    )


def clear_session(response):
    """清除会话 cookie"""
    response.delete_cookie(SESSION_COOKIE_NAME)


def get_current_user_id(request: Request) -> int | None:
    """从请求中获取当前用户 ID"""
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return verify_session_cookie(token)
