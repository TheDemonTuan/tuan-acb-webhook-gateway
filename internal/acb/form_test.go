package acb

import "testing"

func TestExtractHistoryForm(t *testing.T) {
	form, err := ExtractHistoryForm(`<form action="/acbib/Request"><input name="dse_operationName" value="ibkacctDetailProc"><input name="dse_processorState" value="fresh-state"><input name="dse_sessionId" value="rotated"></form>`)
	if err != nil {
		t.Fatal(err)
	}
	if form.Action != "/acbib/Request" || form.Fields["dse_sessionId"] != "rotated" {
		t.Fatalf("unexpected form %#v", form)
	}
}

func TestExtractHistoryFormRejectsMissingState(t *testing.T) {
	if _, err := ExtractHistoryForm(`<form action="/acbib/Request"><input name="dse_operationName" value="x"></form>`); err == nil {
		t.Fatal("accepted incomplete state")
	}
}
