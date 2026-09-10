package acb

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"time"
)

const OfficialHost = "online.acb.com.vn"

type Client struct {
	baseURL *url.URL
	http    *http.Client
}

type Response struct {
	URL        string
	StatusCode int
	Body       string
	Kind       PageKind
}

func NewClient(base string, transport http.RoundTripper) (*Client, error) {
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), OfficialHost) {
		return nil, errors.New("ACB base URL must be https://online.acb.com.vn")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &Client{baseURL: parsed, http: &http.Client{Jar: jar, Timeout: 5 * time.Second, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if !strings.EqualFold(req.URL.Hostname(), OfficialHost) {
			return errors.New("ACB redirect leaves official host")
		}
		return nil
	}}}, nil
}

func (c *Client) Get(ctx context.Context, endpoint string) (Response, error) {
	url, err := c.baseURL.Parse(endpoint)
	if err != nil || !strings.EqualFold(url.Hostname(), OfficialHost) {
		return Response{}, errors.New("invalid ACB endpoint")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url.String(), nil)
	if err != nil {
		return Response{}, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return Response{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Response{}, err
	}
	return Response{URL: resp.Request.URL.String(), StatusCode: resp.StatusCode, Body: string(body), Kind: ClassifyPage(resp.Request.URL.String(), string(body))}, nil
}
