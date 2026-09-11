package acb

import (
	"html"
	"net/url"
	"strings"
)

type PageKind string

const (
	AccountDetailPage PageKind = "ACCOUNT_DETAIL_PAGE"
	HistoryPage       PageKind = "HISTORY_PAGE"
	LoginPage         PageKind = "LOGIN_PAGE"
	OTPChallenge      PageKind = "OTP_CHALLENGE"
	CaptchaPage       PageKind = "CAPTCHA_PAGE"
	MaintenancePage   PageKind = "MAINTENANCE_PAGE"
	UnknownPage       PageKind = "UNKNOWN_PAGE"
)

// ClassifyPage uses independent page signals. It must not turn unknown markup
// into an empty transaction history.
func ClassifyPage(finalURL, body string) PageKind {
	page := strings.ToLower(html.UnescapeString(body))
	location, _ := url.Parse(finalURL)
	host := strings.ToLower(location.Hostname())
	if host != "" && host != "online.acb.com.vn" {
		return UnknownPage
	}
	if containsAny(page, "bảo trì", "bao tri", "maintenance") {
		return MaintenancePage
	}

	lowerURL := strings.ToLower(finalURL)
	if containsAny(lowerURL, "login.jsp", "displaypagenotloginop", "obkloginop", "/acbib/webmbtt") ||
		containsAny(page, "displaypagenotloginop", "obkloginop", "webmbtt", "phiên làm việc đã hết hạn", "phien lam viec da het han", "vui lòng đăng nhập lại", "vui long dang nhap lai") {
		return LoginPage
	}

	if strings.Contains(page, "ibkacctdetailproc") && containsAny(page, "accountnbr", "dse_processorstate") {
		if containsAny(page, "sogd", "sogiaodich", "so gd", "số gd") || (containsAny(page, "ghino", "ghi no", "ghi nợ") && containsAny(page, "ghico", "ghi co", "ghi có")) {
			return HistoryPage
		}
		return AccountDetailPage
	}
	if strings.Contains(page, "ibkacctsumproc") && containsAny(page, "accountnbr", "accountnumber", "dse_processorstate") {
		return AccountDetailPage
	}

	loginSignals := 0
	for _, signal := range []string{"username", "tên truy cập", "ten truy cap", "password", "mật khẩu", "mat khau", "obkloginop"} {
		if strings.Contains(page, signal) {
			loginSignals++
		}
	}
	if loginSignals >= 2 {
		return LoginPage
	}

	if containsAny(page, "nhập mã otp", "nhap ma otp", "nhập mã safekey", "nhap ma safekey", "mã xác thực otp", "ma xac thuc otp", "xác thực otp", "xac thuc otp", "xác nhận otp", "xac nhan otp", "mã otp", "ma otp", `name="otp"`, `id="otp"`, `name="safekey"`, `id="safekey"`, `name="authcode"`, `id="authcode"`) {
		return OTPChallenge
	}
	if containsAny(page, "mã xác nhận", "ma xac nhan", "mã kiểm tra", "ma kiem tra", `name="captcha"`, `id="captcha"`) {
		return CaptchaPage
	}
	return UnknownPage
}

func containsAny(value string, candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.Contains(value, candidate) {
			return true
		}
	}
	return false
}
