//go:build windows

package lock

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

type FileLock struct{ file *os.File }

func Acquire(path string) (*FileLock, error) {
	return acquire(path, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY)
}

func AcquireShared(path string) (*FileLock, error) {
	return acquire(path, windows.LOCKFILE_FAIL_IMMEDIATELY)
}

func acquire(path string, flags uint32) (*FileLock, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	var overlapped windows.Overlapped
	err = windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, &overlapped)
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("gateway lock unavailable at %s: %w", path, err)
	}
	return &FileLock{file: f}, nil
}

func (l *FileLock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	var overlapped windows.Overlapped
	_ = windows.UnlockFileEx(windows.Handle(l.file.Fd()), 0, 1, 0, &overlapped)
	return l.file.Close()
}
