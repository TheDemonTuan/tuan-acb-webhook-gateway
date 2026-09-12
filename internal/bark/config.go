package bark

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	ServerURL         string
	PublicURL         string
	BasicAuthUser     string
	BasicAuthPassword string
	Timeout           time.Duration
	DefaultGroup      string
	DefaultLevel      string
	DefaultSound      string
}

func (c Config) Configured() bool {
	return strings.TrimSpace(c.ServerURL) != ""
}

func LoadConfigFromEnv() (Config, error) {
	serverURL := strings.TrimSpace(os.Getenv("BARK_SERVER_URL"))
	publicURL := strings.TrimSpace(os.Getenv("BARK_PUBLIC_URL"))

	authUser := strings.TrimSpace(os.Getenv("BARK_BASIC_AUTH_USER"))
	if file := os.Getenv("BARK_BASIC_AUTH_USER_FILE"); file != "" {
		if b, err := os.ReadFile(file); err == nil {
			authUser = strings.TrimSpace(string(b))
		}
	}

	authPass := strings.TrimSpace(os.Getenv("BARK_BASIC_AUTH_PASSWORD"))
	if file := os.Getenv("BARK_BASIC_AUTH_PASSWORD_FILE"); file != "" {
		if b, err := os.ReadFile(file); err == nil {
			authPass = strings.TrimSpace(string(b))
		}
	}

	timeoutMs := 5000
	if raw := os.Getenv("BARK_TIMEOUT_MS"); raw != "" {
		var ms int
		if _, err := fmt.Sscanf(raw, "%d", &ms); err == nil && ms >= 500 && ms <= 15000 {
			timeoutMs = ms
		}
	}

	group := strings.TrimSpace(os.Getenv("BARK_DEFAULT_GROUP"))
	if group == "" {
		group = "ACB"
	}

	level := strings.TrimSpace(os.Getenv("BARK_DEFAULT_LEVEL"))
	if level == "" {
		level = "timeSensitive"
	}

	sound := strings.TrimSpace(os.Getenv("BARK_DEFAULT_SOUND"))
	if sound == "" {
		sound = "shake"
	}

	cfg := Config{
		ServerURL:         serverURL,
		PublicURL:         publicURL,
		BasicAuthUser:     authUser,
		BasicAuthPassword: authPass,
		Timeout:           time.Duration(timeoutMs) * time.Millisecond,
		DefaultGroup:      group,
		DefaultLevel:      level,
		DefaultSound:      sound,
	}

	if cfg.Configured() {
		if err := ValidateConfig(cfg); err != nil {
			return Config{}, err
		}
	}

	return cfg, nil
}

func ValidateConfig(c Config) error {
	if c.ServerURL == "" {
		return nil
	}
	u, err := url.Parse(c.ServerURL)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return errors.New("BARK_SERVER_URL must be a valid absolute URL (e.g. http://bark:8080)")
	}
	if u.Fragment != "" || u.RawQuery != "" || u.User != nil {
		return errors.New("BARK_SERVER_URL must not contain userinfo, query, or fragment")
	}

	if c.PublicURL != "" {
		pu, err := url.Parse(c.PublicURL)
		if err != nil || pu.Scheme == "" || pu.Host == "" {
			return errors.New("BARK_PUBLIC_URL must be a valid absolute URL (e.g. https://push.example.com)")
		}
	}

	return nil
}
