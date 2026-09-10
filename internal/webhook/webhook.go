package webhook

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
)

const SignatureVersion = "v1"

type Event struct {
	SpecVersion string          `json:"specVersion"`
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Source      string          `json:"source"`
	Time        time.Time       `json:"time"`
	Data        json.RawMessage `json:"data"`
}

type SignedRequest struct {
	Timestamp string
	Nonce     string
	Signature string
}

func NewNonce() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func Sign(secret, body []byte, at time.Time, nonce string) SignedRequest {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(timestamp + "." + nonce + "."))
	_, _ = mac.Write(body)
	return SignedRequest{Timestamp: timestamp, Nonce: nonce, Signature: SignatureVersion + "=" + hex.EncodeToString(mac.Sum(nil))}
}
func Verify(secret, body []byte, timestamp, nonce, signature string, now time.Time, leeway time.Duration) error {
	if nonce == "" || len(nonce) > 256 {
		return errors.New("invalid nonce")
	}
	at, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return errors.New("invalid timestamp")
	}
	if delta := now.Sub(time.Unix(at, 0)); delta > leeway || delta < -leeway {
		return errors.New("timestamp outside replay window")
	}
	expected := Sign(secret, body, time.Unix(at, 0), nonce).Signature
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return errors.New("invalid signature")
	}
	return nil
}
func StableEventID(namespace, semanticKey, eventType string) string {
	sum := sha256.Sum256([]byte(namespace + "\x00" + semanticKey + "\x00" + eventType))
	return "bevt_" + hex.EncodeToString(sum[:16])
}

type PublicDialer struct {
	Resolver *net.Resolver
	Dialer   net.Dialer
}

func (d PublicDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := d.resolver().LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("hostname has no addresses")
	}
	for _, candidate := range ips {
		if !public(net.IP(candidate.AsSlice())) {
			return nil, fmt.Errorf("webhook host has non-public address")
		}
	}
	last := error(nil)
	for _, candidate := range ips {
		conn, err := d.Dialer.DialContext(ctx, network, net.JoinHostPort(candidate.String(), port))
		if err == nil {
			return conn, nil
		}
		last = err
	}
	return nil, last
}
func (d PublicDialer) resolver() *net.Resolver {
	if d.Resolver != nil {
		return d.Resolver
	}
	return net.DefaultResolver
}
func public(ip net.IP) bool { return validPublicIP(ip) }
func validPublicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return false
		}
		if v4[0] >= 224 {
			return false
		}
	}
	return true
}
func NewHTTPClient() *http.Client {
	dialer := PublicDialer{Dialer: net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = dialer.DialContext
	transport.ResponseHeaderTimeout = 10 * time.Second
	transport.TLSHandshakeTimeout = 5 * time.Second
	return &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
}
func ValidateURL(raw string) (*url.URL, error) { return security.ValidateWebhookURL(raw) }
func Headers(eventID, deliveryID, keyID string, signature SignedRequest) http.Header {
	h := http.Header{}
	h.Set("Content-Type", "application/json")
	h.Set("X-Bank-Event-Id", eventID)
	h.Set("X-Bank-Delivery-Id", deliveryID)
	h.Set("X-Bank-Timestamp", signature.Timestamp)
	h.Set("X-Bank-Nonce", signature.Nonce)
	h.Set("X-Bank-Key-Id", keyID)
	h.Set("X-Bank-Signature", signature.Signature)
	return h
}
func IsRetriable(status int) bool {
	return status == 0 || status == 408 || status == 429 || status >= 500
}
func NextAttempt(attempt int, now time.Time) time.Time {
	schedule := []time.Duration{2 * time.Second, 5 * time.Second, 15 * time.Second, 30 * time.Second, time.Minute, 2 * time.Minute, 5 * time.Minute, 15 * time.Minute}
	if attempt < 0 {
		attempt = 0
	}
	if attempt >= len(schedule) {
		attempt = len(schedule) - 1
	}
	return now.Add(schedule[attempt])
}
func RedactURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid"
	}
	u.User = nil
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimSuffix(u.String(), "/")
}
