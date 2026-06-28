"""复习模块路由"""
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_

from app.database import get_db
from app import models
from app.auth import get_current_user_id
from app.templating import templates

router = APIRouter()


def _current_user(request: Request, db: Session):
    uid = get_current_user_id(request)
    if not uid:
        return None
    return db.query(models.User).filter_by(id=uid).first()


# 艾宾浩斯复习间隔（天）：1, 2, 4, 7, 15, 30
REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]


def get_due_reviews(user_id: int, db: Session):
    """获取到期需要复习的生词"""
    now = datetime.utcnow()
    return db.query(models.Vocabulary).filter(
        models.Vocabulary.user_id == user_id,
        models.Vocabulary.next_review_at != None,
        models.Vocabulary.next_review_at <= now,
    ).order_by(models.Vocabulary.next_review_at).all()


def schedule_next_review(vocab: models.Vocabulary, correct: bool):
    """根据艾宾浩斯曲线安排下次复习"""
    if correct:
        vocab.review_count = (vocab.review_count or 0) + 1
        # 根据复习次数确定间隔等级
        level = min(vocab.review_count - 1, len(REVIEW_INTERVALS) - 1)
        days = REVIEW_INTERVALS[level]
        # 掌握度升级
        if vocab.review_count >= 6:
            vocab.mastery_level = 2  # 已掌握
        elif vocab.review_count >= 2:
            vocab.mastery_level = 1  # 学习中
    else:
        # 答错：重置为1天后复习
        vocab.review_count = 0
        days = 1
        vocab.mastery_level = 0  # 新词
    vocab.next_review_at = datetime.utcnow() + timedelta(days=days)


@router.get("/practice", response_class=HTMLResponse)
def practice_page(request: Request, db: Session = Depends(get_db)):
    """复习首页 - 看板"""
    user = _current_user(request, db)
    if not user:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/login", status_code=303)

    # 待复习生词
    due_reviews = get_due_reviews(user.id, db)

    # 生词掌握度分布
    mastery_stats = db.query(
        models.Vocabulary.mastery_level,
        func.count(models.Vocabulary.id)
    ).filter(
        models.Vocabulary.user_id == user.id
    ).group_by(models.Vocabulary.mastery_level).all()
    mastery_map = {0: 0, 1: 0, 2: 0}
    for level, count in mastery_stats:
        mastery_map[level or 0] = count

    # 复习统计
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = today - timedelta(days=7)
    total_reviews = db.query(models.ReviewLog).filter(
        models.ReviewLog.user_id == user.id
    ).count()
    today_reviews = db.query(models.ReviewLog).filter(
        models.ReviewLog.user_id == user.id,
        models.ReviewLog.created_at >= today
    ).count()
    today_correct = db.query(models.ReviewLog).filter(
        models.ReviewLog.user_id == user.id,
        models.ReviewLog.created_at >= today,
        models.ReviewLog.correct == 1
    ).count()
    week_reviews = db.query(models.ReviewLog).filter(
        models.ReviewLog.user_id == user.id,
        models.ReviewLog.created_at >= week_ago
    ).count()

    # GitHub 贡献图数据 - 按年份返回
    # 获取所有有记录的年份
    all_years = db.query(
        func.extract('year', models.ReviewLog.created_at).label('year')
    ).filter(
        models.ReviewLog.user_id == user.id
    ).distinct().all()
    years = sorted([int(r.year) for r in all_years], reverse=True)
    if not years:
        years = [datetime.utcnow().year]

    # 当前查看年份（默认今年）
    current_year = datetime.utcnow().year
    year_start = datetime(current_year, 1, 1)
    year_end = datetime(current_year + 1, 1, 1)
    daily_reviews = db.query(
        func.date(models.ReviewLog.created_at).label("date"),
        func.count(models.ReviewLog.id).label("count")
    ).filter(
        models.ReviewLog.user_id == user.id,
        models.ReviewLog.created_at >= year_start,
        models.ReviewLog.created_at < year_end
    ).group_by(func.date(models.ReviewLog.created_at)).all()
    daily_map = {str(r.date): int(r.count) for r in daily_reviews}

    # 计算连续学习天数
    streak = 0
    check_date = today
    while True:
        # 需要查所有年份的数据来算连续天数
        key = str(check_date.date())
        day_count = db.query(func.count(models.ReviewLog.id)).filter(
            models.ReviewLog.user_id == user.id,
            func.date(models.ReviewLog.created_at) == check_date.date()
        ).scalar()
        if day_count and day_count > 0:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break

    # 按年份获取贡献数据
    yearly_data = {}
    for y in years:
        ys = datetime(y, 1, 1)
        ye = datetime(y + 1, 1, 1)
        year_data = db.query(
            func.date(models.ReviewLog.created_at).label("date"),
            func.count(models.ReviewLog.id).label("count")
        ).filter(
            models.ReviewLog.user_id == user.id,
            models.ReviewLog.created_at >= ys,
            models.ReviewLog.created_at < ye
        ).group_by(func.date(models.ReviewLog.created_at)).all()
        yearly_data[str(y)] = {str(r.date): int(r.count) for r in year_data}

    return templates.TemplateResponse("practice.html", {
        "request": request,
        "current_user": user,
        "active_tab": "practice",
        "due_reviews": due_reviews,
        "due_count": len(due_reviews),
        "mastery_new": mastery_map[0],
        "mastery_learning": mastery_map[1],
        "mastery_mastered": mastery_map[2],
        "total_reviews": total_reviews,
        "today_reviews": today_reviews,
        "today_correct": today_correct,
        "week_reviews": week_reviews,
        "streak": streak,
        "daily_map": daily_map,
        "years": years,
        "current_year": current_year,
        "yearly_data": yearly_data,
    })


@router.get("/api/practice/due-count")
def get_due_count(request: Request, db: Session = Depends(get_db)):
    """获取待复习生词数量（用于强制复习弹窗）"""
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"due_count": 0})
    due = get_due_reviews(user.id, db)
    return {"due_count": len(due)}


@router.get("/api/practice/vocab-list")
def get_vocab_list(
    request: Request,
    filter: str = "all",
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
):
    """获取生词列表（分页、SQL 过滤、状态在 DB 计算）

    filter: all / due / new / upcoming / mastered
    page: 1-based
    page_size: 默认 10
    """
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"error": "未登录"}, status_code=401)

    now = datetime.utcnow()
    base = db.query(models.Vocabulary).filter(
        models.Vocabulary.user_id == user.id,
        models.Vocabulary.translation != None,
        models.Vocabulary.translation != "",
    )

    # 状态过滤尽量在 SQL 完成
    if filter == "mastered":
        base = base.filter(models.Vocabulary.mastery_level >= 2)
    elif filter == "new":
        base = base.filter(
            (models.Vocabulary.mastery_level == None) | (models.Vocabulary.mastery_level == 0),
            models.Vocabulary.next_review_at == None,
        )
    elif filter == "due":
        base = base.filter(
            models.Vocabulary.next_review_at != None,
            models.Vocabulary.next_review_at <= now,
            or_(models.Vocabulary.mastery_level == None, models.Vocabulary.mastery_level < 2),
        )
    elif filter == "upcoming":
        base = base.filter(
            models.Vocabulary.next_review_at != None,
            models.Vocabulary.next_review_at > now,
            or_(models.Vocabulary.mastery_level == None, models.Vocabulary.mastery_level < 2),
        )

    # 总数（用 SQL COUNT）
    total = base.with_entities(func.count(models.Vocabulary.id)).scalar() or 0

    # 排序：到期未掌握的最前，再按 next_review_at
    if filter == "all":
        # 全部模式：按"已过期最早"优先
        order_cols = [
            models.Vocabulary.next_review_at.is_(None),
            models.Vocabulary.next_review_at.asc(),
            models.Vocabulary.id.desc(),
        ]
    else:
        order_cols = [models.Vocabulary.next_review_at.asc().nulls_last(), models.Vocabulary.id.desc()]

    vocabs = base.order_by(*order_cols) \
        .offset(max(0, (page - 1) * page_size)) \
        .limit(page_size) \
        .all()

    items = []
    for v in vocabs:
        level = v.mastery_level or 0
        if level >= 2:
            status = "mastered"
        elif v.next_review_at is None:
            status = "new"
        elif v.next_review_at <= now:
            status = "due"
        else:
            status = "upcoming"

        if v.next_review_at:
            delta = v.next_review_at - now
            days = delta.days
            hours = delta.seconds // 3600
            if status == "due":
                overdue_str = f"已过期 {-days} 天" if days < 0 else "今天到期"
            else:
                if days > 0:
                    overdue_str = f"还有 {days} 天"
                elif hours > 0:
                    overdue_str = f"还有 {hours} 小时"
                else:
                    overdue_str = "马上到期"
        else:
            overdue_str = "—"

        items.append({
            "id": v.id,
            "word": v.word,
            "phonetic": v.phonetic or "",
            "translation": v.translation,
            "review_count": v.review_count or 0,
            "mastery_level": level,
            "status": status,
            "next_review_at": v.next_review_at.isoformat() if v.next_review_at else None,
            "overdue_str": overdue_str,
        })

    return {
        "items": items,
        "filter": filter,
        "page": page,
        "page_size": page_size,
        "total": int(total),
        "total_pages": (int(total) + page_size - 1) // page_size,
    }


@router.get("/api/practice/session")
def get_practice_session(request: Request, db: Session = Depends(get_db), type: str = "mixed"):
    """获取一组复习题

    每个词包含两题：spelling（拼写）+ matching（选翻译）
    必须两题都答对才算完成一次复习
    """
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"error": "未登录"}, status_code=401)

    # 优先复习到期生词
    due = get_due_reviews(user.id, db)

    # 干扰项池：所有有翻译的生词
    all_vocabs = db.query(models.Vocabulary).filter(
        models.Vocabulary.user_id == user.id,
        models.Vocabulary.translation != None,
        models.Vocabulary.translation != "",
    ).all()

    # 排除已掌握
    all_vocabs = [v for v in all_vocabs if (v.mastery_level or 0) < 2]

    # 复习列表
    import random
    practice_list = list(due)
    remaining = [v for v in all_vocabs if v not in practice_list]
    random.shuffle(remaining)
    if len(practice_list) < 5:
        practice_list.extend(remaining[:5 - len(practice_list)])

    if not practice_list:
        return {"items": []}

    # 为每个词准备拼写题和翻译配对题
    result = []
    for v in practice_list:
        # 干扰项：随机 3 个其他词的翻译
        distractors = random.sample(
            [vv for vv in all_vocabs if vv.id != v.id],
            min(3, len(all_vocabs) - 1)
        )
        result.append({
            "id": v.id,
            "word": v.word,
            "translation": v.translation,
            "phonetic": v.phonetic or "",
            "distractors": [{"id": d.id, "translation": d.translation} for d in distractors],
        })

    return {"items": result, "type": type}


@router.post("/api/practice/submit")
def submit_review(
    request: Request,
    vocab_id: int,
    review_type: str,  # spelling / matching
    correct: bool,
    db: Session = Depends(get_db),
):
    """提交单题结果

    单题提交：记录 review_log，但 review_count / next_review_at 的更新
    由 /api/practice/finish-vocab 端点在该词两题都完成后统一处理
    """
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"error": "未登录"}, status_code=401)

    vocab = db.query(models.Vocabulary).filter(
        models.Vocabulary.id == vocab_id,
        models.Vocabulary.user_id == user.id
    ).first()
    if not vocab:
        return JSONResponse({"error": "生词不存在"}, status_code=404)

    # 仅记录日志，不改变 next_review_at
    log = models.ReviewLog(
        user_id=user.id,
        vocabulary_id=vocab_id,
        review_type=review_type,
        correct=1 if correct else 0,
    )
    db.add(log)
    db.commit()

    return {"ok": True}


@router.post("/api/practice/finish-vocab")
def finish_vocab(
    request: Request,
    vocab_id: int,
    spelling_correct: bool,
    matching_correct: bool,
    db: Session = Depends(get_db),
):
    """一个生词的两题都答完，更新 review_count 和 next_review_at

    两题都答对 → review_count += 1
    任一题答错 → review_count = 0
    """
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"error": "未登录"}, status_code=401)

    vocab = db.query(models.Vocabulary).filter(
        models.Vocabulary.id == vocab_id,
        models.Vocabulary.user_id == user.id
    ).first()
    if not vocab:
        return JSONResponse({"error": "生词不存在"}, status_code=404)

    both_correct = spelling_correct and matching_correct
    schedule_next_review(vocab, both_correct)
    db.commit()

    return {
        "ok": True,
        "both_correct": both_correct,
        "next_review_at": vocab.next_review_at.isoformat() if vocab.next_review_at else None,
        "review_count": vocab.review_count,
        "mastery_level": vocab.mastery_level,
    }


@router.post("/api/practice/master")
def mark_as_mastered(request: Request, vocab_id: int, db: Session = Depends(get_db)):
    """标记为已掌握"""
    user = _current_user(request, db)
    if not user:
        return JSONResponse({"error": "未登录"}, status_code=401)

    vocab = db.query(models.Vocabulary).filter(
        models.Vocabulary.id == vocab_id,
        models.Vocabulary.user_id == user.id
    ).first()
    if not vocab:
        return JSONResponse({"error": "生词不存在"}, status_code=404)

    # 标记为已掌握
    vocab.mastery_level = 2
    vocab.review_count = 6  # 已达到最高级别
    vocab.next_review_at = None  # 不再需要复习
    db.commit()

    return {"ok": True}
