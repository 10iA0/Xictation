"""添加复习相关索引以加速查询"""
from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    # vocabulary 表索引
    # user_id 已有索引，加上 mastery_level 和 next_review_at 复合索引加速过滤
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_vocab_user_next ON vocabulary (user_id, next_review_at)"))
        print("idx_vocab_user_next OK")
    except Exception as e:
        print("idx_vocab_user_next error:", e)
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_vocab_user_mastery ON vocabulary (user_id, mastery_level)"))
        print("idx_vocab_user_mastery OK")
    except Exception as e:
        print("idx_vocab_user_mastery error:", e)
    # review_log 表索引
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_reviewlog_user_date ON review_log (user_id, created_at)"))
        print("idx_reviewlog_user_date OK")
    except Exception as e:
        print("idx_reviewlog_user_date error:", e)
    conn.commit()
print("All indexes done")
