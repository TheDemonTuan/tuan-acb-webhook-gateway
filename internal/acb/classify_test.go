package acb

import "testing"

func TestClassifyPage(t *testing.T) {
	cases := []struct {
		name, url, body string
		want            PageKind
	}{
		{"login HTTP 200", "https://online.acb.com.vn/acbib/Request", `<input name="username"><input type="password" name="password">`, LoginPage},
		{"otp", "https://online.acb.com.vn/acbib/Request", `Nhập mã OTP SafeKey`, OTPChallenge},
		{"captcha", "https://online.acb.com.vn/acbib/Request", `captcha Mã xác nhận`, CaptchaPage},
		{"maintenance", "https://online.acb.com.vn/acbib/Request", `Hệ thống đang bảo trì`, MaintenancePage},
		{"account", "https://online.acb.com.vn/acbib/Request", `ibkacctDetailProc dse_processorState AccountNbr`, AccountDetailPage},
		{"history", "https://online.acb.com.vn/acbib/Request", `ibkacctDetailProc dse_processorState AccountNbr FromDate ToDate`, HistoryPage},
		{"untrusted host", "https://example.test/", `ibkacctDetailProc AccountNbr`, UnknownPage},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyPage(tc.url, tc.body); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}
