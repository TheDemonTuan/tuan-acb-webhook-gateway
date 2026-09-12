//go:build !windows

package lock

import (
	"fmt"
	"os"
	"syscall"
)

type FileLock struct{ file *os.File }

func Acquire(path string) (*FileLock, error) {
	return acquire(path, syscall.LOCK_EX|syscall.LOCK_NB)
}

func AcquireShared(path string) (*FileLock, error) {
	return acquire(path, syscall.LOCK_SH|syscall.LOCK_NB)
}

func acquire(path string, mode int) (*FileLock, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), mode); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("gateway lock unavailable at %s: %w", path, err)
	}
	return &FileLock{file: f}, nil
}

func (l *FileLock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	_ = syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
	return l.file.Close()
}
