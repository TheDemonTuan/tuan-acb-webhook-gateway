package acb

import (
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
	page := strings.ToLower(body)
	location, _ := url.Parse(finalURL)
	host := strings.ToLower(location.Hostname())
	if host != "" && host != "online.acb.com.vn" {
		return UnknownPage
	}
	if containsAny(page, "bảo trì", "bao tri", "maintenance") {
		return MaintenancePage
	}
	if containsAny(page, "captcha", "mã xác nhận", "ma xac nhan") {
		return CaptchaPage
	}
	if containsAny(page, "otp", "safekey", "mã otp", "ma otp") {
		return OTPChallenge
	}
	lowerURL := strings.ToLower(finalURL)
	if containsAny(lowerURL, "login.jsp", "displaypagenotloginop", "obkloginop", "/acbib/webmbtt") ||
		containsAny(page, "displaypagenotloginop", "obkloginop", "webmbtt", "phiên làm việc đã hết hạn", "phien lam viec da het han", "vui lòng đăng nhập lại", "vui long dang nhap lai") {
		return LoginPage
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
	if strings.Contains(page, "ibkacctdetailproc") && containsAny(page, "accountnbr", "dse_processorstate") {
		if containsAny(page, "fromdate", "todate", "ngày giao dịch", "ngay giao dich") {
			return HistoryPage
		}
		return AccountDetailPage
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
