package webhook

import (
	"testing"
	"time"
)

func TestSignAndVerify(t *testing.T) {
	body := []byte(`{"id":"bevt_test"}`)
	at := time.Unix(1_700_000_000, 0)
	signed := Sign([]byte("01234567890123456789012345678901"), body, at, "nonce")
	if err := Verify([]byte("01234567890123456789012345678901"), body, signed.Timestamp, signed.Nonce, signed.Signature, at.Add(time.Minute), 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := Verify([]byte("wrong"), body, signed.Timestamp, signed.Nonce, signed.Signature, at, 5*time.Minute); err == nil {
		t.Fatal("accepted invalid secret")
	}
}
func TestURLGuards(t *testing.T) {
	if _, err := ValidateURL("https://127.0.0.1/x"); err == nil {
		t.Fatal("loopback accepted")
	}
	if _, err := ValidateURL("https://receiver.example.com/x"); err != nil {
		t.Fatal(err)
	}
}
func TestStableEventID(t *testing.T) {
	if StableEventID("ns", "tx", "bank.transaction.credit") != StableEventID("ns", "tx", "bank.transaction.credit") {
		t.Fatal("not stable")
	}
	if StableEventID("ns", "tx", "bank.transaction.credit") == StableEventID("ns", "tx2", "bank.transaction.credit") {
		t.Fatal("collision")
	}
}
