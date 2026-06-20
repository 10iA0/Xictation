"""模板实例（供路由复用）"""
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="app/templates")
