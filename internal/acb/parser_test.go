package acb

import "testing"

func TestParseHistory(t *testing.T) {
	transactions, err := ParseHistory(`<table><tr><th>Ngày hiệu lực</th><th>Ngày giao dịch</th><th>Số GD</th><th>Ghi nợ</th><th>Ghi có</th><th>Số dư</th><th>Nội dung giao dịch</th></tr><tr><td>10/09/2026</td><td>10/09/2026</td><td>2629</td><td>-</td><td>50.000</td><td>1.250.000</td><td>Thanh toan</td></tr></table>`)
	if err != nil {
		t.Fatal(err)
	}
	if len(transactions) != 1 || transactions[0].Credit != 50000 || transactions[0].Balance == nil || *transactions[0].Balance != 1250000 {
		t.Fatalf("transactions=%+v", transactions)
	}
}

func TestParseHistoryRejectsUnknownSchema(t *testing.T) {
	if _, err := ParseHistory(`<table><tr><th>not history</th></tr></table>`); err == nil {
		t.Fatal("accepted unknown table")
	}
}

func TestParseHistoryRejectsInvalidMoney(t *testing.T) {
	_, err := ParseHistory(`<table><tr><th>Ngày giao dịch</th><th>Số GD</th><th>Ghi nợ</th><th>Ghi có</th></tr><tr><td>10/09</td><td>1</td><td>-</td><td>50K</td></tr></table>`)
	if err == nil {
		t.Fatal("accepted invalid money")
	}
}
