"""Google TTS (gTTS) fallback provider."""
import asyncio
import io
from gtts import gTTS

class GTTSProvider:
    name: str = "gtts"

    async def synthesize(
        self,
        text: str,
        voice: str = "vi",
        rate: str = "+0%",
        pitch: str = "+0Hz",
        timeout_seconds: float = 3.0,
    ) -> bytes:
        def _run_gtts() -> bytes:
            tts = gTTS(
                text=text,
                lang="vi",
                slow=False,
                lang_check=False,
                timeout=max(1, int(timeout_seconds)),
            )
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            return fp.getvalue()

        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(_run_gtts),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"GTTS_TIMEOUT: synthesis timed out after {timeout_seconds}s")

        if not data:
            raise ValueError("GTTS_NO_AUDIO: empty audio received")
        return data
