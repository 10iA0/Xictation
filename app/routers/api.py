"""API 路由：CRUD 操作"""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_db
from app import models
from sqlalchemy import func

router = APIRouter(prefix="/api")


# ========== Pydantic 模型 ==========
class TagCreate(BaseModel):
    name: str


class DictationCreate(BaseModel):
    title: str
    audio_source: Optional[str] = None
    tags: List[str] = []


class DictationCardCreate(BaseModel):
    content: str


class DictationCardUpdate(BaseModel):
    content: Optional[str] = None
    correct_content: Optional[str] = None
    translation: Optional[str] = None
    analysis: Optional[str] = None


class CardReorder(BaseModel):
    card_ids: List[int]


class DictationReorder(BaseModel):
    dictation_ids: List[int]


class AnnotationCreate(BaseModel):
    field: str  # content / correct_content
    start_offset: int
    end_offset: int
    annotation_type: str  # highlight/color/liaison/weak/burst
    annotation_value: Optional[str] = None


class AnalysisRecordCreate(BaseModel):
    category: str  # cannot_understand / cannot_hear
    content: str


class AnalysisRecordUpdate(BaseModel):
    content: str


class VocabularyCreate(BaseModel):
    word: str
    phonetic: Optional[str] = None
    translation: Optional[str] = None
    notes: Optional[str] = None
    labels: Optional[List[str]] = None
    category: Optional[str] = None  # cannot_read / cannot_understand
    source_dictation_id: Optional[int] = None
    source_card_id: Optional[int] = None


class VocabularyUpdate(BaseModel):
    word: Optional[str] = None
    phonetic: Optional[str] = None
    translation: Optional[str] = None
    notes: Optional[str] = None
    labels: Optional[List[str]] = None
    card_id: Optional[int] = None
    categories: Optional[List[str]] = None  # 勾选的分类列表


class VocabSourceRemove(BaseModel):
    card_id: int
    category: str  # cannot_read / cannot_understand


# ========== 听写记录 ==========
@router.post("/dictations")
def create_dictation(payload: DictationCreate, db: Session = Depends(get_db)):
    # 新听写自动追加到列表末尾
    max_order = db.query(func.max(models.Dictation.order)).scalar()
    order = (max_order if max_order is not None else -1) + 1

    dictation = models.Dictation(title=payload.title, audio_source=payload.audio_source, order=order)
    db.add(dictation)
    db.flush()

    # 处理标签
    for tag_name in payload.tags:
        tag_name = tag_name.strip()
        if not tag_name:
            continue
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if not tag:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        db.add(models.DictationTag(dictation_id=dictation.id, tag_id=tag.id))

    db.commit()
    return {"id": dictation.id}


@router.put("/dictations/reorder")
def reorder_dictations(payload: DictationReorder, db: Session = Depends(get_db)):
    for order, dictation_id in enumerate(payload.dictation_ids):
        d = db.query(models.Dictation).filter(models.Dictation.id == dictation_id).first()
        if d:
            d.order = order
    db.commit()
    return {"ok": True}


@router.put("/dictations/{dictation_id}")
def update_dictation(dictation_id: int, payload: DictationCreate, db: Session = Depends(get_db)):
    dictation = db.query(models.Dictation).filter(models.Dictation.id == dictation_id).first()
    if not dictation:
        raise HTTPException(404, "听写记录不存在")

    dictation.title = payload.title
    dictation.audio_source = payload.audio_source

    # 更新标签：先删后增
    db.query(models.DictationTag).filter(models.DictationTag.dictation_id == dictation_id).delete()
    for tag_name in payload.tags:
        tag_name = tag_name.strip()
        if not tag_name:
            continue
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if not tag:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        db.add(models.DictationTag(dictation_id=dictation.id, tag_id=tag.id))

    db.commit()
    return {"id": dictation.id}


@router.delete("/dictations/{dictation_id}")
def delete_dictation(dictation_id: int, db: Session = Depends(get_db)):
    dictation = db.query(models.Dictation).filter(models.Dictation.id == dictation_id).first()
    if not dictation:
        raise HTTPException(404, "听写记录不存在")

    # 清理与此听写关联的生词来源
    from sqlalchemy.orm.attributes import flag_modified
    all_vocabs = db.query(models.Vocabulary).all()
    for v in all_vocabs:
        if not v.sources or not isinstance(v.sources, dict):
            continue
        changed = False
        for cat in ["cannot_read", "cannot_understand"]:
            cat_list = v.sources.get(cat, [])
            new_list = [s for s in cat_list if s.get("dictation_id") != dictation_id]
            if len(new_list) != len(cat_list):
                v.sources[cat] = new_list
                changed = True
        if changed:
            flag_modified(v, "sources")
            # 更新 labels
            labels = []
            if v.sources.get("cannot_read"):
                labels.append("cannot_read")
            if v.sources.get("cannot_understand"):
                labels.append("cannot_understand")
            v.labels = labels
            flag_modified(v, "labels")
            # 两类来源都空则删除
            if not v.sources.get("cannot_read") and not v.sources.get("cannot_understand"):
                db.delete(v)

    db.delete(dictation)
    db.commit()
    return {"ok": True}


# ========== 听写卡片 ==========
@router.post("/dictations/{dictation_id}/cards")
def create_card(dictation_id: int, payload: DictationCardCreate, db: Session = Depends(get_db)):
    # 计算顺序
    max_order = db.query(models.DictationCard).filter(
        models.DictationCard.dictation_id == dictation_id
    ).count()

    card = models.DictationCard(
        dictation_id=dictation_id,
        content=payload.content,
        card_order=max_order
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return {"id": card.id}


@router.put("/cards/{card_id}")
def update_card(card_id: int, payload: DictationCardUpdate, db: Session = Depends(get_db)):
    card = db.query(models.DictationCard).filter(models.DictationCard.id == card_id).first()
    if not card:
        raise HTTPException(404, "卡片不存在")

    if payload.content is not None:
        card.content = payload.content
    if payload.correct_content is not None:
        card.correct_content = payload.correct_content
    if payload.translation is not None:
        card.translation = payload.translation
    if payload.analysis is not None:
        card.analysis = payload.analysis

    db.commit()
    return {"ok": True}


@router.post("/cards/{card_id}/translate")
def translate_card(card_id: int, db: Session = Depends(get_db)):
    """调用 DeepSeek 翻译正确内容为中文"""
    card = db.query(models.DictationCard).filter(models.DictationCard.id == card_id).first()
    if not card:
        raise HTTPException(404, "卡片不存在")
    text = (card.correct_content or "").strip()
    if not text:
        raise HTTPException(400, "正确内容为空，无法翻译")
    from app.deepseek import translate_text
    translation = translate_text(text)
    if not translation:
        raise HTTPException(500, "翻译失败")
    return {"translation": translation}


@router.delete("/cards/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(models.DictationCard).filter(models.DictationCard.id == card_id).first()
    if not card:
        raise HTTPException(404, "卡片不存在")
    db.delete(card)
    db.commit()
    return {"ok": True}


@router.put("/dictations/{dictation_id}/cards/reorder")
def reorder_cards(dictation_id: int, payload: CardReorder, db: Session = Depends(get_db)):
    for order, card_id in enumerate(payload.card_ids):
        card = db.query(models.DictationCard).filter(models.DictationCard.id == card_id).first()
        if card and card.dictation_id == dictation_id:
            card.card_order = order
    db.commit()
    return {"ok": True}


# ========== 文本标注 ==========
@router.post("/cards/{card_id}/annotations")
def create_annotation(card_id: int, payload: AnnotationCreate, db: Session = Depends(get_db)):
    # 还原颜色：字体=#000000 或 背景=transparent 时，删除该范围内同类型的已有标注，不新建
    is_reset = (
        (payload.annotation_type == "font_color" and payload.annotation_value == "#000000")
        or (payload.annotation_type == "bg_color" and payload.annotation_value == "transparent")
    )
    if is_reset:
        overlapping = db.query(models.TextAnnotation).filter(
            models.TextAnnotation.card_id == card_id,
            models.TextAnnotation.field == payload.field,
            models.TextAnnotation.annotation_type == payload.annotation_type,
            models.TextAnnotation.start_offset < payload.end_offset,
            models.TextAnnotation.end_offset > payload.start_offset,
        ).all()
        for a in overlapping:
            db.delete(a)
        db.commit()
        return {"id": None, "reset": True}

    annotation = models.TextAnnotation(
        card_id=card_id,
        field=payload.field,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        annotation_type=payload.annotation_type,
        annotation_value=payload.annotation_value
    )
    db.add(annotation)
    db.commit()
    db.refresh(annotation)
    return {"id": annotation.id}


@router.get("/cards/{card_id}/annotations")
def get_annotations(card_id: int, db: Session = Depends(get_db)):
    annotations = db.query(models.TextAnnotation).filter(
        models.TextAnnotation.card_id == card_id
    ).order_by(models.TextAnnotation.start_offset).all()
    return {
        "annotations": [
            {
                "id": a.id,
                "field": a.field,
                "start_offset": a.start_offset,
                "end_offset": a.end_offset,
                "annotation_type": a.annotation_type,
                "annotation_value": a.annotation_value,
            }
            for a in annotations
        ]
    }


@router.delete("/annotations/{annotation_id}")
def delete_annotation(annotation_id: int, db: Session = Depends(get_db)):
    annotation = db.query(models.TextAnnotation).filter(models.TextAnnotation.id == annotation_id).first()
    if not annotation:
        raise HTTPException(404, "标注不存在")
    db.delete(annotation)
    db.commit()
    return {"ok": True}


# ========== 分析卡片 ==========
@router.post("/cards/{card_id}/analysis")
def create_analysis_card(card_id: int, db: Session = Depends(get_db)):
    # 若已存在则返回已有的
    existing = db.query(models.AnalysisCard).filter(models.AnalysisCard.card_id == card_id).first()
    if existing:
        return {"id": existing.id}

    analysis = models.AnalysisCard(card_id=card_id)
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return {"id": analysis.id}


@router.delete("/cards/{card_id}/analysis")
def delete_analysis_card(card_id: int, db: Session = Depends(get_db)):
    analysis = db.query(models.AnalysisCard).filter(models.AnalysisCard.card_id == card_id).first()
    if not analysis:
        raise HTTPException(404, "分析卡片不存在")
    db.delete(analysis)

    # 清理与此卡片关联的生词来源
    from sqlalchemy.orm.attributes import flag_modified
    all_vocabs = db.query(models.Vocabulary).all()
    for v in all_vocabs:
        if not v.sources or not isinstance(v.sources, dict):
            continue
        changed = False
        for cat in ["cannot_read", "cannot_understand"]:
            cat_list = v.sources.get(cat, [])
            new_list = [s for s in cat_list if s.get("card_id") != card_id]
            if len(new_list) != len(cat_list):
                v.sources[cat] = new_list
                changed = True
        if changed:
            flag_modified(v, "sources")
            # 更新 labels
            labels = []
            if v.sources.get("cannot_read"):
                labels.append("cannot_read")
            if v.sources.get("cannot_understand"):
                labels.append("cannot_understand")
            v.labels = labels
            flag_modified(v, "labels")
            # 两类来源都空则删除
            if not v.sources.get("cannot_read") and not v.sources.get("cannot_understand"):
                db.delete(v)

    db.commit()
    return {"ok": True}


@router.post("/analysis/{analysis_card_id}/records")
def create_analysis_record(analysis_card_id: int, payload: AnalysisRecordCreate, db: Session = Depends(get_db)):
    record = models.AnalysisRecord(
        analysis_card_id=analysis_card_id,
        category=payload.category,
        content=payload.content
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"id": record.id}


@router.delete("/analysis/records/{record_id}")
def delete_analysis_record(record_id: int, db: Session = Depends(get_db)):
    record = db.query(models.AnalysisRecord).filter(models.AnalysisRecord.id == record_id).first()
    if not record:
        raise HTTPException(404, "记录不存在")
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.put("/analysis/records/{record_id}")
def update_analysis_record(record_id: int, payload: AnalysisRecordUpdate, db: Session = Depends(get_db)):
    record = db.query(models.AnalysisRecord).filter(models.AnalysisRecord.id == record_id).first()
    if not record:
        raise HTTPException(404, "记录不存在")
    record.content = payload.content
    db.commit()
    return {"ok": True}


# ========== 生词本 ==========
@router.get("/vocabulary/lookup")
def lookup_word(word: str):
    """调用 DeepSeek API 查询单词音标和翻译"""
    from app.deepseek import lookup_word as ds_lookup
    word = word.strip()
    if not word:
        return {"phonetic": "", "translation": ""}
    return ds_lookup(word)


@router.get("/vocabulary/search")
def search_vocabulary(word: str, db: Session = Depends(get_db)):
    """按单词精确搜索（去重用）"""
    word = word.strip()
    if not word:
        return {"found": False}
    existing = db.query(models.Vocabulary).filter(models.Vocabulary.word == word).first()
    if not existing:
        return {"found": False}
    return {
        "found": True,
        "id": existing.id,
        "word": existing.word,
        "phonetic": existing.phonetic or "",
        "translation": existing.translation or "",
        "notes": existing.notes or "",
        "labels": existing.labels or [],
    }


@router.post("/vocabulary")
def create_vocabulary(payload: VocabularyCreate, db: Session = Depends(get_db)):
    """添加生词（按 word 去重：若已存在则将来源添加到对应分类）"""
    word_str = payload.word.strip()
    category = payload.category or "cannot_read"

    existing = db.query(models.Vocabulary).filter(models.Vocabulary.word == word_str).first()

    # 构建来源信息
    source_entry = {}
    if payload.source_dictation_id:
        dictation = db.query(models.Dictation).filter(models.Dictation.id == payload.source_dictation_id).first()
        source_entry = {
            "dictation_id": payload.source_dictation_id,
            "dictation_title": dictation.title if dictation else "",
            "card_id": payload.source_card_id,
        }

    if existing:
        # 更新音标/翻译/备注
        if payload.phonetic:
            existing.phonetic = payload.phonetic
        if payload.translation:
            existing.translation = payload.translation
        if payload.notes:
            existing.notes = payload.notes
        # 将来源添加到对应分类
        if source_entry:
            sources = existing.sources or {}
            if not isinstance(sources, dict):
                sources = {"cannot_read": [], "cannot_understand": []}
            cat_list = sources.get(category, [])
            already = any(
                s.get("card_id") == source_entry.get("card_id")
                for s in cat_list
            )
            if not already:
                cat_list.append(source_entry)
                sources[category] = cat_list
                existing.sources = sources
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(existing, "sources")
        # 更新 labels：优先使用 payload.labels，否则 add category
        if payload.labels:
            labels = set(existing.labels or [])
            labels.update(payload.labels)
        else:
            labels = set(existing.labels or [])
            labels.add(category)
        existing.labels = list(labels)
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(existing, "labels")
        db.commit()
        db.refresh(existing)
        return {"id": existing.id, "merged": True}
    else:
        sources = {"cannot_read": [], "cannot_understand": []}
        if source_entry:
            sources[category] = [source_entry]
        word = models.Vocabulary(
            word=word_str,
            phonetic=payload.phonetic,
            translation=payload.translation,
            notes=payload.notes,
            labels=payload.labels if payload.labels else [category],
            source_dictation_id=payload.source_dictation_id,
            source_card_id=payload.source_card_id,
            sources=sources,
        )
        db.add(word)
        db.commit()
        db.refresh(word)
        return {"id": word.id, "merged": False}


@router.put("/vocabulary/{word_id}")
def update_vocabulary(word_id: int, payload: VocabularyUpdate, db: Session = Depends(get_db)):
    word = db.query(models.Vocabulary).filter(models.Vocabulary.id == word_id).first()
    if not word:
        raise HTTPException(404, "生词不存在")
    if payload.word is not None:
        word.word = payload.word
    if payload.phonetic is not None:
        word.phonetic = payload.phonetic
    if payload.translation is not None:
        word.translation = payload.translation
    if payload.notes is not None:
        word.notes = payload.notes

    from sqlalchemy.orm.attributes import flag_modified

    # 分析卡片编辑：根据 categories 更新 sources
    if payload.card_id is not None and payload.categories is not None:
        sources = word.sources or {}
        if not isinstance(sources, dict):
            sources = {"cannot_read": [], "cannot_understand": []}

        for cat in ["cannot_read", "cannot_understand"]:
            cat_list = sources.get(cat, [])
            if cat in payload.categories:
                # 确保来源存在
                already = any(s.get("card_id") == payload.card_id for s in cat_list)
                if not already:
                    dictation = db.query(models.Dictation).filter(
                        models.Dictation.id == word.source_dictation_id
                    ).first()
                    cat_list.append({
                        "dictation_id": word.source_dictation_id,
                        "dictation_title": dictation.title if dictation else "",
                        "card_id": payload.card_id,
                    })
            else:
                # 移除该卡片的来源
                cat_list = [s for s in cat_list if s.get("card_id") != payload.card_id]
            sources[cat] = cat_list

        word.sources = sources
        flag_modified(word, "sources")

        # 更新 labels
        labels = []
        if sources.get("cannot_read"):
            labels.append("cannot_read")
        if sources.get("cannot_understand"):
            labels.append("cannot_understand")
        word.labels = labels
        flag_modified(word, "labels")

        # 两类来源都空则删除
        if not sources.get("cannot_read") and not sources.get("cannot_understand"):
            db.delete(word)
            db.commit()
            return {"ok": True, "deleted": True}
    elif payload.labels is not None:
        word.labels = payload.labels

    db.commit()
    return {"ok": True}


@router.delete("/vocabulary/{word_id}/source")
def remove_vocab_source(word_id: int, payload: VocabSourceRemove, db: Session = Depends(get_db)):
    """从指定卡片的指定分类中移除生词来源"""
    word = db.query(models.Vocabulary).filter(models.Vocabulary.id == word_id).first()
    if not word:
        raise HTTPException(404, "生词不存在")

    from sqlalchemy.orm.attributes import flag_modified

    sources = word.sources or {}
    if not isinstance(sources, dict):
        sources = {"cannot_read": [], "cannot_understand": []}

    cat_list = sources.get(payload.category, [])
    cat_list = [s for s in cat_list if s.get("card_id") != payload.card_id]
    sources[payload.category] = cat_list

    word.sources = sources
    flag_modified(word, "sources")

    # 更新 labels
    labels = []
    if sources.get("cannot_read"):
        labels.append("cannot_read")
    if sources.get("cannot_understand"):
        labels.append("cannot_understand")
    word.labels = labels
    flag_modified(word, "labels")

    # 两类来源都空则删除
    if not sources.get("cannot_read") and not sources.get("cannot_understand"):
        db.delete(word)
        db.commit()
        return {"ok": True, "deleted": True}

    db.commit()
    return {"ok": True, "deleted": False}


@router.delete("/vocabulary/{word_id}")
def delete_vocabulary(word_id: int, db: Session = Depends(get_db)):
    word = db.query(models.Vocabulary).filter(models.Vocabulary.id == word_id).first()
    if not word:
        raise HTTPException(404, "生词不存在")
    db.delete(word)
    db.commit()
    return {"ok": True}
