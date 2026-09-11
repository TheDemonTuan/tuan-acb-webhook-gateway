package acb

import "testing"

func TestClassifyPage(t *testing.T) {
	cases := []struct {
		name, url, body string
		want            PageKind
	}{
		{"login HTTP 200", "https://online.acb.com.vn/acbib/Request", `<input name="username"><input type="password" name="password">`, LoginPage},
		{"login with captcha", "https://online.acb.com.vn/acbib/Request", `<input name="username"><input type="password" name="password"><input name="captcha" placeholder="Mã xác nhận">`, LoginPage},
		{"login redirect errorPage", "https://online.acb.com.vn/acbib/Request?dse_errorPage=login.jsp", `some text`, LoginPage},
		{"login redirect displayPageNotLoginOp", "https://online.acb.com.vn/acbib/Request?dse_operationName=displayPageNotLoginOp", `some text`, LoginPage},
		{"login webmbtt redirect", "https://online.acb.com.vn/acbib/webmbtt", `some text`, LoginPage},
		{"login meta refresh to webmbtt", "https://online.acb.com.vn/acbib/", `<meta HTTP-EQUIV="REFRESH" content="0; url=https://online.acb.com.vn/acbib/webmbtt">`, LoginPage},
		{"login session timeout message", "https://online.acb.com.vn/acbib/Request", `Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.`, LoginPage},
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
