"""Base provider protocol."""
from typing import Protocol, Tuple

class TTSProvider(Protocol):
    name: str

    async def synthesize(
        self, text: str, voice: str, rate: str, pitch: str, timeout_seconds: float = 4.0
    ) -> bytes:
        ...
