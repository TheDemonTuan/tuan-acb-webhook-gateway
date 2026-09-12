"""FastAPI Application for TTS Gateway."""
import asyncio
import logging
import secrets
from typing import List, Optional
from fastapi import FastAPI, Header, HTTPException, Response, status
from fastapi.responses import JSONResponse

from app.config import config
from app.schemas import (
    SynthesizeRequest,
    VoiceItem,
    HealthResponse,
    ProviderHealth,
    ErrorResponse,
)
from app.circuit import CircuitBreaker, CircuitState
from app.cache import TTSCache
from app.providers.edge import EdgeTTSProvider, SUPPORTED_VOICES
from app.providers.gtts import GTTSProvider

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-gateway")

app = FastAPI(title="TTS Gateway", version="1.0.0")

edge_provider = EdgeTTSProvider()
gtts_provider = GTTSProvider()
edge_circuit = CircuitBreaker(
    failure_threshold=config.edge_circuit_failure_threshold,
    reset_timeout=config.edge_circuit_reset_timeout,
)
cache = TTSCache(
    max_items=config.cache_max_items,
    ttl_seconds=config.cache_ttl_seconds,
)

def verify_token(x_internal_tts_token: Optional[str]):
    expected = config.get_token()
    if not expected:
        return
    if not x_internal_tts_token or not secrets.compare_digest(x_internal_tts_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid internal TTS token",
        )

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        primary="edge",
        edge=ProviderHealth(available=edge_circuit.can_attempt()),
        gtts=ProviderHealth(available=True),
    )

@app.get("/voices", response_model=List[VoiceItem])
async def list_voices(x_internal_tts_token: Optional[str] = Header(None)):
    verify_token(x_internal_tts_token)
    return [
        VoiceItem(
            id="vi-VN-HoaiMyNeural",
            name="Hoài My",
            gender="female",
            provider="edge",
        ),
        VoiceItem(
            id="vi-VN-NamMinhNeural",
            name="Nam Minh",
            gender="male",
            provider="edge",
        ),
    ]

@app.post("/synthesize")
async def synthesize(
    req: SynthesizeRequest,
    x_internal_tts_token: Optional[str] = Header(None),
):
    verify_token(x_internal_tts_token)

    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(text) > config.max_text_length:
        raise HTTPException(
            status_code=400,
            detail=f"Text exceeds maximum length of {config.max_text_length}",
        )

    voice = req.voice or "vi-VN-HoaiMyNeural"
    rate = req.rate or "+0%"
    pitch = req.pitch or "+0Hz"
    is_cacheable = bool(req.cacheable)

    cache_key = cache.make_key(text, voice, rate, pitch)

    if is_cacheable:
        cached = await cache.get(cache_key)
        if cached:
            audio_bytes, provider, actual_voice = cached
            return Response(
                content=audio_bytes,
                media_type="audio/mpeg",
                headers={
                    "Content-Type": "audio/mpeg",
                    "X-TTS-Provider": provider,
                    "X-TTS-Voice": actual_voice,
                    "X-TTS-Fallback": "true" if provider != "edge" else "false",
                    "X-TTS-Cached": "true",
                },
            )

    async def _execute_synthesis():
        # 1. Try Edge TTS if circuit permits
        if edge_circuit.can_attempt():
            try:
                audio = await edge_provider.synthesize(
                    text=text, voice=voice, rate=rate, pitch=pitch, timeout_seconds=4.0
                )
                edge_circuit.record_success()
                return audio, "edge", voice
            except Exception as e:
                logger.warning(f"Edge TTS synthesis failed, recording circuit failure: {e}")
                edge_circuit.record_failure()
        else:
            logger.info("Edge circuit is OPEN, bypassing Edge directly to gTTS")

        # 2. Fallback to gTTS
        try:
            logger.info("Synthesizing using gTTS fallback")
            audio = await gtts_provider.synthesize(
                text=text, voice="vi", rate=rate, pitch=pitch, timeout_seconds=3.0
            )
            return audio, "gtts", "vi"
        except Exception as e:
            logger.error(f"gTTS fallback synthesis failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="TTS_UNAVAILABLE: both Edge TTS and gTTS providers failed",
            )

    try:
        if is_cacheable:
            audio_bytes, provider, actual_voice = await cache.get_or_compute(
                cache_key, _execute_synthesis
            )
        else:
            audio_bytes, provider, actual_voice = await _execute_synthesis()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Synthesis unexpected failure: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"TTS_SYNTHESIS_FAILED: {str(e)}",
        )

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Type": "audio/mpeg",
            "X-TTS-Provider": provider,
            "X-TTS-Voice": actual_voice,
            "X-TTS-Fallback": "true" if provider != "edge" else "false",
            "X-TTS-Cached": "false",
        },
    )
