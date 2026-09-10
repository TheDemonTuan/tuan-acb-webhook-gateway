package authbrowser

import "time"

// Cookie is the minimal, serializable browser state handed from the private
// Chromium controller to the Go bank client. It is never returned to the UI.
type Cookie struct {
	Name     string    `json:"name"`
	Value    string    `json:"value"`
	Domain   string    `json:"domain"`
	Path     string    `json:"path"`
	Expires  time.Time `json:"expires,omitempty"`
	Secure   bool      `json:"secure"`
	HTTPOnly bool      `json:"httpOnly"`
}
