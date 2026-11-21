import os
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./cartoon_ai_studio.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConversionJob(Base):
    __tablename__ = "jobs"

    job_id = Column(String(64), primary_key=True, index=True)
    original_filename = Column(String(255), nullable=False)
    input_path = Column(Text, nullable=False)
    gcs_input_uri = Column(Text, nullable=True)
    audio_path = Column(Text, nullable=True)
    output_path = Column(Text, nullable=True)
    gcs_output_uri = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, default="queued")
    progress = Column(Integer, nullable=False, default=0)
    current_stage = Column(Integer, nullable=False, default=1)
    last_completed_stage = Column(Integer, nullable=False, default=0)
    stage_detail = Column(Text, nullable=False, default="")
    estimated_seconds_remaining = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=False)
    output_metadata_json = Column(Text, nullable=True)
    analysis_json = Column(Text, nullable=True)
    created_at = Column(String(64), nullable=False, default=utc_now_iso)
    updated_at = Column(String(64), nullable=False, default=utc_now_iso)

    characters = relationship("CharacterRecord", back_populates="job", cascade="all, delete-orphan")
    scenes = relationship("SceneRecord", back_populates="job", cascade="all, delete-orphan")


class CharacterRecord(Base):
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(64), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False, index=True)
    character_id = Column(String(64), nullable=False)
    name = Column(String(128), nullable=False)
    facial_features = Column(Text, nullable=False)
    hair_style_and_color = Column(Text, nullable=False)
    eye_shape_and_color = Column(Text, nullable=False)
    clothing_and_accessories = Column(Text, nullable=False)
    body_proportions = Column(Text, nullable=False)
    color_palette = Column(Text, nullable=False)
    distinctive_features = Column(Text, nullable=False)
    best_frame_timestamp_sec = Column(Float, nullable=False, default=0.0)
    source_face_asset = Column(String(255), nullable=True)
    anime_ref_asset = Column(String(255), nullable=True)
    gcs_ref_uri = Column(Text, nullable=True)

    job = relationship("ConversionJob", back_populates="characters")


class SceneRecord(Base):
    __tablename__ = "scenes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(String(64), ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False, index=True)
    scene_index = Column(Integer, nullable=False)
    start_sec = Column(Float, nullable=False)
    end_sec = Column(Float, nullable=False)
    duration_sec = Column(Float, nullable=False)
    summary = Column(Text, nullable=False)
    expressions_and_actions = Column(Text, nullable=False)
    camera_and_movement = Column(Text, nullable=False)
    background_and_lighting = Column(Text, nullable=False)
    character_ids_json = Column(Text, nullable=False, default="[]")
    conversion_prompt = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="pending")
    keyframe_asset = Column(String(255), nullable=True)
    clip_path = Column(Text, nullable=True)
    gcs_clip_uri = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    job = relationship("ConversionJob", back_populates="scenes")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
