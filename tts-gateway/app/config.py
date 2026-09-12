"""Configuration for TTS Gateway sidecar."""
import os
from pydantic import BaseModel

class Config(BaseModel):
    host: str = os.getenv("TTS_HOST", "0.0.0.0")
    port: int = int(os.getenv("TTS_PORT", "8081"))
    internal_token: str = os.getenv("TTS_INTERNAL_TOKEN", "")
    token_file: str = os.getenv("TTS_INTERNAL_TOKEN_FILE", "")
    max_text_length: int = 600
    cache_max_items: int = 256
    cache_ttl_seconds: int = 600  # 10 minutes
    edge_circuit_failure_threshold: int = 3
    edge_circuit_reset_timeout: float = 45.0  # seconds

    def get_token(self) -> str:
        if self.internal_token:
            return self.internal_token
        if self.token_file and os.path.exists(self.token_file):
            try:
                with open(self.token_file, "r", encoding="utf-8") as f:
                    return f.read().strip()
            except Exception:
                return ""
        return ""

config = Config()
