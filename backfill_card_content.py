"""回填 vocabulary.sources 中的 card_content 字段

为已存在但没有 card_content 的来源记录，补充卡片内容前 30 字
"""
from app.database import SessionLocal
from app import models
from sqlalchemy.orm.attributes import flag_modified

db = SessionLocal()
try:
    vocabs = db.query(models.Vocabulary).all()
    print(f"处理 {len(vocabs)} 个生词")
    updated = 0

    # 预加载所有卡片
    cards_map = {c.id: c for c in db.query(models.DictationCard).all()}

    for v in vocabs:
        sources = v.sources
        if not isinstance(sources, dict):
            continue
        changed = False
        for cat in ["cannot_read", "cannot_understand"]:
            lst = sources.get(cat, [])
            if not isinstance(lst, list):
                continue
            for s in lst:
                if not isinstance(s, dict):
                    continue
                if "card_content" not in s and s.get("card_id"):
                    card = cards_map.get(s["card_id"])
                    if card:
                        s["card_content"] = (card.content or "")[:30]
                        changed = True
        if changed:
            v.sources = sources
            flag_modified(v, "sources")
            updated += 1

    db.commit()
    print(f"已更新 {updated} 个生词的 sources")
finally:
    db.close()
