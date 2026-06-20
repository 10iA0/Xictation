"""页面路由：听写列表、详情页、生词本"""
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app import models
from app.templating import templates

router = APIRouter()


@router.get("/dictations", response_class=HTMLResponse)
async def dictation_list(request: Request, q: Optional[str] = None, db: Session = Depends(get_db)):
    """听写列表页"""
    query = db.query(models.Dictation)
    if q:
        # 搜索标题、内容、标签
        query = query.filter(
            (models.Dictation.title.ilike(f"%{q}%")) |
            (models.Dictation.cards.any(models.DictationCard.content.ilike(f"%{q}%"))) |
            (models.Dictation.tags.any(models.Dictation.tag.has(models.Tag.name.ilike(f"%{q}%"))))
        )
    dictations = query.order_by(models.Dictation.order.asc()).all()
    return templates.TemplateResponse("dictation_list.html", {
        "request": request, "dictations": dictations, "q": q or ""
    })


@router.get("/dictations/new", response_class=HTMLResponse)
async def dictation_new(request: Request):
    """新建听写页"""
    return templates.TemplateResponse("dictation_detail.html", {
        "request": request, "dictation": None
    })


@router.get("/dictations/{dictation_id}", response_class=HTMLResponse)
async def dictation_detail(request: Request, dictation_id: int, db: Session = Depends(get_db)):
    """听写详情页"""
    dictation = db.query(models.Dictation).filter(models.Dictation.id == dictation_id).first()
    if not dictation:
        raise HTTPException(status_code=404, detail="听写记录不存在")
    return templates.TemplateResponse("dictation_detail.html", {
        "request": request, "dictation": dictation,
    })


@router.get("/vocabulary", response_class=HTMLResponse)
async def vocabulary_list(request: Request, q: Optional[str] = None, sort: str = "time", db: Session = Depends(get_db)):
    """生词本页"""
    query = db.query(models.Vocabulary)
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
    return templates.TemplateResponse("vocabulary.html", {
        "request": request, "words": words, "q": q or "", "sort": sort
    })
