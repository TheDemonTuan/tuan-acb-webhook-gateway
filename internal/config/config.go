package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type RoleSubjects struct {
	Owners    map[string]struct{}
	Operators map[string]struct{}
	Viewers   map[string]struct{}
}

type Config struct {
	Address            string
	DatabasePath       string
	MasterKeyFile      string
	Timezone           *time.Location
	PollInterval       time.Duration
	FastPollInterval   time.Duration
	CloudflareIssuer   string
	CloudflareAudience string
	CloudflareJWKSURL  string
	Roles              RoleSubjects
	DevelopmentSubject string
	Production         bool
}

func Load() (Config, error) {
	loc, err := time.LoadLocation(value("TZ", "Asia/Ho_Chi_Minh"))
	if err != nil {
		return Config{}, fmt.Errorf("load timezone: %w", err)
	}
	poll, err := seconds("DEFAULT_POLL_INTERVAL_SEC", 15, 5, 300)
	if err != nil {
		return Config{}, err
	}
	fast, err := seconds("FAST_POLL_INTERVAL_SEC", 5, 5, 300)
	if err != nil {
		return Config{}, err
	}
	dataDir := value("DATA_DIR", "data")
	production := value("APP_ENV", "development") == "production"
	cfg := Config{
		Address: value("LISTEN_ADDR", "127.0.0.1:8080"), DatabasePath: value("DATABASE_PATH", filepath.Join(dataDir, "gateway.db")), MasterKeyFile: os.Getenv("APP_MASTER_KEY_FILE"), Timezone: loc, PollInterval: poll, FastPollInterval: fast,
		CloudflareIssuer: strings.TrimSuffix(os.Getenv("CF_ACCESS_ISSUER"), "/"), CloudflareAudience: os.Getenv("CF_ACCESS_AUDIENCE"), CloudflareJWKSURL: os.Getenv("CF_ACCESS_JWKS_URL"),
		Roles: RoleSubjects{Owners: set("OWNER_SUBJECTS"), Operators: set("OPERATOR_SUBJECTS"), Viewers: set("VIEWER_SUBJECTS")}, DevelopmentSubject: value("DEVELOPMENT_SUBJECT", "local-owner"), Production: production,
	}
	if production {
		if cfg.MasterKeyFile == "" {
			return Config{}, fmt.Errorf("APP_MASTER_KEY_FILE is required in production")
		}
		if cfg.CloudflareIssuer == "" || cfg.CloudflareAudience == "" || cfg.CloudflareJWKSURL == "" {
			return Config{}, fmt.Errorf("Cloudflare Access issuer, audience, and JWKS URL are required in production")
		}
		if len(cfg.Roles.Owners) == 0 {
			return Config{}, fmt.Errorf("OWNER_SUBJECTS is required in production")
		}
	}
	if cfg.MasterKeyFile != "" && !filepath.IsAbs(cfg.MasterKeyFile) {
		return Config{}, fmt.Errorf("APP_MASTER_KEY_FILE must be an absolute path")
	}
	return cfg, nil
}
func value(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
func set(key string) map[string]struct{} {
	result := map[string]struct{}{}
	for _, v := range strings.Split(os.Getenv(key), ",") {
		if v = strings.TrimSpace(v); v != "" {
			result[v] = struct{}{}
		}
	}
	return result
}
func seconds(key string, fallback, minimum, maximum int) (time.Duration, error) {
	v, err := strconv.Atoi(value(key, strconv.Itoa(fallback)))
	if err != nil || v < minimum || v > maximum {
		return 0, fmt.Errorf("%s must be an integer from %d to %d", key, minimum, maximum)
	}
	return time.Duration(v) * time.Second, nil
}
