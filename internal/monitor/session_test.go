package monitor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type recordingRestorer struct{ cookies []authbrowser.Cookie }

func (r *recordingRestorer) RestoreCookies(cookies []authbrowser.Cookie) error {
	r.cookies = cookies
	return nil
}

func TestSessionLoaderDecryptsAndRestoresCurrentGeneration(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	keyFile := filepath.Join(dir, "key")
	key := "0123456789012345678901234567890123456789012345678901234567890123"
	if err := os.WriteFile(keyFile, []byte(key), 0o600); err != nil {
		t.Fatal(err)
	}
	keyring, err := security.LoadKeyring(keyFile)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, filepath.Join(dir, "gateway.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	connection, err := store.ConfigureConnection(ctx, "***1234")
	if err != nil {
		t.Fatal(err)
	}
	attempt, err := store.StartAuthAttempt(ctx, "owner@example.com", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	cookies, _ := json.Marshal([]authbrowser.Cookie{{Name: "session", Value: "secret", Domain: ".online.acb.com.vn", Path: "/", Secure: true}})
	plaintext := []byte(base64.RawURLEncoding.EncodeToString(cookies) + ".handoff")
	envelope, err := keyring.Encrypt(plaintext, []byte("acb-session:"+connection.ID))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(envelope)
	if _, err := store.CompleteAuthSession(ctx, attempt.ID, encoded); err != nil {
		t.Fatal(err)
	}
	restorer := &recordingRestorer{}
	loader := NewSessionLoader(store, keyring, restorer)
	if err := loader.Restore(ctx, connection.ID, attempt.Generation); err != nil {
		t.Fatal(err)
	}
	if len(restorer.cookies) != 1 || restorer.cookies[0].Value != "secret" {
		t.Fatalf("cookies=%+v", restorer.cookies)
	}
}
