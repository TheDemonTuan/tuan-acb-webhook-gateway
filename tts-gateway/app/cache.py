"""In-memory cache with TTL and single-flight coalescing."""
import asyncio
import hashlib
import time
from typing import Optional, Dict, Tuple

class TTSCache:
    def __init__(self, max_items: int = 256, ttl_seconds: int = 600):
        self.max_items = max_items
        self.ttl_seconds = ttl_seconds
        # key -> (audio_bytes, timestamp, provider, voice)
        self._cache: Dict[str, Tuple[bytes, float, str, str]] = {}
        # key -> asyncio.Future
        self._in_flight: Dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def make_key(text: str, voice: str, rate: str, pitch: str) -> str:
        raw = f"{text}|{voice}|{rate}|{pitch}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def get(self, key: str) -> Optional[Tuple[bytes, str, str]]:
        async with self._lock:
            if key in self._cache:
                data, ts, provider, voice = self._cache[key]
                if time.time() - ts <= self.ttl_seconds:
                    return data, provider, voice
                else:
                    del self._cache[key]
            return None

    async def set(self, key: str, data: bytes, provider: str, voice: str):
        async with self._lock:
            now = time.time()
            if len(self._cache) >= self.max_items:
                # Evict oldest entry
                oldest_key = min(self._cache.keys(), key=lambda k: self._cache[k][1])
                del self._cache[oldest_key]
            self._cache[key] = (data, now, provider, voice)

    async def get_or_compute(self, key: str, compute_func):
        cached = await self.get(key)
        if cached:
            return cached

        future = None
        should_compute = False

        async with self._lock:
            if key in self._in_flight:
                future = self._in_flight[key]
            else:
                loop = asyncio.get_running_loop()
                future = loop.create_future()
                self._in_flight[key] = future
                should_compute = True

        if should_compute:
            try:
                result = await compute_func()
                audio_bytes, provider, voice = result
                await self.set(key, audio_bytes, provider, voice)
                future.set_result(result)
                return result
            except Exception as e:
                future.set_exception(e)
                raise
            finally:
                async with self._lock:
                    self._in_flight.pop(key, None)
        else:
            return await future
