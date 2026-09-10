package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/thedemontuan/tuan-bank-gateway/internal/config"
)

type CloudflareVerifier struct {
	issuer, audience, jwksURL string
	client                    *http.Client
	mu                        sync.Mutex
	keys                      jose.JSONWebKeySet
	fetched                   time.Time
}

func NewCloudflareVerifier(cfg config.Config) *CloudflareVerifier {
	return &CloudflareVerifier{issuer: cfg.CloudflareIssuer, audience: cfg.CloudflareAudience, jwksURL: cfg.CloudflareJWKSURL, client: &http.Client{Timeout: 5 * time.Second}}
}
func (v *CloudflareVerifier) Verify(ctx context.Context, raw string) (Identity, error) {
	if raw == "" {
		return Identity{}, errors.New("missing Cloudflare Access JWT")
	}
	signed, err := jwt.ParseSigned(raw, []jose.SignatureAlgorithm{jose.RS256, jose.ES256})
	if err != nil {
		return Identity{}, errors.New("invalid JWT")
	}
	headers := signed.Headers
	if len(headers) != 1 || headers[0].KeyID == "" {
		return Identity{}, errors.New("JWT missing key id")
	}
	keys, err := v.keyset(ctx)
	if err != nil {
		return Identity{}, err
	}
	var claims jwt.Claims
	var private struct {
		Email   string `json:"email"`
		Subject string `json:"sub"`
	}
	for _, key := range keys.Key(headers[0].KeyID) {
		if err := signed.Claims(key.Key, &claims, &private); err == nil {
			now := time.Now()
			if err = claims.ValidateWithLeeway(jwt.Expected{Issuer: v.issuer, AnyAudience: jwt.Audience{v.audience}, Time: now}, 30*time.Second); err != nil {
				return Identity{}, fmt.Errorf("JWT claims: %w", err)
			}
			if claims.Expiry == nil {
				return Identity{}, errors.New("JWT missing expiry")
			}
			subject := strings.TrimSpace(private.Subject)
			if subject == "" {
				subject = strings.TrimSpace(claims.Subject)
			}
			if subject == "" {
				subject = strings.TrimSpace(private.Email)
			}
			if subject == "" {
				return Identity{}, errors.New("JWT missing subject and email")
			}
			return Identity{Subject: subject, Email: strings.TrimSpace(private.Email)}, nil
		}
	}
	return Identity{}, errors.New("JWT signature could not be verified")
}
func (v *CloudflareVerifier) keyset(ctx context.Context) (jose.JSONWebKeySet, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if len(v.keys.Keys) > 0 && time.Since(v.fetched) < 10*time.Minute {
		return v.keys, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return jose.JSONWebKeySet{}, err
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return jose.JSONWebKeySet{}, fmt.Errorf("fetch JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return jose.JSONWebKeySet{}, fmt.Errorf("JWKS status %d", resp.StatusCode)
	}
	var keys jose.JSONWebKeySet
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&keys); err != nil {
		return jose.JSONWebKeySet{}, fmt.Errorf("decode JWKS: %w", err)
	}
	if len(keys.Keys) == 0 {
		return jose.JSONWebKeySet{}, errors.New("empty JWKS")
	}
	v.keys, v.fetched = keys, time.Now()
	return keys, nil
}
