package webhook

import (
	"context"
	"net/http"

	"github.com/thedemontuan/acb-transaction-webhook/internal/notification"
	"github.com/thedemontuan/acb-transaction-webhook/internal/storage"
)

type Dispatcher struct {
	inner      *notification.Dispatcher
	sender     *Sender
	maxRetries int
}

func NewDispatcher(store *storage.Store, client *http.Client) *Dispatcher {
	sender := NewSender(client, false)
	reg := notification.NewRegistry()
	reg.Register("WEBHOOK", sender)
	inner := notification.NewDispatcher(store, reg)
	return &Dispatcher{
		inner:  inner,
		sender: sender,
	}
}

func (d *Dispatcher) SetSkipURLValidation(skip bool) *Dispatcher {
	d.sender.skipURLValidation = skip
	return d
}

func (d *Dispatcher) SetMaxRetries(n int) *Dispatcher {
	d.maxRetries = n
	d.inner.SetMaxRetries(n)
	return d
}

func (d *Dispatcher) Wake() {
	d.inner.Wake()
}

func (d *Dispatcher) Start(ctx context.Context) {
	if d.maxRetries > 0 {
		d.inner.SetMaxRetries(d.maxRetries)
	}
	d.inner.Start(ctx)
}

func (d *Dispatcher) Run(ctx context.Context) {
	d.Start(ctx)
}

func (d *Dispatcher) DispatchOne(ctx context.Context) (bool, error) {
	if d.maxRetries > 0 {
		d.inner.SetMaxRetries(d.maxRetries)
	}
	return d.inner.DispatchOne(ctx)
}
