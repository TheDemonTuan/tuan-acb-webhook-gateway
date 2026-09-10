package acb

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
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
