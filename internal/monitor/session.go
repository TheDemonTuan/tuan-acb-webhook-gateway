package monitor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type CookieRestorer interface {
	RestoreCookies([]authbrowser.Cookie) error
}

type SessionLoader struct {
	store    *storage.Store
	keyring  *security.Keyring
	restorer CookieRestorer
}

func NewSessionLoader(store *storage.Store, keyring *security.Keyring, restorer CookieRestorer) *SessionLoader {
	return &SessionLoader{store: store, keyring: keyring, restorer: restorer}
}

// Restore loads only the encrypted session for the current connection
// generation. It rejects stale, malformed or cross-connection browser state.
func (l *SessionLoader) Restore(ctx context.Context, connectionID string, generation int64) error {
	if l == nil || l.keyring == nil || l.restorer == nil {
		return errors.New("ACB session loader is unavailable")
	}
	stored, err := l.store.Session(ctx, connectionID, generation)
	if err != nil {
		return err
	}
	var envelope security.Envelope
	if err := json.Unmarshal(stored.Envelope, &envelope); err != nil {
		return errors.New("stored ACB session envelope is invalid")
	}
	plaintext, err := l.keyring.Decrypt(envelope, []byte("acb-session:"+connectionID))
	if err != nil {
		return errors.New("stored ACB session cannot be decrypted")
	}
	encodedCookies, _, ok := strings.Cut(string(plaintext), ".")
	if !ok || encodedCookies == "" {
		return errors.New("stored ACB session handoff is invalid")
	}
	cookieJSON, err := base64.RawURLEncoding.DecodeString(encodedCookies)
	if err != nil {
		return errors.New("stored ACB session cookies are invalid")
	}
	var cookies []authbrowser.Cookie
	if err := json.Unmarshal(cookieJSON, &cookies); err != nil || len(cookies) == 0 {
		return errors.New("stored ACB session has no valid cookies")
	}
	return l.restorer.RestoreCookies(cookies)
}
