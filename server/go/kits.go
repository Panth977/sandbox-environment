// Package kits carries the child kits, so sandboxd can place them in each build.
package sandboxkits

import "embed"

// FS holds the JS, Python and Go child kits.
//
//go:embed kits/js/* kits/python/* sbxkit/*.go
var FS embed.FS
