package monitor

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/thedemontuan/tuan-bank-gateway/internal/authbrowser"
	"github.com/thedemontuan/tuan-bank-gateway/internal/security"
	"github.com/thedemontuan/tuan-bank-gateway/internal/storage"
)

type SessionRestorer interface {
	RestoreSession(authbrowser.Handoff) error
}

type SessionLoader struct {
	store            *storage.Store
	keyring          *security.Keyring
	restorer         SessionRestorer
	mu               sync.Mutex
	loadedID         string
	loadedGeneration int64
}

func NewSessionLoader(store *storage.Store, keyring *security.Keyring, restorer SessionRestorer) *SessionLoader {
	return &SessionLoader{store: store, keyring: keyring, restorer: restorer}
}

// Restore loads only the encrypted session for the current connection
// generation. It rejects stale, malformed or cross-connection browser state.
func (l *SessionLoader) Restore(ctx context.Context, connectionID string, generation int64) error {
	if l == nil || l.keyring == nil || l.restorer == nil {
		return errors.New("ACB session loader is unavailable")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.loadedID == connectionID && l.loadedGeneration == generation {
		return nil
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
	handoff, err := authbrowser.DecodeHandoff(string(plaintext))
	if err != nil {
		return errors.New("stored ACB session handoff is invalid")
	}
	if err := l.restorer.RestoreSession(handoff); err != nil {
		return err
	}
	l.loadedID = connectionID
	l.loadedGeneration = generation
	return nil
}
