package security

import "testing"

func TestValidateWebhookURL(t *testing.T) {
	for _, raw := range []string{"http://events.example.com", "https://127.0.0.1/a", "https://169.254.169.254/latest", "https://user@example.com", "https://[::1]/"} {
		if _, err := ValidateWebhookURL(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if _, err := ValidateWebhookURL("https://events.example.com/bank"); err != nil {
		t.Fatal(err)
	}
}
