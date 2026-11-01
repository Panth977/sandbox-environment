package daemon

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

// Hosts reports whether host is on an allowlist. "*.x.com" matches subdomains only.
func hostAllowed(host string, allow []string) bool {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	for _, a := range allow {
		a = strings.ToLower(a)
		if a == host || (strings.HasPrefix(a, "*.") && strings.HasSuffix(host, a[1:])) {
			return true
		}
	}
	return false
}

// publicIP refuses every address that is not plainly on the public internet, so an
// allowed name that resolves to a private address, or to cloud metadata, goes nowhere.
func publicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		cgnat := v4[0] == 100 && v4[1]&0xc0 == 64
		return !cgnat && v4[0] != 0 && v4[0] < 224
	}
	return true
}

type proxyEvent struct {
	Host     string `json:"host"`
	Allowed  bool   `json:"allowed"`
	BytesIn  int64  `json:"bytesIn"`
	BytesOut int64  `json:"bytesOut"`
	Cap      bool   `json:"cap,omitempty"`
	Ready    bool   `json:"ready,omitempty"`
}

// countingCopy copies until EOF or until the shared budget runs out.
func countingCopy(dst io.Writer, src io.Reader, n, total *atomic.Int64, max int64) error {
	buf := make([]byte, 32*1024)
	for {
		r, err := src.Read(buf)
		if r > 0 {
			n.Add(int64(r))
			if total.Add(int64(r)) > max {
				return fmt.Errorf("cap")
			}
			if _, werr := dst.Write(buf[:r]); werr != nil {
				return werr
			}
		}
		if err != nil {
			return nil
		}
	}
}

// RunProxy is the egress door of one run: CONNECT only, allowlisted names only,
// public addresses only, port 443 only, with a byte budget. Each outcome is one JSON line.
func RunProxy(listen string, allow []string, maxBytes int64, out io.Writer) error {
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(out)
	enc.Encode(proxyEvent{Ready: true})
	var total atomic.Int64
	for {
		c, err := ln.Accept()
		if err != nil {
			return err
		}
		go func() {
			defer c.Close()
			c.SetDeadline(time.Now().Add(10 * time.Second))
			br := bufio.NewReader(c)
			req, err := http.ReadRequest(br)
			if err != nil {
				return
			}
			host, port, err := net.SplitHostPort(req.Host)
			if req.Method != http.MethodConnect || err != nil || port != "443" || !hostAllowed(host, allow) {
				enc.Encode(proxyEvent{Host: req.Host})
				io.WriteString(c, "HTTP/1.1 403 Forbidden\r\n\r\n")
				return
			}
			ips, err := net.LookupIP(host)
			var target net.IP
			for _, ip := range ips {
				if publicIP(ip) {
					target = ip
					break
				}
			}
			if err != nil || target == nil {
				enc.Encode(proxyEvent{Host: host})
				io.WriteString(c, "HTTP/1.1 403 Forbidden\r\n\r\n")
				return
			}
			up, err := net.DialTimeout("tcp", net.JoinHostPort(target.String(), port), 10*time.Second)
			if err != nil {
				io.WriteString(c, "HTTP/1.1 502 Bad Gateway\r\n\r\n")
				return
			}
			defer up.Close()
			c.SetDeadline(time.Time{})
			io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
			var in, outb atomic.Int64
			done := make(chan error, 2)
			go func() { done <- countingCopy(up, br, &outb, &total, maxBytes) }()
			go func() { done <- countingCopy(c, up, &in, &total, maxBytes) }()
			e := <-done
			enc.Encode(proxyEvent{Host: host, Allowed: true, BytesIn: in.Load(), BytesOut: outb.Load(), Cap: e != nil && e.Error() == "cap"})
		}()
	}
}

// ProxyMain is `sandboxd proxy`.
func ProxyMain(allow string, maxBytes int64) error {
	return RunProxy(":3128", strings.Split(allow, ","), maxBytes, os.Stdout)
}
