package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

const EnvelopeVersion = "v1"

type Keyring struct {
	currentID string
	keys      map[string][]byte
}
type Envelope struct{ Version, KeyID, Nonce, Ciphertext string }

func LoadKeyring(path string) (*Keyring, error) {
	if path == "" {
		return nil, errors.New("master key file is not configured")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read master key: %w", err)
	}
	key, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(string(b)))
	if err != nil {
		return nil, errors.New("master key must be raw base64")
	}
	if len(key) != 32 {
		return nil, errors.New("master key must be 32 bytes")
	}
	return &Keyring{currentID: "k1", keys: map[string][]byte{"k1": key}}, nil
}

func (k *Keyring) Encrypt(plaintext, aad []byte) (Envelope, error) {
	key := k.keys[k.currentID]
	block, err := aes.NewCipher(key)
	if err != nil {
		return Envelope{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return Envelope{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return Envelope{}, err
	}
	return Envelope{Version: EnvelopeVersion, KeyID: k.currentID, Nonce: base64.RawStdEncoding.EncodeToString(nonce), Ciphertext: base64.RawStdEncoding.EncodeToString(gcm.Seal(nil, nonce, plaintext, aad))}, nil
}
func (k *Keyring) Decrypt(e Envelope, aad []byte) ([]byte, error) {
	if e.Version != EnvelopeVersion {
		return nil, errors.New("unsupported envelope version")
	}
	key, ok := k.keys[e.KeyID]
	if !ok {
		return nil, errors.New("unknown key id")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.RawStdEncoding.DecodeString(e.Nonce)
	if err != nil {
		return nil, errors.New("invalid nonce")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(e.Ciphertext)
	if err != nil {
		return nil, errors.New("invalid ciphertext")
	}
	return gcm.Open(nil, nonce, ciphertext, aad)
}
func VerifyHMAC(expected, actual []byte) bool {
	return subtle.ConstantTimeCompare(expected, actual) == 1
}
