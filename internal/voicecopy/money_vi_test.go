package voicecopy

import (
	"testing"
)

func TestSpeakVND(t *testing.T) {
	tests := []struct {
		amount   int64
		expected string
	}{
		{0, "không đồng"},
		{-10, "không đồng"},
		{1, "một đồng"},
		{5, "năm đồng"},
		{10, "mười đồng"},
		{15, "mười lăm đồng"},
		{20, "hai mươi đồng"},
		{21, "hai mươi mốt đồng"},
		{24, "hai mươi tư đồng"},
		{25, "hai mươi lăm đồng"},
		{100, "một trăm đồng"},
		{101, "một trăm linh một đồng"},
		{105, "một trăm linh năm đồng"},
		{110, "một trăm mười đồng"},
		{115, "một trăm mười lăm đồng"},
		{1000, "một nghìn đồng"},
		{10000, "mười nghìn đồng"},
		{15000, "mười lăm nghìn đồng"},
		{21000, "hai mươi mốt nghìn đồng"},
		{25000, "hai mươi lăm nghìn đồng"},
		{100000, "một trăm nghìn đồng"},
		{105000, "một trăm linh năm nghìn đồng"},
		{500000, "năm trăm nghìn đồng"},
		{1000000, "một triệu đồng"},
		{1005000, "một triệu không trăm linh năm nghìn đồng"},
		{1250000, "một triệu hai trăm năm mươi nghìn đồng"},
		{10000000, "mười triệu đồng"},
		{10500000, "mười triệu năm trăm nghìn đồng"},
		{1000000000, "một tỷ đồng"},
		{2500000000, "hai tỷ năm trăm triệu đồng"},
	}

	for _, tt := range tests {
		actual := SpeakVND(tt.amount)
		if actual != tt.expected {
			t.Errorf("SpeakVND(%d) = %q; expected %q", tt.amount, actual, tt.expected)
		}
	}
}
