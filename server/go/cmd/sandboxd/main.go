// sandboxd runs untrusted code under limits. See server/README.md.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/Panth977/sandbox-environment/server/go/internal/daemon"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "proxy" {
		fs := flag.NewFlagSet("proxy", flag.ExitOnError)
		allow := fs.String("allow", "", "hosts")
		bytes := fs.Int64("bytes", 64<<20, "byte budget")
		fs.Parse(os.Args[2:])
		log.Fatal(daemon.ProxyMain(*allow, *bytes))
	}
	var c daemon.Config
	flag.StringVar(&c.Socket, "socket", "/run/sandboxd.sock", "unix socket")
	flag.StringVar(&c.TLSAddr, "tls-addr", "", "host:port for TLS parents")
	flag.StringVar(&c.TLSCert, "tls-cert", "", "TLS certificate file")
	flag.StringVar(&c.TLSKey, "tls-key", "", "TLS key file")
	flag.StringVar(&c.Driver, "driver", "docker", "docker, or direct: gVisor with no Docker (Cloud Run)")
	flag.StringVar(&c.Runsc, "runsc", "runsc", "runsc binary, direct driver")
	flag.StringVar(&c.Docker, "docker", "docker", "docker CLI")
	flag.StringVar(&c.DockerSock, "docker-sock", "/var/run/docker.sock", "docker socket, for stats")
	flag.StringVar(&c.Runtime, "runtime", "runsc", "container runtime")
	flag.StringVar(&c.DataDir, "data-dir", "/var/lib/sandboxd", "bundle folder, visible to dockerd")
	flag.StringVar(&c.ProxyBinary, "proxy-binary", "", "static linux sandboxd for the egress proxy; default this binary")
	unsafe := flag.Bool("unsafe-no-gvisor", false, "allow a runtime other than runsc; never for untrusted code")
	flag.Parse()
	c.Token = os.Getenv("SANDBOXD_TOKEN")
	if c.Runtime != "runsc" && !*unsafe {
		fmt.Fprintln(os.Stderr, "refusing to start: --runtime", c.Runtime, "shares the host kernel; pass --unsafe-no-gvisor for local development only")
		os.Exit(2)
	}
	if c.ProxyBinary == "" {
		if self, err := os.Executable(); err == nil && !strings.Contains(self, "go-build") {
			c.ProxyBinary = self
		}
	}
	log.Fatal(daemon.New(c).Serve())
}
