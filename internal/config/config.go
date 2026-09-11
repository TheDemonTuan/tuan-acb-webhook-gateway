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
	PollMinInterval    time.Duration
	PollMaxInterval    time.Duration
	CloudflareIssuer   string
	CloudflareAudience string
	CloudflareJWKSURL  string
	Roles              RoleSubjects
	DevelopmentSubject string
	Production         bool
	AuthBrowserURL     string
	AuthBrowserVNCURL  string
}

func Load() (Config, error) {
	loc, err := time.LoadLocation(value("TZ", "Asia/Ho_Chi_Minh"))
	if err != nil {
		return Config{}, fmt.Errorf("load timezone: %w", err)
	}
	pollMin, err := seconds("POLL_MIN_INTERVAL_SEC", 10, 5, 300)
	if err != nil {
		return Config{}, err
	}
	pollMax, err := seconds("POLL_MAX_INTERVAL_SEC", 30, 5, 300)
	if err != nil {
		return Config{}, err
	}
	if pollMin > pollMax {
		return Config{}, fmt.Errorf("POLL_MIN_INTERVAL_SEC must be less than or equal to POLL_MAX_INTERVAL_SEC")
	}
	dataDir := value("DATA_DIR", "data")
	production := value("APP_ENV", "development") == "production"

	cfTeam := os.Getenv("CLOUDFLARE_ACCESS_TEAM_NAME")
	cfIssuer := strings.TrimSuffix(os.Getenv("CF_ACCESS_ISSUER"), "/")
	if cfIssuer == "" && cfTeam != "" {
		cfIssuer = fmt.Sprintf("https://%s.cloudflareaccess.com", cfTeam)
	}
	cfAud := os.Getenv("CF_ACCESS_AUDIENCE")
	if cfAud == "" {
		cfAud = os.Getenv("CLOUDFLARE_ACCESS_AUD")
	}
	cfJWKS := os.Getenv("CF_ACCESS_JWKS_URL")
	if cfJWKS == "" && cfTeam != "" {
		cfJWKS = fmt.Sprintf("https://%s.cloudflareaccess.com/cdn-cgi/access/certs", cfTeam)
	}

	masterKeyFile := os.Getenv("APP_MASTER_KEY_FILE")
	if masterKeyFile == "" && os.Getenv("APP_MASTER_KEY") != "" {
		autoKey := filepath.Join(dataDir, "app_master_key")
		_ = os.MkdirAll(dataDir, 0o700)
		_ = os.WriteFile(autoKey, []byte(os.Getenv("APP_MASTER_KEY")), 0o600)
		masterKeyFile = autoKey
	}

	owners := set("OWNER_SUBJECTS")
	if len(owners) == 0 {
		if ownerDefault := os.Getenv("CLOUDFLARE_ACCESS_OWNER_EMAIL"); ownerDefault != "" {
			owners[ownerDefault] = struct{}{}
		}
	}

	cfg := Config{
		Address:            value("LISTEN_ADDR", "0.0.0.0:"+value("PORT", "8090")),
		DatabasePath:       value("DATABASE_PATH", filepath.Join(dataDir, "gateway.db")),
		MasterKeyFile:      masterKeyFile,
		Timezone:           loc,
		PollMinInterval:    pollMin,
		PollMaxInterval:    pollMax,
		CloudflareIssuer:   cfIssuer,
		CloudflareAudience: cfAud,
		CloudflareJWKSURL:  cfJWKS,
		Roles: RoleSubjects{
			Owners:    owners,
			Operators: set("OPERATOR_SUBJECTS"),
			Viewers:   set("VIEWER_SUBJECTS"),
		},
		DevelopmentSubject: value("DEVELOPMENT_SUBJECT", "local-owner"),
		Production:         production,
		AuthBrowserURL:     value("AUTH_BROWSER_URL", "http://auth-browser:8181"),
		AuthBrowserVNCURL:  value("AUTH_BROWSER_VNC_URL", "http://auth-browser:6080"),
	}
	if production {
		if cfg.MasterKeyFile == "" {
			return Config{}, fmt.Errorf("APP_MASTER_KEY_FILE is required in production")
		}
		if len(cfg.Roles.Owners) == 0 {
			return Config{}, fmt.Errorf("OWNER_SUBJECTS is required in production")
		}
		if cfg.CloudflareIssuer == "" || cfg.CloudflareAudience == "" || cfg.CloudflareJWKSURL == "" || cfg.CloudflareAudience == "*" || strings.EqualFold(cfg.CloudflareAudience, "any") {
			return Config{}, fmt.Errorf("specific Cloudflare Access issuer, audience, and JWKS URL are required in production")
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
