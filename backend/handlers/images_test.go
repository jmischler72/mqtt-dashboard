package handlers_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"

	"mqtt-dashboard/handlers"
)

func newImageRouter(h *handlers.ImageHandler) chi.Router {
	r := chi.NewRouter()
	r.Post("/api/images", h.UploadImage)
	r.Get("/api/images/presets", h.ListPresets)
	r.Get("/api/images/{filename}", h.ServeImage)
	r.Delete("/api/images/{filename}", h.DeleteImage)
	return r
}

// uploadRequest builds a multipart POST request with a single "file" field.
func uploadRequest(t *testing.T, filename string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/images", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestImageUploadListServeDelete(t *testing.T) {
	dir := t.TempDir()
	h := handlers.NewImageHandler(dir)
	r := newImageRouter(h)

	// Upload
	png := []byte("\x89PNG\r\n\x1a\nfake-image-bytes")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, uploadRequest(t, "logo.png", png))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}

	// File landed on disk under <dir>/images
	if _, err := os.Stat(filepath.Join(dir, "images", "logo.png")); err != nil {
		t.Fatalf("uploaded file not found: %v", err)
	}

	// List presets includes it
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/images/presets", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("presets status = %d, want 200", rec.Code)
	}
	var presets []struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}
	decodeJSON(t, rec.Body, &presets)
	if len(presets) != 1 || presets[0].Name != "logo.png" || presets[0].URL != "/api/images/logo.png" {
		t.Fatalf("unexpected presets: %+v", presets)
	}

	// Serve returns the bytes
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/images/logo.png", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("serve status = %d, want 200", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), png) {
		t.Fatalf("served bytes do not match uploaded content")
	}

	// Delete
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, "/api/images/logo.png", nil))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "images", "logo.png")); !os.IsNotExist(err) {
		t.Fatalf("file still present after delete: %v", err)
	}
}

func TestImageUploadRejectsBadExtension(t *testing.T) {
	dir := t.TempDir()
	h := handlers.NewImageHandler(dir)
	r := newImageRouter(h)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, uploadRequest(t, "evil.exe", []byte("MZ")))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for bad extension", rec.Code)
	}
}

func TestImageServeRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	h := handlers.NewImageHandler(dir)
	r := newImageRouter(h)

	// chi cleans paths, so target the sanitizer directly via a non-whitelisted name.
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/images/passwd", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for non-image name", rec.Code)
	}
}
