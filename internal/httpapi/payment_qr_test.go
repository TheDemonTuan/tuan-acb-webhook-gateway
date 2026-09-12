package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/thedemontuan/acb-transaction-webhook/internal/config"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

func TestPaymentQRLifecycle(t *testing.T) {
	ctx := context.Background()
	dbDir := t.TempDir()
	dbPath := filepath.Join(dbDir, "test_qr.db")
	store, err := storage.Open(ctx, dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()

	connID := "conn_qr_test"
	if _, err := store.DB().ExecContext(ctx, `
		INSERT INTO connections(id, state, generation, created_at, updated_at)
		VALUES(?, 'MONITORING', 1, '2026-09-12T00:00:00Z', '2026-09-12T00:00:00Z')
	`, connID); err != nil {
		t.Fatalf("insert connection: %v", err)
	}

	srv := New(config.Config{
		Timezone:           time.UTC,
		DevelopmentSubject: "owner",
		DatabasePath:       dbPath,
	}, store)

	// 1. Initial GET /api/v1/payment-qr -> configured: false
	reqGet := httptest.NewRequest(http.MethodGet, "/api/v1/payment-qr", nil)
	recGet := httptest.NewRecorder()
	srv.handler.ServeHTTP(recGet, reqGet)
	if recGet.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recGet.Code)
	}
	var getResp map[string]any
	_ = json.Unmarshal(recGet.Body.Bytes(), &getResp)
	if getResp["configured"] != false {
		t.Errorf("expected configured: false initially")
	}

	// 2. Upload valid PNG
	csrfReq := httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/csrf", nil)
	csrfRec := httptest.NewRecorder()
	srv.handler.ServeHTTP(csrfRec, csrfReq)
	cookie := csrfRec.Result().Cookies()[0]
	var token struct{ Token string }
	_ = json.NewDecoder(csrfRec.Result().Body).Decode(&token)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("accountNumber", "123456789")
	_ = writer.WriteField("accountName", "NGUYEN VAN A")
	part, _ := writer.CreateFormFile("image", "qr.png")

	// 1x1 valid PNG bytes
	pngBytes := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
		0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	}
	_, _ = part.Write(pngBytes)
	_ = writer.Close()

	reqUpload := httptest.NewRequest(http.MethodPost, "http://example.test/api/v1/payment-qr/upload", body)
	reqUpload.Header.Set("Content-Type", writer.FormDataContentType())
	reqUpload.Header.Set("Origin", "http://example.test")
	reqUpload.Header.Set("X-CSRF-Token", token.Token)
	reqUpload.AddCookie(cookie)
	recUpload := httptest.NewRecorder()
	srv.handler.ServeHTTP(recUpload, reqUpload)

	if recUpload.Code != http.StatusOK {
		t.Fatalf("expected 200 for upload, got %d: %s", recUpload.Code, recUpload.Body.String())
	}

	// 3. GET /api/v1/payment-qr -> configured: true, hasImage: true
	reqGet2 := httptest.NewRequest(http.MethodGet, "/api/v1/payment-qr", nil)
	recGet2 := httptest.NewRecorder()
	srv.handler.ServeHTTP(recGet2, reqGet2)
	if recGet2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recGet2.Code)
	}
	var getResp2 map[string]any
	_ = json.Unmarshal(recGet2.Body.Bytes(), &getResp2)
	if getResp2["configured"] != true || getResp2["hasImage"] != true {
		t.Errorf("expected configured: true, hasImage: true, got %v", getResp2)
	}

	// 4. GET /api/v1/payment-qr/image -> 200 with image/png
	reqImg := httptest.NewRequest(http.MethodGet, "/api/v1/payment-qr/image", nil)
	recImg := httptest.NewRecorder()
	srv.handler.ServeHTTP(recImg, reqImg)
	if recImg.Code != http.StatusOK {
		t.Fatalf("expected 200 for image, got %d", recImg.Code)
	}
	if recImg.Header().Get("Content-Type") != "image/png" {
		t.Errorf("expected image/png content type, got %s", recImg.Header().Get("Content-Type"))
	}
	if recImg.Header().Get("ETag") == "" {
		t.Errorf("expected ETag header on image")
	}

	// 5. Delete QR
	reqDel := httptest.NewRequest(http.MethodDelete, "http://example.test/api/v1/payment-qr", nil)
	reqDel.Header.Set("Origin", "http://example.test")
	reqDel.Header.Set("X-CSRF-Token", token.Token)
	reqDel.AddCookie(cookie)
	recDel := httptest.NewRecorder()
	srv.handler.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 for delete, got %d", recDel.Code)
	}

	// 6. GET /api/v1/payment-qr after delete -> configured: false
	reqGet3 := httptest.NewRequest(http.MethodGet, "/api/v1/payment-qr", nil)
	recGet3 := httptest.NewRecorder()
	srv.handler.ServeHTTP(recGet3, reqGet3)
	var getResp3 map[string]any
	_ = json.Unmarshal(recGet3.Body.Bytes(), &getResp3)
	if getResp3["configured"] != false {
		t.Errorf("expected configured: false after delete")
	}
}
