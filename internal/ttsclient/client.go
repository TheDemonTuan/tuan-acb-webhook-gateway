package ttsclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var (
	ErrUnavailable     = errors.New("tts_service_unavailable")
	ErrSynthesisFailed = errors.New("tts_synthesis_failed")
	ErrUnauthorized    = errors.New("tts_unauthorized")
)

type SynthesizeRequest struct {
	Text          string `json:"text"`
	Voice         string `json:"voice,omitempty"`
	Rate          string `json:"rate,omitempty"`
	Pitch         string `json:"pitch,omitempty"`
	Cacheable     bool   `json:"cacheable"`
	AllowFallback *bool  `json:"allow_fallback,omitempty"`
	ProviderMode  string `json:"provider_mode,omitempty"`
}

type SynthesizeResult struct {
	Audio    []byte
	Provider string
	Voice    string
	Fallback bool
	Cached   bool
}

type Client struct {
	baseURL       string
	internalToken string
	httpClient    *http.Client
}

func New(baseURL, internalToken string) *Client {
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8081"
	}
	return &Client{
		baseURL:       strings.TrimRight(baseURL, "/"),
		internalToken: internalToken,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

func (c *Client) Synthesize(ctx context.Context, req SynthesizeRequest) (*SynthesizeResult, error) {
	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := c.baseURL + "/synthesize"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if c.internalToken != "" {
		httpReq.Header.Set("X-Internal-TTS-Token", c.internalToken)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrUnauthorized
	}

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("%w (status %d): %s", ErrSynthesisFailed, resp.StatusCode, string(respBody))
	}

	// Read audio payload (up to 4MB)
	audioData, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read audio: %w", err)
	}

	provider := resp.Header.Get("X-TTS-Provider")
	if provider == "" {
		provider = "edge"
	}
	voice := resp.Header.Get("X-TTS-Voice")
	fallback := strings.EqualFold(resp.Header.Get("X-TTS-Fallback"), "true")
	cached := strings.EqualFold(resp.Header.Get("X-TTS-Cached"), "true")

	return &SynthesizeResult{
		Audio:    audioData,
		Provider: provider,
		Voice:    voice,
		Fallback: fallback,
		Cached:   cached,
	}, nil
}
