"""Data models and schemas for TTS Gateway."""
from typing import Optional, List
from pydantic import BaseModel, Field

class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=600)
    voice: Optional[str] = Field("vi-VN-HoaiMyNeural")
    rate: Optional[str] = Field("+0%")
    pitch: Optional[str] = Field("+0Hz")
    cacheable: Optional[bool] = Field(True)
    allow_fallback: Optional[bool] = Field(True)
    provider_mode: Optional[str] = Field("ONLINE_AUTO")

class VoiceItem(BaseModel):
    id: str
    name: str
    gender: str
    provider: str

class ProviderHealth(BaseModel):
    available: bool

class HealthResponse(BaseModel):
    status: str
    primary: str
    edge: ProviderHealth
    gtts: ProviderHealth

class ErrorResponse(BaseModel):
    code: str
    error: str
