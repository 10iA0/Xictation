"""数据迁移脚本：
1. Vocabulary.labels 中 "cannot_read" → "cannot_understand"（去重）
2. Vocabulary.sources 中 "cannot_read" 合并到 "cannot_understand"（按 card_id 去重），删除 "cannot_read" 键
3. AnalysisRecord(category="cannot_hear") 转为 Vocabulary（labels=["cannot_hear"]，sources={cannot_hear: [...]}）
"""
from datetime import datetime, timedelta
from app.database import SessionLocal
from app import models
from sqlalchemy.orm.attributes import flag_modified


def migrate_vocabulary_labels(db):
    """迁移 Vocabulary.labels 和 sources 中的 cannot_read → cannot_understand"""
    vocabs = db.query(models.Vocabulary).all()
    print(f"[1/2] 处理 {len(vocabs)} 个生词的 labels/sources")
    updated = 0

    for v in vocabs:
        changed = False

        # 1) labels: cannot_read → cannot_understand（去重）
        old_labels = v.labels or []
        new_labels = []
        for lbl in old_labels:
            if lbl == "cannot_read":
                lbl = "cannot_understand"
            if lbl not in new_labels:
                new_labels.append(lbl)
        if new_labels != list(old_labels):
            v.labels = new_labels
            flag_modified(v, "labels")
            changed = True

        # 2) sources: 合并 cannot_read → cannot_understand（按 card_id 去重）
        src = v.sources
        if isinstance(src, dict) and src.get("cannot_read"):
            understand_list = list(src.get("cannot_understand", []))
            read_list = src.get("cannot_read", [])
            for s in read_list:
                if not isinstance(s, dict):
                    continue
                card_id = s.get("card_id")
                already = any(
                    e.get("card_id") == card_id for e in understand_list if isinstance(e, dict)
                )
                if not already:
                    understand_list.append(s)
            src["cannot_understand"] = understand_list
            del src["cannot_read"]
            v.sources = src
            flag_modified(v, "sources")
            changed = True

        if changed:
            updated += 1

    db.commit()
    print(f"  已更新 {updated} 个生词的 labels/sources")


def migrate_cannot_hear_records(db):
    """将 AnalysisRecord(category='cannot_hear') 转为 Vocabulary"""
    records = db.query(models.AnalysisRecord).filter(
        models.AnalysisRecord.category == "cannot_hear"
    ).all()
    print(f"[2/2] 处理 {len(records)} 个 cannot_hear 分析记录")

    if not records:
        return

    # 预加载卡片 -> (dictation_id, dictation_title, user_id, card_content)
    cards_map = {}
    for r in records:
        ac = r.analysis_card
        if not ac:
            continue
        card = ac.card
        if not card:
            continue
        if card.id not in cards_map:
            dictation = card.dictation
            cards_map[card.id] = {
                "card_id": card.id,
                "dictation_id": dictation.id if dictation else None,
                "dictation_title": dictation.title if dictation else "",
                "user_id": dictation.user_id if dictation else None,
                "card_content": (card.content or "")[:30],
            }

    created = 0
    merged = 0
    skipped = 0
    # 跟踪本次新建的 Vocabulary（同批次去重，避免 unique constraint 冲突）
    new_vocabs = {}  # {(user_id, word): Vocabulary}

    for r in records:
        ac = r.analysis_card
        if not ac:
            skipped += 1
            continue
        card = ac.card
        if not card:
            skipped += 1
            continue
        info = cards_map.get(card.id)
        if not info or not info.get("user_id"):
            skipped += 1
            continue

        word_str = (r.content or "").strip()
        if not word_str:
            skipped += 1
            continue

        user_id = info["user_id"]
        source_entry = {
            "dictation_id": info["dictation_id"],
            "dictation_title": info["dictation_title"],
            "card_id": info["card_id"],
            "card_content": info["card_content"],
        }

        # 查找同一用户下同名单词（先查数据库，再查本批次新建的）
        existing = db.query(models.Vocabulary).filter(
            models.Vocabulary.user_id == user_id,
            models.Vocabulary.word == word_str,
        ).first()
        if not existing:
            existing = new_vocabs.get((user_id, word_str))

        if existing:
            # 合并来源到 cannot_hear
            src = existing.sources or {}
            if not isinstance(src, dict):
                src = {}
            hear_list = list(src.get("cannot_hear", []))
            already = any(
                e.get("card_id") == source_entry["card_id"] for e in hear_list if isinstance(e, dict)
            )
            if not already:
                hear_list.append(source_entry)
                src["cannot_hear"] = hear_list
                existing.sources = src
                flag_modified(existing, "sources")
            # 更新 labels
            labels = list(set(existing.labels or []) | {"cannot_hear"})
            existing.labels = labels
            flag_modified(existing, "labels")
            merged += 1
        else:
            # 新建 Vocabulary
            v = models.Vocabulary(
                word=word_str,
                phonetic=None,
                pos=None,
                past_tense=None,
                past_participle=None,
                translation=None,
                notes=None,
                labels=["cannot_hear"],
                source_dictation_id=info["dictation_id"],
                source_card_id=info["card_id"],
                sources={"cannot_hear": [source_entry]},
                user_id=user_id,
                next_review_at=datetime.utcnow() + timedelta(days=1),
            )
            db.add(v)
            new_vocabs[(user_id, word_str)] = v
            created += 1

    # 删除已迁移的 cannot_hear AnalysisRecord
    for r in records:
        db.delete(r)

    db.commit()
    print(f"  新建 {created} 个生词，合并 {merged} 个已有生词，跳过 {skipped} 个无效记录")


def main():
    db = SessionLocal()
    try:
        migrate_vocabulary_labels(db)
        migrate_cannot_hear_records(db)
        print("\n迁移完成")
    finally:
        db.close()


if __name__ == "__main__":
    main()
