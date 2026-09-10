package security

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestKeyringEncryptDecryptBindsAAD(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	path := filepath.Join(dir, "master.key")
	if err := os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(key)), 0o600); err != nil {
		t.Fatal(err)
	}
	keyring, err := LoadKeyring(path)
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := keyring.Encrypt([]byte("sensitive state"), []byte("session:connection-1:generation-2"))
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := keyring.Decrypt(envelope, []byte("session:connection-1:generation-2"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(plaintext); got != "sensitive state" {
		t.Fatalf("plaintext = %q", got)
	}
	if _, err := keyring.Decrypt(envelope, []byte("session:connection-1:generation-3")); err == nil {
		t.Fatal("decrypt succeeded with different AAD")
	}
}

func TestLoadKeyringRejectsWrongSize(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "master.key")
	if err := os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(make([]byte, 31))), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadKeyring(path); err == nil {
		t.Fatal("expected wrong-size key failure")
	}
}
