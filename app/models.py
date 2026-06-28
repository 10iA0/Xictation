"""数据库模型定义"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from passlib.context import CryptContext
from app.database import Base

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class User(Base):
    """用户表"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, nullable=False, index=True)  # 登录账号
    display_name = Column(String(120), nullable=False)  # 用户名（显示名）
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), nullable=False, default="user")  # admin / user
    deepseek_api_key = Column(String(200), nullable=True)  # 用户自己的 DeepSeek API Key
    created_at = Column(DateTime, default=datetime.utcnow)

    def set_password(self, password: str):
        self.password_hash = pwd_context.hash(password)

    def check_password(self, password: str) -> bool:
        return pwd_context.verify(password, self.password_hash)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "has_api_key": bool(self.deepseek_api_key),
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M") if self.created_at else None,
        }


class Dictation(Base):
    """听写记录表"""
    __tablename__ = "dictation"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    audio_source = Column(Text, nullable=True)  # URL 或文字描述
    created_at = Column(DateTime, default=datetime.utcnow)
    order = Column(Integer, default=0)  # 列表排序，新创建的追加到末尾
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)  # 所属用户

    cards = relationship("DictationCard", back_populates="dictation", cascade="all, delete-orphan", order_by="DictationCard.card_order")
    tags = relationship("DictationTag", back_populates="dictation", cascade="all, delete-orphan")


class DictationCard(Base):
    """听写卡片表"""
    __tablename__ = "dictation_card"

    id = Column(Integer, primary_key=True, index=True)
    dictation_id = Column(Integer, ForeignKey("dictation.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)  # 用户听写内容
    correct_content = Column(Text, nullable=True)  # 正确内容
    translation = Column(Text, nullable=True)  # 翻译内容
    analysis = Column(Text, nullable=True)  # 分析内容
    card_order = Column(Integer, default=0)
    analysis_card_visible = Column(Integer, default=0)  # 错误卡片是否展开：0=隐藏 1=显示
    structure_card_visible = Column(Integer, default=0)  # 结构卡片是否展开：0=隐藏 1=显示
    created_at = Column(DateTime, default=datetime.utcnow)

    dictation = relationship("Dictation", back_populates="cards")
    annotations = relationship("TextAnnotation", back_populates="card", cascade="all, delete-orphan")
    analysis_card = relationship("AnalysisCard", back_populates="card", uselist=False, cascade="all, delete-orphan")
    vocabularies = relationship("Vocabulary", back_populates="source_card", foreign_keys="Vocabulary.source_card_id")

    def _get_vocab_for_card(self):
        """获取与此卡片关联的所有生词（通过 sources JSON）"""
        from sqlalchemy.orm import object_session
        session = object_session(self)
        if not session:
            return []
        all_vocabs = session.query(Vocabulary).all()
        result = []
        for v in all_vocabs:
            if not v.sources or not isinstance(v.sources, dict):
                continue
            read_sources = v.sources.get("cannot_read", [])
            understand_sources = v.sources.get("cannot_understand", [])
            for s in read_sources + understand_sources:
                if s.get("card_id") == self.id:
                    result.append(v)
                    break
        return result

    @property
    def vocab_read(self):
        return [v for v in self._get_vocab_for_card() if any(
            s.get("card_id") == self.id for s in (v.sources or {}).get("cannot_read", [])
        )]

    @property
    def vocab_understand(self):
        return [v for v in self._get_vocab_for_card() if any(
            s.get("card_id") == self.id for s in (v.sources or {}).get("cannot_understand", [])
        )]


class TextAnnotation(Base):
    """文本标注表（高亮/颜色/连读/弱读/爆破）"""
    __tablename__ = "text_annotation"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("dictation_card.id", ondelete="CASCADE"), nullable=False)
    field = Column(String(20), nullable=False)  # content / correct_content
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    text_content = Column(Text, nullable=True)  # 标注的文本内容，用于内容变化后重新定位
    annotation_type = Column(String(20), nullable=False)  # highlight/color/liaison/weak/burst
    annotation_value = Column(String(50), nullable=True)  # 颜色值等
    created_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("DictationCard", back_populates="annotations")


class AnalysisCard(Base):
    """错误分析卡片表（右列）"""
    __tablename__ = "analysis_card"

    id = Column(Integer, primary_key=True, index=True)
    card_id = Column(Integer, ForeignKey("dictation_card.id", ondelete="CASCADE"), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    card = relationship("DictationCard", back_populates="analysis_card")
    records = relationship("AnalysisRecord", back_populates="analysis_card", cascade="all, delete-orphan")


class AnalysisRecord(Base):
    """分析记录表（听不懂/听不到分类记录）"""
    __tablename__ = "analysis_record"

    id = Column(Integer, primary_key=True, index=True)
    analysis_card_id = Column(Integer, ForeignKey("analysis_card.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(30), nullable=False)  # cannot_understand / cannot_hear
    content = Column(Text, nullable=False)  # 记录内容
    created_at = Column(DateTime, default=datetime.utcnow)

    analysis_card = relationship("AnalysisCard", back_populates="records")


class Vocabulary(Base):
    """生词表"""
    __tablename__ = "vocabulary"
    __table_args__ = (UniqueConstraint("user_id", "word", name="uq_vocabulary_user_word"),)

    id = Column(Integer, primary_key=True, index=True)
    word = Column(String(100), nullable=False, index=True)
    phonetic = Column(String(200), nullable=True)  # 音标
    pos = Column(String(50), nullable=True)  # 词性：verb/noun/adj/adv/prep/conj/pron 等
    past_tense = Column(String(100), nullable=True)  # 过去式（动词）
    past_participle = Column(String(100), nullable=True)  # 过去分词（动词）
    translation = Column(Text, nullable=True)  # 翻译（可含多义，DeepSeek 返回）
    notes = Column(Text, nullable=True)  # 备注
    labels = Column(JSON, nullable=True, default=list)  # 标签：cannot_read / cannot_understand
    category = Column(String(30), nullable=True)  # 已废弃，保留兼容
    source_dictation_id = Column(Integer, ForeignKey("dictation.id", ondelete="SET NULL"), nullable=True)
    source_card_id = Column(Integer, ForeignKey("dictation_card.id", ondelete="SET NULL"), nullable=True)
    sources = Column(JSON, nullable=True, default=dict)  # {cannot_read: [{dictation_id, dictation_title, card_id}], cannot_understand: [...]}
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)  # 所属用户
    created_at = Column(DateTime, default=datetime.utcnow)
    next_review_at = Column(DateTime, nullable=True)  # 下次复习时间
    review_count = Column(Integer, default=0)  # 已复习次数
    mastery_level = Column(Integer, default=0)  # 掌握度：0=新词 1=学习中 2=已掌握

    source_dictation = relationship("Dictation", foreign_keys=[source_dictation_id])
    source_card = relationship("DictationCard", back_populates="vocabularies", foreign_keys=[source_card_id])


class ReviewLog(Base):
    """复习记录表"""
    __tablename__ = "review_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    vocabulary_id = Column(Integer, ForeignKey("vocabulary.id", ondelete="CASCADE"), nullable=False, index=True)
    review_type = Column(String(20), nullable=False)  # spelling / matching
    correct = Column(Integer, nullable=False, default=0)  # 1=正确 0=错误
    created_at = Column(DateTime, default=datetime.utcnow)

    vocabulary = relationship("Vocabulary", foreign_keys=[vocabulary_id])


class Tag(Base):
    """标签表"""
    __tablename__ = "tag"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False, unique=True)


class DictationTag(Base):
    """听写-标签关联表"""
    __tablename__ = "dictation_tag"
    __table_args__ = (UniqueConstraint("dictation_id", "tag_id", name="uq_dictation_tag"),)

    id = Column(Integer, primary_key=True, index=True)
    dictation_id = Column(Integer, ForeignKey("dictation.id", ondelete="CASCADE"), nullable=False)
    tag_id = Column(Integer, ForeignKey("tag.id", ondelete="CASCADE"), nullable=False)

    dictation = relationship("Dictation", back_populates="tags")
    tag = relationship("Tag")


class Clipboard(Base):
    """剪贴板表（每用户一行，存储复制/剪切的卡片ID）"""
    __tablename__ = "clipboard"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, unique=True, index=True)
    source_card_id = Column(Integer, nullable=True)
    action = Column(String(10), nullable=True)  # copy / cut
    created_at = Column(DateTime, default=datetime.utcnow)
