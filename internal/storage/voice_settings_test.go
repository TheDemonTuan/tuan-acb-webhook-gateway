package storage

import (
	"context"
	"path/filepath"
	"testing"
)

func TestVoiceSettingsLifecycle(t *testing.T) {
	ctx := context.Background()
	dbDir := t.TempDir()
	dbPath := filepath.Join(dbDir, "test_voice_settings.db")

	store, err := Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer store.Close()

	// 1. Initial read should return default settings
	settings, err := store.GetVoiceSettings(ctx)
	if err != nil {
		t.Fatalf("GetVoiceSettings failed: %v", err)
	}
	if settings.Revision != 1 {
		t.Errorf("expected revision 1, got %d", settings.Revision)
	}
	if settings.ProviderMode != "ONLINE_AUTO" {
		t.Errorf("expected ONLINE_AUTO, got %s", settings.ProviderMode)
	}
	if settings.EdgeVoice != "vi-VN-HoaiMyNeural" {
		t.Errorf("expected vi-VN-HoaiMyNeural, got %s", settings.EdgeVoice)
	}

	// 2. Save modified settings
	settings.EdgeVoice = "vi-VN-NamMinhNeural"
	settings.ProviderMode = "EDGE_ONLY"
	saved, err := store.SaveVoiceSettings(ctx, settings)
	if err != nil {
		t.Fatalf("SaveVoiceSettings failed: %v", err)
	}
	if saved.Revision != 2 {
		t.Errorf("expected revision 2, got %d", saved.Revision)
	}
	if saved.EdgeVoice != "vi-VN-NamMinhNeural" {
		t.Errorf("expected vi-VN-NamMinhNeural, got %s", saved.EdgeVoice)
	}

	// 3. Stale revision save should conflict
	stale := settings
	stale.Revision = 1
	_, err = store.SaveVoiceSettings(ctx, stale)
	if err != ErrVoiceSettingsConflict {
		t.Errorf("expected ErrVoiceSettingsConflict, got %v", err)
	}

	// 4. Invalid providerMode or voice should fail validation
	invalid := saved
	invalid.ProviderMode = "INVALID"
	_, err = store.SaveVoiceSettings(ctx, invalid)
	if err == nil {
		t.Error("expected error for invalid providerMode, got nil")
	}

	invalidVoice := saved
	invalidVoice.EdgeVoice = "en-US-Jenny"
	_, err = store.SaveVoiceSettings(ctx, invalidVoice)
	if err == nil {
		t.Error("expected error for invalid edgeVoice, got nil")
	}
}
