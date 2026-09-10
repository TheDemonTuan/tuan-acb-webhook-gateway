package acb

import (
	"errors"
	"strings"

	"golang.org/x/net/html"
)

type FormState struct {
	Action string
	Fields map[string]string
}

// ExtractHistoryForm reads the current server-generated form state. It never
// accepts a state saved from a prior session.
func ExtractHistoryForm(markup string) (FormState, error) {
	doc, err := html.Parse(strings.NewReader(markup))
	if err != nil {
		return FormState{}, err
	}
	state := FormState{Fields: make(map[string]string)}
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode && node.Data == "form" {
			for _, attr := range node.Attr {
				if strings.EqualFold(attr.Key, "action") {
					state.Action = attr.Val
				}
			}
		}
		if node.Type == html.ElementNode && (node.Data == "input" || node.Data == "select" || node.Data == "textarea") {
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
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(doc)
	if state.Action == "" || state.Fields["dse_processorState"] == "" || state.Fields["dse_operationName"] == "" {
		return FormState{}, errors.New("ACB account form state is incomplete")
	}
	return state, nil
}
