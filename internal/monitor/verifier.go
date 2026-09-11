package monitor

import (
	"context"
	"errors"

	"github.com/thedemontuan/tuan-bank-gateway/internal/acb"
)

type SessionVerifier struct {
	sessions *SessionLoader
	client   *acb.Client
}

func NewSessionVerifier(sessions *SessionLoader, client *acb.Client) *SessionVerifier {
	return &SessionVerifier{sessions: sessions, client: client}
}

func (v *SessionVerifier) VerifySession(ctx context.Context, connectionID string, generation int64, encrypted []byte) error {
	if v == nil || v.sessions == nil || v.client == nil {
		return errors.New("ACB session verifier is unavailable")
	}
	if err := v.sessions.RestoreEnvelope(connectionID, generation, encrypted); err != nil {
		return err
	}
	response, err := v.client.Bootstrap(ctx)
	if err != nil {
		return err
	}
	switch response.Kind {
	case acb.AccountDetailPage, acb.HistoryPage:
		return nil
	case acb.LoginPage, acb.OTPChallenge, acb.CaptchaPage:
		return errors.New("ACB authentication was not preserved")
	case acb.MaintenancePage:
		return errors.New("ACB is under maintenance")
	default:
		return errors.New("ACB authenticated page is not recognized")
	}
}
