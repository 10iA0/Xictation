"""页面路由：听写列表、详情页、生词"""
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app import models
from app.templating import templates
from app.auth import get_current_user_id

router = APIRouter()


def get_current_user(request: Request, db: Session) -> models.User | None:
    """从请求中获取当前用户，未登录返回 None"""
    user_id = get_current_user_id(request)
    if not user_id:
        return None
    return db.query(models.User).filter_by(id=user_id).first()


def require_login(request: Request, db: Session) -> models.User:
    """要求登录，否则抛出重定向异常"""
    user = get_current_user(request, db)
    if not user:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return user


@router.get("/dictations", response_class=HTMLResponse)
async def dictation_list(request: Request, q: Optional[str] = None, db: Session = Depends(get_db)):
    """听写列表页"""
    user = require_login(request, db)
    query = db.query(models.Dictation).filter(models.Dictation.user_id == user.id)
    if q:
        # 搜索标题、内容、标签
        query = query.filter(
            (models.Dictation.title.ilike(f"%{q}%")) |
            (models.Dictation.cards.any(models.DictationCard.content.ilike(f"%{q}%"))) |
            (models.Dictation.tags.any(models.Dictation.tag.has(models.Tag.name.ilike(f"%{q}%"))))
        )
    dictations = query.order_by(models.Dictation.order.asc()).all()
    return templates.TemplateResponse("dictation_list.html", {
        "request": request, "dictations": dictations, "q": q or "",
        "current_user": user, "active_tab": "dictations"
    })


@router.get("/dictations/new", response_class=HTMLResponse)
async def dictation_new(request: Request, db: Session = Depends(get_db)):
    """新建听写页"""
    user = require_login(request, db)
    return templates.TemplateResponse("dictation_detail.html", {
        "request": request, "dictation": None, "current_user": user
    })


@router.get("/dictations/{dictation_id}", response_class=HTMLResponse)
async def dictation_detail(request: Request, dictation_id: int, db: Session = Depends(get_db)):
    """听写详情页"""
    user = require_login(request, db)
    dictation = db.query(models.Dictation).filter(
        models.Dictation.id == dictation_id,
        models.Dictation.user_id == user.id,
    ).first()
    if not dictation:
        raise HTTPException(status_code=404, detail="听写记录不存在")
    return templates.TemplateResponse("dictation_detail.html", {
        "request": request, "dictation": dictation, "current_user": user
    })


@router.get("/vocabulary", response_class=HTMLResponse)
async def vocabulary_list(request: Request, q: Optional[str] = None, sort: str = "time", db: Session = Depends(get_db)):
    """生词本页"""
    user = require_login(request, db)
    query = db.query(models.Vocabulary).filter(models.Vocabulary.user_id == user.id)
    if q:
        query = query.filter(
            (models.Vocabulary.word.ilike(f"%{q}%")) |
            (models.Vocabulary.phonetic.ilike(f"%{q}%")) |
            (models.Vocabulary.translation.ilike(f"%{q}%"))
        )
    if sort == "alpha":
        words = query.order_by(models.Vocabulary.word.asc()).all()
    else:
        words = query.order_by(models.Vocabulary.created_at.desc()).all()

    # 为每个 word 的 sources 计算 card_index（在 dictation 中的实际位置）
    if words:
        # 收集所有 dictation_id
        dictation_ids = set()
        for w in words:
            src = w.sources if isinstance(w.sources, dict) else {}
            for cat in ("cannot_read", "cannot_understand", "cannot_hear"):
                for s in (src.get(cat) or []):
                    if isinstance(s, dict) and s.get("dictation_id"):
                        dictation_ids.add(s["dictation_id"])
        # 一次性查出这些 dictation 的卡片（按 card_order 排序）
        card_index_map = {}  # {dictation_id: {card_id: index}}
        if dictation_ids:
            cards = db.query(models.DictationCard).filter(
                models.DictationCard.dictation_id.in_(dictation_ids)
            ).order_by(
                models.DictationCard.dictation_id.asc(),
                models.DictationCard.card_order.asc(),
                models.DictationCard.id.asc(),
            ).all()
            for c in cards:
                m = card_index_map.setdefault(c.dictation_id, {})
                m[c.id] = len(m) + 1
        # 给每个 word 的 source 加上 card_index
        for w in words:
            src = w.sources if isinstance(w.sources, dict) else {}
            for cat in ("cannot_read", "cannot_understand", "cannot_hear"):
                lst = src.get(cat) or []
                for s in lst:
                    if isinstance(s, dict) and s.get("card_id") and s.get("dictation_id"):
                        s["card_index"] = card_index_map.get(s["dictation_id"], {}).get(s["card_id"], 0)

    return templates.TemplateResponse("vocabulary.html", {
        "request": request, "words": words, "q": q or "", "sort": sort,
        "current_user": user, "active_tab": "vocabulary"
    })
