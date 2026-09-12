package acb

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/net/html"
)

type Transaction struct {
	Number        string
	EffectiveDate string
	TransactionAt string
	Debit         int64
	Credit        int64
	Balance       *int64
	Description   string
}

// ParseHistory requires a recognizable table header and rejects malformed rows;
// callers must quarantine rejected pages rather than treating them as empty.
func ParseHistory(markup string) ([]Transaction, error) {
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		return nil, err
	}
	var tables []*html.Node
	walk(doc, func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "table" {
			tables = append(tables, node)
		}
	})
	var recognized bool
	var emptyHistory bool
	for _, table := range tables {
		rows := tableRows(table)
		headerIndex, columns := historyHeader(rows)
		if headerIndex < 0 {
			continue
		}
		recognized = true
		transactions := make([]Transaction, 0, len(rows)-headerIndex-1)
		for i := headerIndex + 1; i < len(rows); i++ {
			row := rows[i]
			if len(row) == 0 || allBlank(row) {
				continue
			}
			transaction, err := parseRow(row, columns)
			if err != nil {
				if len(transactions) > 0 {
					var nonBlank []string
					for _, cell := range row {
						t := strings.TrimSpace(cell)
						if t != "" {
							nonBlank = append(nonBlank, t)
						}
					}
					if len(nonBlank) > 0 && transactions[len(transactions)-1].Description == "" {
						transactions[len(transactions)-1].Description = strings.Join(nonBlank, " ")
						continue
					}
				}
				rowText := strings.ToLower(strings.Join(row, " "))
				if containsAny(rowText, "khong co giao dich", "không có giao dịch", "no transaction", "chua co giao dich", "chưa có giao dịch") {
					emptyHistory = true
					continue
				}
				if isTableFooter(rowText) {
					continue
				}
				if allTransactionColumnsBlank(row, columns) {
					continue
				}
				return nil, err
			}
			if columns.description < 0 && i+1 < len(rows) {
				nextRow := rows[i+1]
				if len(nextRow) > 0 && !allBlank(nextRow) {
					if _, errNext := parseRow(nextRow, columns); errNext != nil {
						var nonBlank []string
						for _, cell := range nextRow {
							t := strings.TrimSpace(cell)
							if t != "" {
								nonBlank = append(nonBlank, t)
							}
						}
						if len(nonBlank) > 0 {
							transaction.Description = strings.Join(nonBlank, " ")
							i++
						}
					}
				}
			}
			transactions = append(transactions, transaction)
		}
		if len(transactions) > 0 {
			return transactions, nil
		}
	}
	if recognized && emptyHistory {
		return []Transaction{}, nil
	}
	if recognized {
		return nil, errors.New("ACB history table has no transactions and no recognized empty-state marker")
	}
	return nil, errors.New("ACB history table schema not recognized")
}

func historyHeader(rows [][]string) (int, columns) {
	for i, row := range rows {
		indexes := columnIndexes(row)
		if indexes.valid() {
			return i, indexes
		}
	}
	return -1, columns{}
}

func allTransactionColumnsBlank(row []string, c columns) bool {
	for _, index := range []int{c.number, c.effective, c.transaction, c.debit, c.credit, c.balance} {
		if index >= 0 && index < len(row) && strings.TrimSpace(row[index]) != "" {
			return false
		}
	}
	return true
}

func isTableFooter(text string) bool {
	return containsAny(text,
		"trang truoc", "trang trước", "trang sau", "next", "previous",
		"tong cong", "tổng cộng", "page", "export", "xuat excel", "xuất excel",
		"first", "last", "dau", "đầu", "cuoi", "cuối", "go to", "goto",
	)
}

type columns struct{ number, effective, transaction, debit, credit, balance, description int }

func (c columns) valid() bool {
	return c.number >= 0 && c.transaction >= 0 && c.debit >= 0 && c.credit >= 0
}

func columnIndexes(header []string) columns {
	indexes := columns{number: -1, effective: -1, transaction: -1, debit: -1, credit: -1, balance: -1, description: -1}
	for index, name := range header {
		switch normalized(name) {
		case "sogd", "sogiaodich", "sogiao dich", "transactionnumber":
			indexes.number = index
		case "ngayhieuluc", "effective date":
			indexes.effective = index
		case "ngaygiaodich", "transaction date":
			indexes.transaction = index
		case "ghino", "debit":
			indexes.debit = index
		case "ghico", "credit":
			indexes.credit = index
		case "sodu", "balance":
			indexes.balance = index
		case "noidunggiaodich", "description", "content":
			indexes.description = index
		}
	}
	return indexes
}

func parseRow(row []string, c columns) (Transaction, error) {
	get := func(index int) string {
		if index < 0 || index >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[index])
	}
	debit, err := parseMoney(get(c.debit))
	if err != nil {
		return Transaction{}, fmt.Errorf("invalid debit: %w", err)
	}
	credit, err := parseMoney(get(c.credit))
	if err != nil {
		return Transaction{}, fmt.Errorf("invalid credit: %w", err)
	}
	if get(c.number) == "" || get(c.transaction) == "" {
		return Transaction{}, errors.New("transaction row is missing transaction number or date")
	}
	transaction := Transaction{Number: get(c.number), EffectiveDate: get(c.effective), TransactionAt: get(c.transaction), Debit: debit, Credit: credit, Description: get(c.description)}
	if raw := get(c.balance); raw != "" {
		balance, err := parseMoney(raw)
		if err != nil {
			return Transaction{}, fmt.Errorf("invalid balance: %w", err)
		}
		transaction.Balance = &balance
	}
	return transaction, nil
}

func parseMoney(value string) (int64, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, " ", ""))
	if value == "" || value == "-" {
		return 0, nil
	}
	negative := strings.HasPrefix(value, "(") && strings.HasSuffix(value, ")")
	value = strings.Trim(value, "()")
	var digits strings.Builder
	for _, r := range value {
		if unicode.IsDigit(r) {
			digits.WriteRune(r)
		} else if !strings.ContainsRune("., ₫VNDvnd", r) {
			return 0, errors.New("unexpected currency character")
		}
	}
	if digits.Len() == 0 {
		return 0, errors.New("missing amount")
	}
	amount, err := strconv.ParseInt(digits.String(), 10, 64)
	if err != nil {
		return 0, err
	}
	if negative {
		return -amount, nil
	}
	return amount, nil
}

func tableRows(table *html.Node) [][]string {
	var rows [][]string
	walk(table, func(node *html.Node) {
		if node.Type != html.ElementNode || node.Data != "tr" {
			return
		}
		var cells []string
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			if child.Type == html.ElementNode && (child.Data == "th" || child.Data == "td") {
				cells = append(cells, strings.TrimSpace(text(child)))
			}
		}
		if len(cells) > 0 {
			rows = append(rows, cells)
		}
	})
	return rows
}

func walk(node *html.Node, visit func(*html.Node)) {
	visit(node)
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		walk(child, visit)
	}
}

func text(node *html.Node) string {
	var values []string
	walk(node, func(current *html.Node) {
		if current.Type == html.TextNode {
			values = append(values, current.Data)
		}
	})
	return strings.Join(values, " ")
}

func allBlank(values []string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

func normalized(value string) string {
	value = strings.NewReplacer(
		"à", "a", "á", "a", "ả", "a", "ã", "a", "ạ", "a", "ă", "a", "ằ", "a", "ắ", "a", "ẳ", "a", "ẵ", "a", "ặ", "a", "â", "a", "ầ", "a", "ấ", "a", "ẩ", "a", "ẫ", "a", "ậ", "a",
		"è", "e", "é", "e", "ẻ", "e", "ẽ", "e", "ẹ", "e", "ê", "e", "ề", "e", "ế", "e", "ể", "e", "ễ", "e", "ệ", "e",
		"ì", "i", "í", "i", "ỉ", "i", "ĩ", "i", "ị", "i",
		"ò", "o", "ó", "o", "ỏ", "o", "õ", "o", "ọ", "o", "ô", "o", "ồ", "o", "ố", "o", "ổ", "o", "ỗ", "o", "ộ", "o", "ơ", "o", "ờ", "o", "ớ", "o", "ở", "o", "ỡ", "o", "ợ", "o",
		"ù", "u", "ú", "u", "ủ", "u", "ũ", "u", "ụ", "u", "ư", "u", "ừ", "u", "ứ", "u", "ử", "u", "ữ", "u", "ự", "u",
		"ỳ", "y", "ý", "y", "ỷ", "y", "ỹ", "y", "ỵ", "y", "đ", "d",
	).Replace(strings.ToLower(strings.TrimSpace(value)))
	var out strings.Builder
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == ' ' {
			out.WriteRune(r)
		}
	}
	return strings.ReplaceAll(out.String(), " ", "")
}
