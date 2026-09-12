package acb

import (
	"errors"
	"strings"
	"time"

	"golang.org/x/net/html"
)

type FormState struct {
	Action string
	Fields map[string]string
}

const historyDateLayout = "02/01/2006"

// PrepareHistoryFields converts the current ACB account-detail form into an
// explicit by-date query for yesterday through today in the configured zone.
func PrepareHistoryFields(fields map[string]string, now time.Time, location *time.Location) (map[string]string, error) {
	if location == nil {
		return nil, errors.New("ACB history timezone is required")
	}
	prepared := cloneFields(fields)
	if prepared["dse_operationName"] == "" || prepared["dse_processorState"] == "" {
		return nil, errors.New("ACB history request is missing current form state")
	}
	today := now.In(location)
	prepared["dse_nextEventName"] = "byDate"
	prepared["activeDatetimeYN"] = "N"
	prepared["FromDate"] = today.AddDate(0, 0, -1).Format(historyDateLayout)
	prepared["ToDate"] = today.Format(historyDateLayout)
	prepared["CheckRef"] = "false"
	prepared["CheckDoiUng"] = "false"

	// These controls belong to mutually exclusive search modes or auxiliary
	// balance-confirmation forms and must not survive a by-date submission.
	for _, name := range []string{
		"activeDatetimeByMonth", "MonthCurr", "YearCurr",
		"MajorTKXacNhanSoDu", "MinorTKXacNhanSoDu", "SoDuTKXacNhanSoDu",
	} {
		delete(prepared, name)
	}
	return prepared, nil
}

// ExtractHistoryForm reads the current server-generated form state. It never
// accepts a state saved from a prior session.
func ExtractHistoryForm(markup string) (FormState, error) {
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		return FormState{}, err
	}

	var forms []*html.Node
	var findForms func(*html.Node)
	findForms = func(n *html.Node) {
		if n.Type == html.ElementNode && strings.EqualFold(n.Data, "form") {
			forms = append(forms, n)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			findForms(c)
		}
	}
	findForms(doc)

	extractFields := func(root *html.Node) FormState {
		state := FormState{Fields: make(map[string]string)}
		if root.Type == html.ElementNode && strings.EqualFold(root.Data, "form") {
			for _, attr := range root.Attr {
				if strings.EqualFold(attr.Key, "action") {
					state.Action = attr.Val
				}
			}
		}
		var visit func(*html.Node)
		visit = func(node *html.Node) {
			if node.Type == html.ElementNode {
				tag := strings.ToLower(node.Data)
				switch tag {
				case "input", "textarea":
					var name, value string
					for _, attr := range node.Attr {
						switch strings.ToLower(attr.Key) {
						case "name":
							name = attr.Val
						case "value":
							value = attr.Val
						}
					}
					if name != "" {
						state.Fields[name] = value
					}
				case "select":
					var name string
					for _, attr := range node.Attr {
						if strings.EqualFold(attr.Key, "name") {
							name = attr.Val
						}
					}
					if name != "" {
						var selectedVal, firstVal string
						var foundSelected bool
						var scanOption func(*html.Node)
						scanOption = func(opt *html.Node) {
							if opt.Type == html.ElementNode && strings.EqualFold(opt.Data, "option") {
								var optVal string
								var isSelected bool
								for _, attr := range opt.Attr {
									if strings.EqualFold(attr.Key, "value") {
										optVal = attr.Val
									}
									if strings.EqualFold(attr.Key, "selected") {
										isSelected = true
									}
								}
								if firstVal == "" {
									firstVal = optVal
								}
								if isSelected {
									selectedVal = optVal
									foundSelected = true
								}
							}
							for c := opt.FirstChild; c != nil; c = c.NextSibling {
								scanOption(c)
							}
						}
						scanOption(node)
						if foundSelected {
							state.Fields[name] = selectedVal
						} else if firstVal != "" {
							state.Fields[name] = firstVal
						}
					}
				}
			}
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				visit(child)
			}
		}
		visit(root)
		return state
	}

	var bestState FormState
	var bestScore int = -1
	for _, f := range forms {
		s := extractFields(f)
		if s.Action != "" && s.Fields["dse_processorState"] != "" && s.Fields["dse_operationName"] != "" {
			score := 1
			if s.Fields["dse_operationName"] == "ibkacctDetailProc" {
				score += 5
			}
			if s.Fields["dse_nextEventName"] == "byDate" || (s.Fields["FromDate"] != "" && s.Fields["ToDate"] != "") {
				score += 10
			}
			if s.Fields["AccountNbr"] != "" {
				score += 2
			}
			if score > bestScore {
				bestScore = score
				bestState = s
			}
		}
	}
	if bestScore >= 0 {
		return bestState, nil
	}

	whole := extractFields(doc)
	if whole.Action == "" && len(forms) > 0 {
		for _, attr := range forms[0].Attr {
			if strings.EqualFold(attr.Key, "action") {
				whole.Action = attr.Val
			}
		}
	}
	if whole.Action == "" {
		whole.Action = "/acbib/Request"
	}
	if whole.Fields["dse_processorState"] != "" && whole.Fields["dse_operationName"] != "" {
		return whole, nil
	}

	return FormState{}, errors.New("ACB account form state is incomplete")
}
