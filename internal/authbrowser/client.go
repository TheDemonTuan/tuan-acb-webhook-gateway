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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/sessions", bytes.NewReader(body))
	if err != nil {
		return Session{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
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
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/sessions/"+attemptID, nil)
	if err != nil {
		return err
	}
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("ACB browser cancel returned %d", response.StatusCode)
	}
	return nil
}
