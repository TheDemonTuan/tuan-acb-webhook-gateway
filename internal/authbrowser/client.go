package authbrowser

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Session struct {
	AttemptID string `json:"attemptId"`
	Status    string `json:"status"`
	ScreenURL string `json:"screenUrl"`
	ExpiresAt string `json:"expiresAt"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{baseURL: strings.TrimSuffix(baseURL, "/"), http: &http.Client{Timeout: 10 * time.Second}}
}

func (c *Client) Start(ctx context.Context, attemptID string) (Session, error) {
	body, _ := json.Marshal(map[string]string{"attemptId": attemptID})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/sessions", bytes.NewReader(body))
	if err != nil {
		return Session{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return Session{}, fmt.Errorf("start ACB browser: %w", err)
	}
	defer response.Body.Close()
	var session Session
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		return Session{}, err
	}
	if response.StatusCode != http.StatusCreated {
		return Session{}, fmt.Errorf("ACB browser start returned %d", response.StatusCode)
	}
	return session, nil
}

func (c *Client) Cancel(ctx context.Context, attemptID string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/sessions/"+attemptID, nil)
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("ACB browser cancel returned %d", response.StatusCode)
	}
	return nil
}

func (c *Client) Status(ctx context.Context, attemptID string) (Session, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/sessions/"+attemptID+"/status", nil)
	if err != nil {
		return Session{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return Session{}, err
	}
	defer response.Body.Close()
	var session Session
	if err := json.NewDecoder(response.Body).Decode(&session); err != nil {
		return Session{}, err
	}
	if response.StatusCode != http.StatusOK {
		return Session{}, fmt.Errorf("ACB browser status returned %d", response.StatusCode)
	}
	return session, nil
}

func (c *Client) Handoff(ctx context.Context, attemptID string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/sessions/"+attemptID+"/handoff", nil)
	if err != nil {
		return nil, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var payload struct {
		Session string `json:"session"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK || payload.Session == "" {
		return nil, fmt.Errorf("ACB browser handoff returned %d", response.StatusCode)
	}
	return []byte(payload.Session), nil
}
