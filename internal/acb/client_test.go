package acb

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestClientRejectsNonOfficialBase(t *testing.T) {
	if _, err := NewClient("https://example.test", nil); err == nil {
		t.Fatal("accepted untrusted host")
	}
}

func TestClientClassifiesLoginPage(t *testing.T) {
	client, err := NewClient("https://online.acb.com.vn", roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`<input name="username"><input type="password" name="password">`)), Request: r}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Get(context.Background(), "/acbib/Request")
	if err != nil {
		t.Fatal(err)
	}
	if response.Kind != LoginPage {
		t.Fatalf("got %s", response.Kind)
	}
}

func TestHistorySendsCurrentFormState(t *testing.T) {
	client, err := NewClient("https://online.acb.com.vn", roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost {
			t.Fatalf("method %s", r.Method)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "dse_processorState=fresh") {
			t.Fatalf("missing state %q", body)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`ibkacctDetailProc dse_processorState AccountNbr FromDate ToDate`)), Request: r}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.History(context.Background(), "/acbib/Request", map[string]string{"dse_operationName": "ibkacctDetailProc", "dse_processorState": "fresh"})
	if err != nil || response.Kind != HistoryPage {
		t.Fatalf("response=%+v err=%v", response, err)
	}
}

func TestClientRejectsEndpointOutsideOfficialHost(t *testing.T) {
	client, err := NewClient("https://online.acb.com.vn", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Get(context.Background(), "https://example.test/"); err == nil {
		t.Fatal("accepted untrusted endpoint")
	}
}

func TestEndpointResolvesACBIBPrefix(t *testing.T) {
	client, err := NewClient("https://online.acb.com.vn", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, ep := range []string{"Request", "/Request", "/acbib/Request"} {
		u, err := client.endpoint(ep)
		if err != nil {
			t.Fatalf("endpoint(%q) failed: %v", ep, err)
		}
		if u.Path != "/acbib/Request" {
			t.Fatalf("endpoint(%q) got path %q, want /acbib/Request", ep, u.Path)
		}
	}
}

func TestRestoreCookiesAllowsACBAndOnlineDomains(t *testing.T) {
	client, err := NewClient("https://online.acb.com.vn", nil)
	if err != nil {
		t.Fatal(err)
	}

	validCases := [][]authbrowser.Cookie{
		{{Name: "JSESSIONID", Value: "val1", Domain: "online.acb.com.vn"}},
		{{Name: "TS01", Value: "val2", Domain: ".online.acb.com.vn"}},
		{{Name: "SSO", Value: "val3", Domain: ".acb.com.vn"}},
		{{Name: "ROOT", Value: "val4", Domain: "acb.com.vn"}},
		{{Name: "HOST_ONLY", Value: "val5", Domain: ""}},
	}
	for i, tc := range validCases {
		if err := client.RestoreCookies(tc); err != nil {
			t.Fatalf("case %d: unexpected error for valid cookies: %v", i, err)
		}
	}

	invalidCases := [][]authbrowser.Cookie{
		{{Name: "bad", Value: "val", Domain: "evil.com"}},
		{{Name: "bad", Value: "val", Domain: "online.acb.com.vn.evil.com"}},
		{{Name: "bad", Value: "val", Domain: "acb.com.vn.evil.com"}},
		{{Name: "bad", Value: "val", Domain: "com.vn"}},
		{{Name: "bad", Value: "val", Domain: ".com.vn"}},
		{{Name: "bad", Value: "val", Domain: "sub.online.acb.com.vn"}},
		{{Name: "", Value: "val", Domain: "online.acb.com.vn"}},
		{{Name: "name", Value: "", Domain: "online.acb.com.vn"}},
	}
	for i, tc := range invalidCases {
		if err := client.RestoreCookies(tc); err == nil {
			t.Fatalf("case %d: expected error for invalid cookies, got nil", i)
		}
	}
}

func TestCheckRedirectStripsPort443(t *testing.T) {
	var requestedHost string
	client, err := NewClient("https://online.acb.com.vn", roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/start" {
			header := make(http.Header)
			header.Set("Location", "https://online.acb.com.vn:443/target")
			return &http.Response{StatusCode: http.StatusFound, Header: header, Request: r}, nil
		}
		requestedHost = r.URL.Host
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("ok")), Request: r}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Get(context.Background(), "/start")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if requestedHost != "online.acb.com.vn" {
		t.Fatalf("expected host to be stripped of port 443, got %q", requestedHost)
	}
}
