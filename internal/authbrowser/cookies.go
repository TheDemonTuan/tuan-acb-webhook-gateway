package authbrowser

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Cookie is the minimal, serializable browser state handed from the private
// Chromium controller to the Go bank client. It is never returned to the UI.
type Cookie struct {
	Name     string    `json:"name"`
	Value    string    `json:"value"`
	Domain   string    `json:"domain"`
	Path     string    `json:"path"`
	Expires  time.Time `json:"expires,omitempty"`
	Secure   bool      `json:"secure"`
	HTTPOnly bool      `json:"httpOnly"`
}

// Handoff is the encrypted browser state required to enter the same ACB page
// from the gateway HTTP client. Version 1 handoffs contain cookies and the
// authenticated browser URL.
type Handoff struct {
	Version int      `json:"version"`
	URL     string   `json:"url,omitempty"`
	Cookies []Cookie `json:"cookies"`
}

func EncodeHandoff(handoff Handoff, nonce []byte) (string, error) {
	if handoff.Version == 0 {
		handoff.Version = 1
	}
	if handoff.Version != 1 || len(handoff.Cookies) == 0 {
		return "", errors.New("invalid ACB browser handoff")
	}
	payload, err := json.Marshal(handoff)
	if err != nil {
		return "", err
	}
	if len(nonce) == 0 {
		return "", errors.New("ACB browser handoff nonce is required")
	}
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(nonce), nil
}

func DecodeHandoff(encoded string) (Handoff, error) {
	payload, _, ok := strings.Cut(encoded, ".")
	if !ok || payload == "" {
		return Handoff{}, errors.New("invalid ACB browser handoff framing")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return Handoff{}, errors.New("invalid ACB browser handoff payload")
	}
	var handoff Handoff
	if err := json.Unmarshal(decoded, &handoff); err == nil && handoff.Version == 1 && len(handoff.Cookies) > 0 {
		return handoff, nil
	}

	// Accept legacy cookie-only handoffs so existing encrypted sessions can be
	// read during rolling upgrades. New handoffs always use the versioned form.
	var cookies []Cookie
	if err := json.Unmarshal(decoded, &cookies); err != nil || len(cookies) == 0 {
		return Handoff{}, errors.New("invalid ACB browser handoff")
	}
	return Handoff{Cookies: cookies}, nil
}
