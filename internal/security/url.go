package security

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
)

func ValidateWebhookURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, errors.New("webhook URL must be an absolute HTTPS URL without userinfo or fragment")
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, errors.New("invalid webhook port")
		}
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if host == "" {
		return nil, errors.New("webhook hostname is required")
	}
	if ip := net.ParseIP(host); ip != nil && !isPublicIP(ip) {
		return nil, errors.New("webhook IP address must be public")
	}
	return u, nil
}
func isPublicIP(ip net.IP) bool {
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
