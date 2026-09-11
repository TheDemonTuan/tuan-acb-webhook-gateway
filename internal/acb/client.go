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

	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
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

func isAllowedACBCookieDomain(domain string) bool {
	d := strings.ToLower(strings.TrimPrefix(domain, "."))
	return d == "" || d == OfficialHost || d == "acb.com.vn"
}

// RestoreCookies accepts only cookies bound to the official ACB host. The
// caller supplies encrypted storage; no cookie ever crosses the dashboard API.
func (c *Client) RestoreCookies(cookies []authbrowser.Cookie) error {
	for _, cookie := range cookies {
		if cookie.Name == "" || cookie.Value == "" || !isAllowedACBCookieDomain(cookie.Domain) {
			return errors.New("invalid ACB session cookie")
		}
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return err
	}
	base := *c.baseURL
	for _, cookie := range cookies {
		jar.SetCookies(&base, []*http.Cookie{{Name: cookie.Name, Value: cookie.Value, Domain: cookie.Domain, Path: cookie.Path, Expires: cookie.Expires, Secure: cookie.Secure, HttpOnly: cookie.HTTPOnly}})
	}
	c.http.Jar = jar
	return nil
}

func (c *Client) History(ctx context.Context, endpoint string, fields map[string]string) (Response, error) {
	if fields["dse_operationName"] == "" || fields["dse_processorState"] == "" {
		return Response{}, errors.New("ACB history request is missing current form state")
	}
	requestURL, err := c.endpoint(endpoint)
	if err != nil {
		return Response{}, err
	}
	values := url.Values{}
	for key, value := range fields {
		values.Set(key, value)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL.String(), strings.NewReader(values.Encode()))
	if err != nil {
		return Response{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return c.do(req)
}

func (c *Client) Get(ctx context.Context, endpoint string) (Response, error) {
	url, err := c.endpoint(endpoint)
	if err != nil {
		return Response{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url.String(), nil)
	if err != nil {
		return Response{}, err
	}
	return c.do(req)
}

func (c *Client) endpoint(endpoint string) (*url.URL, error) {
	requestURL, err := c.baseURL.Parse(endpoint)
	if err != nil || !strings.EqualFold(requestURL.Hostname(), OfficialHost) {
		return nil, errors.New("invalid ACB endpoint")
	}
	return requestURL, nil
}

const DefaultUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

func (c *Client) do(req *http.Request) (Response, error) {
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", DefaultUserAgent)
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
