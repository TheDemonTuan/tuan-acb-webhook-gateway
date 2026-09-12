"""Microsoft Edge TTS provider."""
import asyncio
import io
from typing import Optional
import edge_tts

SUPPORTED_VOICES = {
    "vi-VN-HoaiMyNeural": "Hoài My",
    "vi-VN-NamMinhNeural": "Nam Minh",
}

class EdgeTTSProvider:
    name: str = "edge"

    async def synthesize(
        self,
        text: str,
        voice: str = "vi-VN-HoaiMyNeural",
        rate: str = "+0%",
        pitch: str = "+0Hz",
        timeout_seconds: float = 4.0,
    ) -> bytes:
        if voice not in SUPPORTED_VOICES:
            voice = "vi-VN-HoaiMyNeural"

        async def _do_synth() -> bytes:
            communicate = edge_tts.Communicate(
                text=text,
                voice=voice,
                rate=rate,
                pitch=pitch,
            )
            buffer = io.BytesIO()
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio" and "data" in chunk:
                    buffer.write(chunk["data"])

            data = buffer.getvalue()
            if not data:
                raise ValueError("EDGE_NO_AUDIO: no audio chunks received")
            return data

        return await asyncio.wait_for(_do_synth(), timeout=timeout_seconds)
