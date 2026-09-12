package voicecopy

import (
	"testing"
)

func TestBuildCreditAnnouncement(t *testing.T) {
	// Without description
	p1 := BuildCreditAnnouncement(500000, "Thanh toan tien nha", false)
	if p1 != "Bạn vừa nhận được năm trăm nghìn đồng." {
		t.Errorf("unexpected phrase without desc: %q", p1)
	}

	// With description
	p2 := BuildCreditAnnouncement(500000, "Thanh toan tien nha", true)
	if p2 != "Bạn vừa nhận được năm trăm nghìn đồng. Nội dung: Thanh toan tien nha." {
		t.Errorf("unexpected phrase with desc: %q", p2)
	}

	// With URL in description (sanitized out)
	p3 := BuildCreditAnnouncement(200000, "Nap tien https://scam.site/pay ngay", true)
	if p3 != "Bạn vừa nhận được hai trăm nghìn đồng. Nội dung: Nap tien ngay." {
		t.Errorf("unexpected sanitized phrase: %q", p3)
	}
}

func TestBuildBurstAnnouncement(t *testing.T) {
	p := BuildBurstAnnouncement(3, 1200000)
	expected := "Bạn vừa nhận được 3 giao dịch mới, tổng cộng một triệu hai trăm nghìn đồng."
	if p != expected {
		t.Errorf("unexpected burst phrase: %q; expected %q", p, expected)
	}
}
