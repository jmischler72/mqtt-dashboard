package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

// allowedImageExts is the whitelist of image file extensions accepted for
// upload, preset listing, and serving.
var allowedImageExts = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".gif":  {},
	".webp": {},
	".svg":  {},
}

// maxImageUpload caps the in-memory portion of a multipart upload (8 MiB).
const maxImageUpload = 8 << 20

// ImageHandler manages visual-panel images stored under <dataDir>/images.
type ImageHandler struct {
	dir string
}

// NewImageHandler creates the image handler, ensuring the images directory
// exists under the given data directory (mirrors the ./data creation in main).
func NewImageHandler(dataDir string) *ImageHandler {
	dir := filepath.Join(dataDir, "images")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		// Non-fatal: handler still constructs; operations will surface errors.
		return &ImageHandler{dir: dir}
	}
	return &ImageHandler{dir: dir}
}

type imageEntry struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// sanitizeImageName returns a safe base filename with a whitelisted extension,
// or an empty string if the name is invalid (path traversal, bad extension).
func sanitizeImageName(name string) string {
	base := filepath.Base(name)
	if base == "." || base == "/" || base == ".." || strings.Contains(base, "..") {
		return ""
	}
	ext := strings.ToLower(filepath.Ext(base))
	if _, ok := allowedImageExts[ext]; !ok {
		return ""
	}
	return base
}

// UploadImage handles POST /api/images (multipart/form-data, field "file").
func (h *ImageHandler) UploadImage(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxImageUpload); err != nil {
		http.Error(w, "invalid multipart form", http.StatusBadRequest)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "missing file field", http.StatusBadRequest)
		return
	}
	defer file.Close()

	name := sanitizeImageName(header.Filename)
	if name == "" {
		http.Error(w, "unsupported file type", http.StatusBadRequest)
		return
	}

	dst, err := os.Create(filepath.Join(h.dir, name))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(imageEntry{Name: name, URL: "/api/images/" + name})
}

// ListPresets handles GET /api/images/presets by scanning the images directory.
func (h *ImageHandler) ListPresets(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(h.dir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	presets := []imageEntry{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if _, ok := allowedImageExts[ext]; !ok {
			continue
		}
		presets = append(presets, imageEntry{Name: e.Name(), URL: "/api/images/" + e.Name()})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(presets)
}

// ServeImage handles GET /api/images/{filename}.
func (h *ImageHandler) ServeImage(w http.ResponseWriter, r *http.Request) {
	name := sanitizeImageName(chi.URLParam(r, "filename"))
	if name == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	path := filepath.Join(h.dir, name)
	if _, err := os.Stat(path); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	http.ServeFile(w, r, path)
}

// DeleteImage handles DELETE /api/images/{filename}.
func (h *ImageHandler) DeleteImage(w http.ResponseWriter, r *http.Request) {
	name := sanitizeImageName(chi.URLParam(r, "filename"))
	if name == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := os.Remove(filepath.Join(h.dir, name)); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
