package ttsclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientSynthesizeSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/synthesize" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("X-Internal-TTS-Token") != "secret-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("X-TTS-Provider", "edge")
		w.Header().Set("X-TTS-Voice", "vi-VN-HoaiMyNeural")
		w.Header().Set("X-TTS-Fallback", "false")
		w.Header().Set("X-TTS-Cached", "true")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("fake_mp3_audio_data"))
	}))
	defer ts.Close()

	client := New(ts.URL, "secret-token")
	res, err := client.Synthesize(context.Background(), SynthesizeRequest{
		Text:      "Xin chào",
		Voice:     "vi-VN-HoaiMyNeural",
		Cacheable: true,
	})
	if err != nil {
		t.Fatalf("Synthesize failed: %v", err)
	}

	if string(res.Audio) != "fake_mp3_audio_data" {
		t.Errorf("unexpected audio data: %q", string(res.Audio))
	}
	if res.Provider != "edge" {
		t.Errorf("unexpected provider: %q", res.Provider)
	}
	if res.Fallback != false {
		t.Errorf("expected Fallback=false, got true")
	}
	if res.Cached != true {
		t.Errorf("expected Cached=true, got false")
	}
}

func TestClientSynthesizeUnauthorized(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer ts.Close()

	client := New(ts.URL, "wrong-token")
	_, err := client.Synthesize(context.Background(), SynthesizeRequest{Text: "test"})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err != ErrUnauthorized {
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}
