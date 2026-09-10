package httpui

import "embed"

// Files contains the frontend bundle produced by `bun run build` in web/.
//
//go:embed dist
var Files embed.FS
