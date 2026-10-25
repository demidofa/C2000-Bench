// Стенд C2000: локальная оболочка учебного симулятора.
// Встроенные страницы отдаются с 127.0.0.1, окно открывается в Microsoft Edge
// (или Chrome) в режиме приложения. Программа завершается, когда окно закрыто.
package main

import (
	"embed"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

const (
	fixedPort = "47820"
	appID     = "stend-c2000"
)

var lastBeat atomic.Int64

func findBrowser() string {
	env := func(k string) string { return os.Getenv(k) }
	cands := []string{
		filepath.Join(env("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("LOCALAPPDATA"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(env("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(env("ProgramFiles(x86)"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(env("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
	}
	for _, p := range cands {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func openWindow(url string, page string) {
	full := url + page
	if b := findBrowser(); b != "" {
		profile := filepath.Join(os.Getenv("LOCALAPPDATA"), "StendC2000", "browser")
		_ = os.MkdirAll(profile, 0o755)
		cmd := exec.Command(b,
			"--app="+full,
			"--user-data-dir="+profile,
			"--no-first-run",
			"--no-default-browser-check",
			"--disable-features=Translate",
			"--window-size=1500,960",
		)
		if err := cmd.Start(); err == nil {
			return
		}
	}
	// запасной вариант: браузер по умолчанию
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", full).Start()
}

// уже запущенный экземпляр на фиксированном порту
func existing() bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	r, err := c.Get("http://127.0.0.1:" + fixedPort + "/api/ping")
	if err != nil {
		return false
	}
	defer r.Body.Close()
	buf := make([]byte, 32)
	n, _ := r.Body.Read(buf)
	return strings.TrimSpace(string(buf[:n])) == appID
}

func main() {
	page := "index.html"
	for _, a := range os.Args[1:] {
		if a == "--slides" || a == "/slides" {
			page = "slides.html"
		}
	}

	if existing() {
		openWindow("http://127.0.0.1:"+fixedPort+"/", page)
		return
	}

	ln, err := net.Listen("tcp", "127.0.0.1:"+fixedPort)
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			msgBox("Не удалось открыть локальный порт: " + err.Error())
			os.Exit(1)
		}
	}
	base := "http://" + ln.Addr().String() + "/"

	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(appID))
	})
	mux.HandleFunc("/api/beat", func(w http.ResponseWriter, r *http.Request) {
		lastBeat.Store(time.Now().UnixMilli())
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			msgBox("Ошибка локального сервера: " + err.Error())
			os.Exit(1)
		}
	}()

	openWindow(base, page)

	// Окна присылают отметку каждые 2 с. Нет отметок 12 с - все окна закрыты.
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		lb := lastBeat.Load()
		if lb == 0 {
			if time.Since(start) > 90*time.Second {
				msgBox("Окно стенда не открылось. Установите Microsoft Edge или Google Chrome и запустите программу снова.\n\nАдрес стенда: " + base)
				return
			}
			continue
		}
		if time.Since(time.UnixMilli(lb)) > 12*time.Second {
			return
		}
	}
}
