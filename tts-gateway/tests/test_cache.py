import asyncio
import pytest
from app.cache import TTSCache

@pytest.mark.asyncio
async def test_cache_set_and_get():
    cache = TTSCache(max_items=10, ttl_seconds=2)
    key = cache.make_key("xin chao", "vi-VN-HoaiMyNeural", "+0%", "+0Hz")

    assert await cache.get(key) is None

    await cache.set(key, b"audio_mp3_data", "edge", "vi-VN-HoaiMyNeural")
    res = await cache.get(key)
    assert res is not None
    data, provider, voice = res
    assert data == b"audio_mp3_data"
    assert provider == "edge"
    assert voice == "vi-VN-HoaiMyNeural"

@pytest.mark.asyncio
async def test_cache_single_flight():
    cache = TTSCache(max_items=10, ttl_seconds=10)
    key = cache.make_key("test single flight", "vi-VN-HoaiMyNeural", "+0%", "+0Hz")

    compute_count = 0

    async def _compute():
        nonlocal compute_count
        compute_count += 1
        await asyncio.sleep(0.05)
        return b"computed_mp3", "edge", "vi-VN-HoaiMyNeural"

    # Launch 5 concurrent requests for the same key
    results = await asyncio.gather(
        cache.get_or_compute(key, _compute),
        cache.get_or_compute(key, _compute),
        cache.get_or_compute(key, _compute),
        cache.get_or_compute(key, _compute),
        cache.get_or_compute(key, _compute),
    )

    # Compute should only be executed ONCE
    assert compute_count == 1
    for data, provider, voice in results:
        assert data == b"computed_mp3"
        assert provider == "edge"
