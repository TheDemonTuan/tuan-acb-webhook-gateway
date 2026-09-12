import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app, edge_provider, gtts_provider, edge_circuit

@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["primary"] == "edge"
        assert "edge" in data
        assert "gtts" in data

@pytest.mark.asyncio
async def test_voices_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/voices")
        assert resp.status_code == 200
        voices = resp.json()
        assert len(voices) >= 2
        ids = [v["id"] for v in voices]
        assert "vi-VN-HoaiMyNeural" in ids
        assert "vi-VN-NamMinhNeural" in ids

@pytest.mark.asyncio
async def test_synthesize_edge_success(monkeypatch):
    async def mock_edge_synth(*args, **kwargs):
        return b"fake_edge_audio"

    monkeypatch.setattr(edge_provider, "synthesize", mock_edge_synth)
    edge_circuit.record_success()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/synthesize",
            json={"text": "Bạn vừa nhận được 500k", "voice": "vi-VN-HoaiMyNeural"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert resp.headers["x-tts-provider"] == "edge"
        assert resp.headers["x-tts-fallback"] == "false"
        assert resp.content == b"fake_edge_audio"

@pytest.mark.asyncio
async def test_synthesize_fallback_to_gtts(monkeypatch):
    async def mock_edge_fail(*args, **kwargs):
        raise ConnectionError("Edge connection timed out")

    async def mock_gtts_success(*args, **kwargs):
        return b"fake_gtts_audio"

    monkeypatch.setattr(edge_provider, "synthesize", mock_edge_fail)
    monkeypatch.setattr(gtts_provider, "synthesize", mock_gtts_success)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/synthesize",
            json={"text": "Bạn vừa nhận được 200k", "voice": "vi-VN-HoaiMyNeural", "cacheable": False},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert resp.headers["x-tts-provider"] == "gtts"
        assert resp.headers["x-tts-fallback"] == "true"
        assert resp.content == b"fake_gtts_audio"
